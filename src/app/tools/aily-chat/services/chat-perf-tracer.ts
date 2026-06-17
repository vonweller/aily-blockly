/**
 * ChatPerformanceTracer — 可切换的流式对话性能诊断工具
 *
 * 用法：
 *   在浏览器 DevTools Console 中：
 *     ChatPerformanceTracer.enable();             // 开启跟踪
 *     ChatPerformanceTracer.disable();            // 关闭跟踪
 *     ChatPerformanceTracer.dump();                // 打印 bounded 摘要
 *     ChatPerformanceTracer.dump(40);              // 打印最近 40 个事件明细
 *     ChatPerformanceTracer.dumpSlow(5);           // 打印耗时 > 5ms 的摘要
 *     ChatPerformanceTracer.reset();               // 清空日志
 *
 * 诊断重点：
 *   - SSE 事件到达时间
 *   - doFlush / flushNow 延迟
 *   - x-dialog preprocess rAF 延迟
 *   - tool 执行耗时
 *   - startChatTurn 各阶段耗时
 */

interface TraceEntry {
  tag: string;
  phase: 'start' | 'end';
  t: number;            // performance.now()
  detail?: string;
}

interface JankSnapshotEntry {
  label: string;
  t: number;
  data: Record<string, unknown>;
}

interface RenderEventSnapshotEntry {
  label: string;
  t: number;
  data: Record<string, unknown>;
}

export interface ChatPerformanceTraceEntry {
  readonly tag: string;
  readonly phase: 'start' | 'end';
  readonly t: number;
  readonly detail?: string;
}

const ENTRY_OPEN_TRACE_FLAG = 'aily.chat.traceEntryOpenPerformance';
const ENTRY_OPEN_TRACE_GLOBAL_KEYS = [
  '__AILY_CHAT_TRACE_ENTRY_OPEN_PERFORMANCE__',
  'AILY_CHAT_TRACE_ENTRY_OPEN_PERFORMANCE',
  '__AILY_PERF_TRACE',
  'AILY_PERF_TRACE',
] as const;

const MAX_LOG = 5000;
const log: TraceEntry[] = [];
/** 关键事件独立 buffer — 不被高频 streaming 事件覆盖 */
const KEY_MAX = 500;
const keyLog: TraceEntry[] = [];
const SNAPSHOT_MAX = 80;
const jankSnapshots: JankSnapshotEntry[] = [];
const RENDER_EVENT_MAX = 100;
const renderEventSnapshots: RenderEventSnapshotEntry[] = [];
const counters = new Map<string, number>();
/** 高频标签集 — 这些 tag 不写入 keyLog */
const HIGH_FREQ_TAGS = new Set(['sse_chunk', 'preprocess_rAF_scheduled']);
let seqId = 0;

function parseTraceFlag(value: unknown): boolean {
  if (value === true || value === 1) {
    return true;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
  }
  return false;
}

function isEnabled(): boolean {
  try {
    const runtime = globalThis as Record<string, unknown>;
    for (const key of ENTRY_OPEN_TRACE_GLOBAL_KEYS) {
      if (parseTraceFlag(runtime[key])) {
        return true;
      }
    }
    return parseTraceFlag(globalThis.localStorage?.getItem?.(ENTRY_OPEN_TRACE_FLAG));
  } catch {
    return false;
  }
}

function isHighFreq(tag: string): boolean {
  if (HIGH_FREQ_TAGS.has(tag)) return true;
  // doFlush / preprocess_rAF_exec 带有 [id] 前缀
  const inner = tag.includes('] ') ? tag.slice(tag.indexOf('] ') + 2) : tag;
  return inner === 'doFlush' || inner === 'preprocess_rAF_exec';
}

function pushEntry(entry: TraceEntry): void {
  log.push(entry);
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
  if (!isHighFreq(entry.tag)) {
    keyLog.push(entry);
    if (keyLog.length > KEY_MAX) keyLog.splice(0, keyLog.length - KEY_MAX);
  }
}

export class ChatPerformanceTracer {

  // ─── 动态扩展方法（Console 调用） ───
  static startLongTaskObserver: () => void;
  static stopLongTaskObserver: () => void;
  static dumpLongTasks: (count?: number) => void;
  static dumpJankContext: (count?: number) => void;

  // ─── 核心 API ───

  static isEnabled(): boolean {
    return isEnabled();
  }

  static enable(): void {
    try {
      (globalThis as Record<string, unknown>)['__AILY_PERF_TRACE'] = true;
      globalThis.localStorage?.setItem?.(ENTRY_OPEN_TRACE_FLAG, '1');
    } catch {}
  }

  static disable(): void {
    try {
      (globalThis as Record<string, unknown>)['__AILY_PERF_TRACE'] = false;
      globalThis.localStorage?.removeItem?.(ENTRY_OPEN_TRACE_FLAG);
    } catch {}
  }

  /** 开始一个命名 span，返回 spanId */
  static begin(tag: string, detail?: string): number {
    if (!isEnabled()) return -1;
    const id = ++seqId;
    pushEntry({ tag: `[${id}] ${tag}`, phase: 'start', t: performance.now(), detail });
    return id;
  }

  /** 结束一个命名 span */
  static end(spanId: number, tag: string, detail?: string): void {
    if (!isEnabled() || spanId < 0) return;
    pushEntry({ tag: `[${spanId}] ${tag}`, phase: 'end', t: performance.now(), detail });
  }

  /** 打点（无 start/end 对） */
  static mark(tag: string, detail?: string): void {
    if (!isEnabled()) return;
    pushEntry({ tag, phase: 'start', t: performance.now(), detail });
  }

  static increment(counter: string, delta = 1): void {
    if (!isEnabled() || typeof counter !== 'string' || counter.trim().length === 0) {
      return;
    }
    const normalizedDelta = Number.isFinite(delta) ? delta : 1;
    counters.set(counter, (counters.get(counter) ?? 0) + normalizedDelta);
  }

  static recordDuration(
    tag: string,
    durationMs: number,
    detail?: string,
    options: { readonly slowThresholdMs?: number; readonly counterPrefix?: string } = {},
  ): void {
    if (!isEnabled() || typeof tag !== 'string' || tag.trim().length === 0 || !Number.isFinite(durationMs)) {
      return;
    }

    const normalizedTag = tag.trim();
    const prefix = options.counterPrefix || `duration.${normalizedTag}`;
    this.increment(`${prefix}.count`);
    this.increment(`${prefix}.totalMs`, Math.max(0, Math.round(durationMs)));

    const slowThresholdMs = Number.isFinite(options.slowThresholdMs) ? options.slowThresholdMs! : 16;
    if (durationMs >= slowThresholdMs) {
      this.increment(`${prefix}.slow`);
      this.mark(
        `SLOW ${normalizedTag}`,
        `${durationMs.toFixed(1)}ms${detail ? ` ${detail}` : ''}`,
      );
    }
  }

  static recordJankSnapshot(label: string, data: Record<string, unknown>): void {
    if (!isEnabled() || typeof label !== 'string' || label.trim().length === 0) {
      return;
    }
    jankSnapshots.push({
      label: label.trim(),
      t: performance.now(),
      data: sanitizeSnapshotData(data),
    });
    if (jankSnapshots.length > SNAPSHOT_MAX) {
      jankSnapshots.splice(0, jankSnapshots.length - SNAPSHOT_MAX);
    }
  }

  static recordRenderEvent(label: string, data: Record<string, unknown>): void {
    if (!isEnabled() || typeof label !== 'string' || label.trim().length === 0) {
      return;
    }

    renderEventSnapshots.push({
      label: label.trim(),
      t: performance.now(),
      data: sanitizeSnapshotData(data),
    });
    if (renderEventSnapshots.length > RENDER_EVENT_MAX) {
      renderEventSnapshots.splice(0, renderEventSnapshots.length - RENDER_EVENT_MAX);
    }
  }

  static snapshotCounters(): Record<string, number> {
    return Object.fromEntries(counters.entries());
  }

  static snapshotEntries(options: { readonly keyOnly?: boolean; readonly tags?: readonly string[] } = {}): readonly ChatPerformanceTraceEntry[] {
    const source = options.keyOnly ? keyLog : log;
    const tagFilter = Array.isArray(options.tags) && options.tags.length > 0
      ? new Set(options.tags)
      : null;

    return source
      .filter(entry => !tagFilter || tagFilter.has(entry.tag))
      .map(entry => ({
        tag: entry.tag,
        phase: entry.phase,
        t: entry.t,
        ...(entry.detail ? { detail: entry.detail } : {}),
      }));
  }

  static snapshotRenderEvents(): readonly Readonly<Record<string, unknown>>[] {
    return renderEventSnapshots.map(entry => ({
      label: entry.label,
      t: entry.t,
      ...entry.data,
    }));
  }

  // ─── 输出与调试 ───

  /** 打印最近的全部事件日志 */
  static dump(count?: number): void {
    if (log.length === 0) { console.log('[PerfTracer] 无记录'); return; }
    const recent = log.slice(-120);
    const first = recent[0];
    const last = recent[recent.length - 1];
    console.log(
      `[PerfTracer] events: count=${log.length}, recent=${recent.length}, span=${first && last ? (last.t - first.t).toFixed(1) : '0.0'}ms`,
    );

    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
      console.log('[PerfTracer] pass dump(40) to print a bounded detail table');
      return;
    }

    const safeCount = Math.max(1, Math.min(Math.floor(count), 40));
    const entries = log.slice(-safeCount);

    const t0 = entries[0].t;
    const rows = entries.map(e => ({
      '∆ms': +(e.t - t0).toFixed(2),
      'phase': e.phase,
      'tag': e.tag,
      'detail': e.detail || '',
    }));
    console.table(rows);
  }

  /**
   * 打印关键事件（工具调用、startChatTurn 阶段、LONG_TASK 等）
   * 不含高频 streaming 事件（sse_chunk / doFlush / preprocess），定位卡顿首选
   */
  static dumpKey(count?: number): void {
    if (keyLog.length === 0) { console.log('[PerfTracer] 无关键事件'); return; }
    const recent = keyLog.slice(-80);
    const first = recent[0];
    const last = recent[recent.length - 1];
    console.log(
      `[PerfTracer] key events: count=${keyLog.length}, recent=${recent.length}, span=${first && last ? (last.t - first.t).toFixed(1) : '0.0'}ms`,
    );

    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
      console.log('[PerfTracer] pass dumpKey(40) to print a bounded detail table');
      return;
    }

    const safeCount = Math.max(1, Math.min(Math.floor(count), 40));
    const entries = keyLog.slice(-safeCount);

    const t0 = entries[0].t;
    const rows = entries.map(e => ({
      '∆ms': +(e.t - t0).toFixed(2),
      'phase': e.phase,
      'tag': e.tag,
      'detail': e.detail || '',
    }));
    console.table(rows);
  }

  /** 打印 超过阈值（ms）的 span */
  static dumpSlow(thresholdMs = 3): void {
    const starts = new Map<string, number>();
    const slow: Array<{ tag: string; ms: number; detail?: string }> = [];

    for (const e of log) {
      if (e.phase === 'start') { starts.set(e.tag, e.t); }
      else if (e.phase === 'end') {
        const s = starts.get(e.tag);
        if (s !== undefined) {
          const ms = e.t - s;
          if (ms >= thresholdMs) { slow.push({ tag: e.tag, ms: +ms.toFixed(2), detail: e.detail }); }
          starts.delete(e.tag);
        }
      }
    }

    if (slow.length === 0) { console.log(`[PerfTracer] 无 > ${thresholdMs}ms 的 span`); return; }
    slow.sort((a, b) => b.ms - a.ms);
    const top = slow.slice(0, 10);
    const totalMs = slow.reduce((sum, entry) => sum + entry.ms, 0);
    console.log(
      `[PerfTracer] slow spans: count=${slow.length}, total=${totalMs.toFixed(1)}ms, max=${slow[0]?.ms.toFixed(1) ?? '0.0'}ms`,
    );
    console.table(top);
  }

  static dumpCounters(): void {
    const entries = [...counters.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([counter, value]) => ({ counter, value }));

    if (entries.length === 0) {
      console.log('[PerfTracer] 无计数器记录');
      return;
    }

    console.log(`[PerfTracer] counters: count=${entries.length}, top=${Math.min(entries.length, 20)}`);
    console.table(entries.slice(0, 20));
  }

  static dumpJankSnapshots(count = 20): void {
    if (jankSnapshots.length === 0) {
      console.log('[PerfTracer] 无渲染快照');
      return;
    }

    const safeCount = Math.max(1, Math.min(Math.floor(count), 40));
    const snapshots = jankSnapshots.slice(-safeCount);
    const first = snapshots[0];
    const rows = snapshots.map((entry) => ({
      'Δms': +(entry.t - first.t).toFixed(2),
      label: entry.label,
      ...entry.data,
    }));
    console.log(`[PerfTracer] jank snapshots: count=${jankSnapshots.length}, showing=${snapshots.length}`);
    console.table(rows);
  }

  static dumpRecentRenderEvents(count = 40): void {
    if (renderEventSnapshots.length === 0) {
      console.log('[PerfTracer] 无 render event 摘要');
      return;
    }

    const safeCount = Math.max(1, Math.min(Math.floor(count), RENDER_EVENT_MAX));
    const events = renderEventSnapshots.slice(-safeCount);
    const first = events[0];
    const rows = events.map((entry) => ({
      'Δms': +(entry.t - first.t).toFixed(2),
      label: entry.label,
      ...entry.data,
    }));
    console.log(`[PerfTracer] recent render events: count=${renderEventSnapshots.length}, showing=${events.length}`);
    console.table(rows);
  }

  /** 清空日志 */
  static reset(): void {
    log.length = 0;
    keyLog.length = 0;
    jankSnapshots.length = 0;
    renderEventSnapshots.length = 0;
    counters.clear();
    seqId = 0;
  }
}

function sanitizeSnapshotData(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (typeof value === 'string') {
      result[key] = value.length > 160 ? `${value.slice(0, 157)}...` : value;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
      result[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      result[key] = value.slice(0, 8).map((entry) => String(entry)).join(',');
      continue;
    }
    result[key] = String(value);
  }
  return result;
}

// 暴露到全局方便 Console 调用
try { (globalThis as any).ChatPerformanceTracer = ChatPerformanceTracer; } catch {}

/**
 * LongTaskObserver — 使用 PerformanceObserver 捕获 > 50ms 的 long task
 * 需要浏览器支持 PerformanceObserver + 'longtask' entry type
 *
 * 用法：
 *   ChatPerformanceTracer.startLongTaskObserver();   // 开始监听
 *   ChatPerformanceTracer.stopLongTaskObserver();    // 停止
 *   ChatPerformanceTracer.dumpLongTasks();           // 打印长任务摘要
 *   ChatPerformanceTracer.dumpLongTasks(40);         // 打印最近 40 条长任务明细
 */
let longTaskObserver: PerformanceObserver | null = null;
const longTasks: Array<{ start: number; duration: number; name: string; attribution?: string }> = [];

ChatPerformanceTracer.startLongTaskObserver = function(): void {
  ChatPerformanceTracer.enable();
  if (longTaskObserver) return;
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const attribution = formatLongTaskAttribution(entry);
        longTasks.push({
          start: entry.startTime,
          duration: entry.duration,
          name: entry.name || 'self',
          ...(attribution ? { attribution } : {}),
        });
        if (isEnabled()) {
          ChatPerformanceTracer.mark('LONG_TASK', `${entry.duration.toFixed(1)}ms${attribution ? ` ${attribution}` : ''}`);
        }
        // keep last 200
        if (longTasks.length > 200) longTasks.splice(0, longTasks.length - 200);
      }
    });
    longTaskObserver.observe({ type: 'longtask', buffered: true });
    console.log('[PerfTracer] LongTask observer started');
  } catch (e) {
    console.warn('[PerfTracer] LongTask observer not supported:', e);
  }
};

ChatPerformanceTracer.stopLongTaskObserver = function(): void {
  if (longTaskObserver) {
    longTaskObserver.disconnect();
    longTaskObserver = null;
    console.log('[PerfTracer] LongTask observer stopped');
  }
};

ChatPerformanceTracer.dumpLongTasks = function(count?: number): void {
  if (longTasks.length === 0) { console.log('[PerfTracer] 无 long task 记录'); return; }
  const allTotalDurationMs = longTasks.reduce((sum, task) => sum + task.duration, 0);
  const allMaxDurationMs = longTasks.reduce((max, task) => Math.max(max, task.duration), 0);
  const recent = longTasks.slice(-20);
  const recentTotalDurationMs = recent.reduce((sum, task) => sum + task.duration, 0);
  const recentMaxDurationMs = recent.reduce((max, task) => Math.max(max, task.duration), 0);
  console.log(
    `[PerfTracer] long tasks: count=${longTasks.length}, total=${allTotalDurationMs.toFixed(1)}ms, max=${allMaxDurationMs.toFixed(1)}ms, recent20Total=${recentTotalDurationMs.toFixed(1)}ms, recent20Max=${recentMaxDurationMs.toFixed(1)}ms`,
  );

  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
    console.log('[PerfTracer] pass dumpLongTasks(40) to print a bounded detail table');
    return;
  }

  const safeCount = Math.max(1, Math.min(Math.floor(count), 40));
  const tasks = longTasks.slice(-safeCount);
  console.log(`[PerfTracer] long tasks detail: showing ${tasks.length}/${longTasks.length}`);
  console.table(tasks.map(t => ({
    'start(ms)': +t.start.toFixed(1),
    'duration(ms)': +t.duration.toFixed(1),
    'name': t.name,
    'attribution': t.attribution || '',
  })));
};

ChatPerformanceTracer.dumpJankContext = function(count = 40): void {
  console.log('[PerfTracer] jank context');
  ChatPerformanceTracer.dumpLongTasks(count);
  ChatPerformanceTracer.dumpJankSnapshots(Math.min(count, 20));
  ChatPerformanceTracer.dumpRecentRenderEvents(Math.min(count, 100));
  ChatPerformanceTracer.dumpCounters();
  ChatPerformanceTracer.dumpKey(count);
  ChatPerformanceTracer.dumpSlow(8);
};

function formatLongTaskAttribution(entry: PerformanceEntry): string | undefined {
  const raw = entry as PerformanceEntry & {
    attribution?: Array<{
      name?: string;
      entryType?: string;
      containerType?: string;
      containerName?: string;
      containerId?: string;
      containerSrc?: string;
    }>;
  };
  const attribution = Array.isArray(raw.attribution) ? raw.attribution : [];
  if (!attribution.length) {
    return undefined;
  }
  return attribution
    .slice(0, 4)
    .map((item) => [
      item.name || item.entryType || '',
      item.containerType || '',
      item.containerName || item.containerId || item.containerSrc || '',
    ].filter(Boolean).join(':'))
    .filter(Boolean)
    .join('|') || undefined;
}
