import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { SubWindowComponent } from '../../components/sub-window/sub-window.component';
import type { PartitionManagerContext } from './partition-manager-host';
import {
  allocatePartitions, alignUp, APP_ALIGNMENT, createPreset, formatBytes,
  KIB, layoutSegments, MIB, parsePartitionCsv, SECTOR, serializePartitions, validatePartitions,
  type PartitionDraft, type PartitionLayout, type PartitionPreset, type PartitionRow, type PartitionSegment,
} from './partition-layout';

interface EditorState {
  draft: PartitionDraft | null;
  csv: string;
  flashBytes: number;
  referenceOnly: boolean;
}
interface Repair { label: string; detail: string; state: EditorState; }

@Component({
  selector: 'app-partition-manager',
  imports: [CommonModule, FormsModule, NzButtonModule, NzModalModule, SubWindowComponent],
  templateUrl: './partition-manager.component.html',
  styleUrl: './partition-manager.component.scss',
})
export class PartitionManagerComponent implements OnInit {
  readonly MIB = MIB;
  readonly KIB = KIB;
  readonly format = formatBytes;
  readonly presetNames = { iot: '物联网应用', xiaozhi: '小智应用', large: '大程序（有线更新）' };
  context: PartitionManagerContext | null = null;
  state: EditorState = { draft: null, csv: '', flashBytes: 0, referenceOnly: false };
  opening: EditorState | null = null;
  history: EditorState[] = [];
  layout: PartitionLayout = validatePartitions([], 0);
  rows: PartitionRow[] = [];
  errors: string[] = [];
  segments: PartitionSegment[] = [];
  repairs: Repair[] = [];
  mapFlashBytes = 0;
  loading = true;
  saving = false;
  error = '';
  notice = '';
  showPresets = true;
  showAdjust = false;
  showAdvanced = false;
  showCapacity = false;
  showMore = false;
  showCsv = false;
  allowClose = false;
  closingPrompt = false;
  private readonly projectPath: string;

  constructor(route: ActivatedRoute, private modal: NzModalService) {
    this.projectPath = route.snapshot.queryParamMap.get('project') || '';
  }

  ngOnInit(): void { void this.load(); }

  get dirty(): boolean { return !!this.opening && JSON.stringify(this.state) !== JSON.stringify(this.opening); }
  get canSave(): boolean {
    return !!this.context && !this.loading && !this.saving && !this.errors.length && !this.state.referenceOnly
      && (!this.context.customSelected || this.dirty || this.state.csv !== this.context.csv || this.state.flashBytes !== this.context.flashBytes);
  }
  get draft(): PartitionDraft | null { return this.state.draft; }
  get storageBytes(): number {
    return this.layout.partitions.filter(p => p.typeId === 1 && [0x81, 0x82, 0x83].includes(p.subtypeId)).reduce((sum, p) => sum + p.sizeBytes, 0);
  }
  get systemBytes(): number {
    return this.segments.filter(p => p.kind === 'system').reduce((sum, p) => sum + p.bytes, 0);
  }
  get appTotal(): number { return this.layout.partitions.filter(p => p.typeId === 0).reduce((sum, p) => sum + p.sizeBytes, 0); }
  get changes(): string[] {
    if (!this.context) return [];
    const parsed = parsePartitionCsv(this.context.csv);
    const before = validatePartitions(parsed.rows, this.context.flashBytes);
    const changes: string[] = [];
    if (this.state.flashBytes !== this.context.flashBytes) changes.push(`Flash 配置：${formatBytes(this.context.flashBytes)} → ${formatBytes(this.state.flashBytes)}`);
    if (before.ota !== this.layout.ota) changes.push(`在线更新空间：${before.ota ? '双槽' : '单槽'} → ${this.layout.ota ? '双槽' : '单槽'}`);
    for (const p of this.layout.partitions) {
      const old = before.partitions.find(item => item.name === p.name);
      if (!old) changes.push(`新增 ${p.name}：${formatBytes(p.sizeBytes)}`);
      else {
        if (old.sizeBytes !== p.sizeBytes) changes.push(`${p.name}：${formatBytes(old.sizeBytes)} → ${formatBytes(p.sizeBytes)}`);
        if (old.offsetBytes !== p.offsetBytes || old.typeId !== p.typeId || old.subtypeId !== p.subtypeId) changes.push(`${p.name} 的位置或类型改变${p.typeId === 1 ? '，原有数据可能无法读取' : ''}`);
      }
    }
    for (const old of before.partitions) if (!this.layout.partitions.some(p => p.name === old.name)) changes.push(`移除 ${old.name}`);
    return changes;
  }

  async load(): Promise<void> {
    if (this.dirty && !await this.confirmDiscard('重新载入会放弃当前草稿，继续吗？')) return;
    this.loading = true; this.error = '';
    try {
      const response = await this.send({ action: 'partition-manager-load', projectPath: this.projectPath });
      this.context = response.context;
      const csv = this.context.csv;
      const draft = csv ? this.context.draft : createPreset('iot', this.context.flashBytes);
      this.state = { csv: csv || serializePartitions(allocatePartitions(draft!).rows), draft, flashBytes: this.context.flashBytes, referenceOnly: false };
      this.opening = this.clone(this.state); this.history = [];
      this.showPresets = !csv; this.showAdvanced = !!csv && !draft;
      this.showCapacity = !this.state.flashBytes;
      this.notice = this.context.customSelected && !csv ? '当前项目缺少自定义分区文件，请选择用途方案重建或导入 CSV。'
        : this.context.source === 'legacy' ? '已载入旧位置的分区文件，保存后会放到编译器使用的项目源码目录。' : '';
      this.recalculate();
    } catch (error) { this.error = this.errorText(error); }
    finally { this.loading = false; }
  }

  selectPreset(preset: PartitionPreset): void {
    this.commit(this.fromDraft(createPreset(preset, this.state.flashBytes), preset === 'xiaozhi' && !this.context?.xiaozhiSupported));
    this.notice = '已替换编辑草稿，尚未保存。可撤销回到上一步。';
    this.showMore = false;
  }

  changeFlash(bytes: number): void {
    const next = this.clone(this.state); next.flashBytes = Number(bytes);
    if (next.draft) {
      next.draft.flashBytes = next.flashBytes;
      Object.assign(next, this.fromDraft(next.draft, next.referenceOnly));
    }
    this.commit(next);
  }

  changeOption(key: 'ota' | 'storage' | 'coredump', checked: boolean): void {
    if (!this.draft) return;
    const draft = { ...this.draft, [key]: checked };
    if (key === 'storage' && checked && draft.appMode === 'remaining') {
      draft.storageMode = 'fixed'; draft.storageBytes = draft.storageBytes || MIB;
    }
    this.commit(this.fromDraft(draft, this.state.referenceOnly));
  }

  setSize(key: 'appBytes' | 'storageBytes' | 'nvsBytes', raw: string): void {
    if (!this.draft) return;
    const value = raw.trim() === '' ? NaN : Number(raw);
    const unit = key === 'nvsBytes' ? KIB : MIB;
    const step = key === 'appBytes' ? APP_ALIGNMENT : SECTOR;
    const bytes = value > 0 && Number.isFinite(value) ? alignUp(Math.round(value * unit), step) : 0;
    const draft = { ...this.draft, [key]: bytes };
    if (key === 'appBytes') draft.appMode = 'fixed';
    if (key === 'storageBytes') draft.storageMode = 'fixed';
    this.commit(this.fromDraft(draft, this.state.referenceOnly));
    if (bytes && Math.abs(bytes - value * unit) > 0.1) this.notice = `已按芯片要求调整为 ${formatBytes(bytes)}，可撤销。`;
  }

  useSuggestedProgram(): void {
    if (!this.draft) return;
    const recommended = createPreset(this.draft.preset, this.state.flashBytes);
    const draft = { ...this.draft, appMode: recommended.appMode, appBytes: recommended.appBytes };
    if (draft.appMode === 'remaining' && draft.storage) draft.storageMode = 'fixed';
    this.commit(this.fromDraft(draft, this.state.referenceOnly));
  }

  toggleStorageMode(): void {
    if (!this.draft) return;
    const draft = { ...this.draft };
    draft.storageMode = draft.storageMode === 'remaining' ? 'fixed' : 'remaining';
    if (draft.storageMode === 'fixed') draft.storageBytes = this.storageBytes || MIB;
    else if (draft.appMode === 'remaining') { draft.appMode = 'fixed'; draft.appBytes = this.layout.appLimit; }
    this.commit(this.fromDraft(draft, this.state.referenceOnly));
  }

  editRow(index: number, key: keyof PartitionRow, value: string): void {
    const rows = this.rows.map(row => ({ ...row })); rows[index][key] = value;
    this.commit({ ...this.state, draft: null, csv: serializePartitions(rows) });
  }
  addRow(): void {
    let name = 'storage'; let suffix = 1;
    while (this.rows.some(row => row.name === name)) name = 'storage' + suffix++;
    this.commit({ ...this.state, draft: null, csv: serializePartitions([...this.rows, { name, type: 'data', subtype: 'spiffs', offset: '', size: '4K', flags: '' }]) });
  }
  removeRow(index: number): void {
    this.commit({ ...this.state, draft: null, csv: serializePartitions(this.rows.filter((_, i) => i !== index)) });
  }
  editCsv(csv: string): void { this.commit({ ...this.state, draft: null, csv }); }

  async importCsv(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement; const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 128 * 1024) throw new Error('分区 CSV 不能超过 128 KiB。');
      const csv = await file.text();
      this.commit({ csv, draft: null, flashBytes: this.state.flashBytes, referenceOnly: false });
      this.showAdvanced = true; this.notice = '已导入草稿；原始 CSV 内容保持不变，保存前将再次校验。';
    } catch (error) { this.error = this.errorText(error); }
    finally { input.value = ''; }
  }

  exportCsv(): void {
    const url = URL.createObjectURL(new Blob([this.state.csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'partitions.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  undo(): void {
    const previous = this.history.pop();
    if (previous) { this.state = previous; this.error = ''; this.notice = '已撤销上一步。'; this.recalculate(); }
  }
  restoreOpening(): void {
    if (this.opening) { this.commit(this.clone(this.opening)); this.notice = '已恢复打开时的方案。'; }
  }
  applyRepair(repair: Repair): void { this.commit(this.clone(repair.state)); this.notice = '已应用修复到草稿，请核对本次更改后保存。'; }

  async save(): Promise<void> {
    if (!this.canSave) return;
    this.saving = true; this.error = '';
    try {
      await this.send({ action: 'partition-manager-save', token: this.context!.token,
        csv: this.state.csv, flashBytes: this.state.flashBytes, draft: this.state.draft });
      this.allowClose = true;
      window['iWindow']?.close();
    } catch (error) { this.error = this.errorText(error); }
    finally { this.saving = false; }
  }

  async close(): Promise<void> {
    if (this.saving || this.closingPrompt) return;
    if (!this.dirty || this.allowClose || await this.confirmDiscard('放弃本次分区修改？')) {
      this.allowClose = true; window['iWindow']?.close();
    }
  }
  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (!this.allowClose && (this.dirty || this.saving)) {
      event.preventDefault(); event.returnValue = '';
      if (!this.saving) void this.close();
    }
  }

  private async send(data: any): Promise<any> {
    if (!window['iWindow']?.send) throw new Error('请从桌面软件的分区方案菜单打开此窗口。');
    const response = await window['iWindow'].send({ to: 'main', data, timeout: 15000 });
    if (!response?.success) throw new Error(response?.error || '主窗口未响应。请检查项目是否仍然打开，再重试。');
    return response;
  }
  private fromDraft(draft: PartitionDraft, referenceOnly = false): EditorState {
    return { draft, flashBytes: draft.flashBytes, csv: serializePartitions(allocatePartitions(draft).rows), referenceOnly };
  }
  private clone(state: EditorState): EditorState { return JSON.parse(JSON.stringify(state)); }
  private commit(state: EditorState): void {
    if (this.saving) return;
    const oldStorage = this.storageBytes;
    this.history.push(this.clone(this.state)); if (this.history.length > 50) this.history.shift();
    this.state = state; this.error = ''; this.notice = ''; this.recalculate();
    if (!this.errors.length && oldStorage !== this.storageBytes) this.notice = `文件／资源空间：${formatBytes(oldStorage)} → ${formatBytes(this.storageBytes)}。`;
  }
  private recalculate(): void {
    const parsed = parsePartitionCsv(this.state.csv); this.rows = parsed.rows;
    this.layout = validatePartitions(parsed.rows, this.state.flashBytes);
    const allocationErrors = this.draft ? allocatePartitions(this.draft).errors : [];
    this.errors = [...new Set([...parsed.errors, ...allocationErrors, ...this.layout.errors])];
    if (!this.errors.length) {
      this.segments = layoutSegments(this.layout, this.state.flashBytes); this.mapFlashBytes = this.state.flashBytes;
    }
    this.repairs = [];
    if (this.errors.length && this.draft && !this.state.referenceOnly) {
      const recommended = this.fromDraft(createPreset(this.draft.preset, this.state.flashBytes));
      const candidates = [{ label: '重新使用用途推荐值', state: recommended }];
      if (this.draft.ota) candidates.push({ label: '改为有线更新', state: this.fromDraft({ ...this.draft, ota: false }) });
      for (const candidate of candidates) {
        const generated = allocatePartitions(candidate.state.draft!);
        const result = validatePartitions(generated.rows, candidate.state.flashBytes);
        if (!generated.errors.length && !result.errors.length) this.repairs.push({ ...candidate,
          detail: `单份程序 ${formatBytes(result.appLimit)}；${candidate.state.draft!.ota ? '保留双槽 OTA' : '不预留在线更新'}。重设相关手动值，固件大小需编译验证。` });
      }
    }
  }
  private confirmDiscard(title: string): Promise<boolean> {
    this.closingPrompt = true;
    return new Promise(resolve => {
      const finish = (value: boolean) => { this.closingPrompt = false; resolve(value); };
      this.modal.confirm({ nzTitle: title, nzContent: '项目和设备尚未改变。', nzOkText: '放弃修改', nzCancelText: '继续编辑',
        nzOnOk: () => finish(true), nzOnCancel: () => finish(false) });
    });
  }
  private errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
}
