import { Injectable, OnDestroy } from '@angular/core';
import {
  hasValidTiktokenWorkerResult,
  isTiktokenWorkerResponse,
  type TiktokenBPE,
  type TiktokenEncoding,
  type TiktokenWorkerOperation,
  type TiktokenWorkerRequest,
  type TiktokenWorkerRequestBody,
  type TiktokenWorkerResponse,
} from '../workers/tiktoken-worker-protocol';

interface TiktokenInstance {
  encode(
    text: string,
    allowedSpecial?: Array<string> | 'all',
    disallowedSpecial?: Array<string> | 'all',
  ): number[];
  decode(tokens: number[]): string;
}

interface LoadedEncodingArtifact {
  encoding: TiktokenEncoding;
  encoder: TiktokenInstance;
  rankData: TiktokenBPE;
  source: 'local' | 'cdn';
}

interface EncodingLoadEntry {
  promise: Promise<TiktokenInstance | null>;
  abortController: AbortController;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface EncodingFailure {
  failedAt: number;
}

interface PendingWorkerRequest {
  id: number;
  worker: Worker;
  epoch: number;
  type: TiktokenWorkerOperation;
  encoding: TiktokenEncoding;
  timeoutId: ReturnType<typeof setTimeout>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface WorkerRegistration {
  worker: Worker;
  epoch: number;
  promise: Promise<void>;
}

function estimateTokensFallback(text: string): number {
  if (!text) return 0;

  let count = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code > 0x4E00 && code < 0x9FFF) {
      count += 0.67;
    } else if (code > 0x7F) {
      count += 0.5;
    } else {
      count += 0.25;
    }
  }
  return Math.ceil(count);
}

class TokenCountCache {
  private readonly cache = new Map<string, number>();

  constructor(private readonly maxSize = 2000) {}

  get(key: string): number | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: number): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * 使用 js-tiktoken 提供客户端 token 计数。
 *
 * 加载与激活严格分离：同一 encoding 共享加载任务，只有仍匹配最新模型
 * revision 的结果才会成为活动编码器。加载中或失败时使用启发式 fallback。
 */
@Injectable({ providedIn: 'root' })
export class TiktokenService implements OnDestroy {
  private static readonly DEFAULT_ENCODING: TiktokenEncoding = 'o200k_base';
  private static readonly CHUNK_THRESHOLD = 50000;
  private static readonly CHUNK_SIZE = 20000;
  private static readonly CACHE_KEY_MAX_LENGTH = 500;
  private static readonly WORKER_OFFLOAD_THRESHOLD = 10000;
  private static readonly LOAD_RETRY_COOLDOWN_MS = 30000;
  private static readonly LOAD_TIMEOUT_MS = 60000;
  private static readonly WORKER_REQUEST_TIMEOUT_MS = 30000;

  private static readonly MODEL_ENCODING_MAP: Array<{
    pattern: string;
    encoding: TiktokenEncoding;
  }> = [
    { pattern: 'gpt-3.5', encoding: 'cl100k_base' },
    { pattern: 'gpt-4-turbo', encoding: 'cl100k_base' },
    { pattern: 'gpt-4-0', encoding: 'cl100k_base' },
    { pattern: 'gpt-4-1', encoding: 'cl100k_base' },
    { pattern: 'text-embedding', encoding: 'cl100k_base' },
  ];

  private static readonly ENCODING_CONFIGS: Record<
    TiktokenEncoding,
    { localPath: string; cdnUrl: string }
  > = {
    o200k_base: {
      localPath: 'aily-chat/tiktoken/o200k_base.json',
      cdnUrl: 'https://tiktoken.pages.dev/js/o200k_base.json',
    },
    cl100k_base: {
      localPath: 'aily-chat/tiktoken/cl100k_base.json',
      cdnUrl: 'https://tiktoken.pages.dev/js/cl100k_base.json',
    },
  };

  private desiredEncoding: TiktokenEncoding = TiktokenService.DEFAULT_ENCODING;
  private activeEncoding: TiktokenEncoding | null = null;
  private activeEncoder: TiktokenInstance | null = null;
  private switchRevision = 0;
  private modelSelectionInitialized = false;
  private destroyed = false;

  private readonly encoderCache = new Map<TiktokenEncoding, TiktokenInstance>();
  private readonly loadingByEncoding = new Map<TiktokenEncoding, EncodingLoadEntry>();
  private readonly failureByEncoding = new Map<TiktokenEncoding, EncodingFailure>();
  private readonly exactCountCaches = new Map<TiktokenEncoding, TokenCountCache>();

  private worker: Worker | null = null;
  private workerEpoch = 0;
  private workerRequestId = 0;
  private readonly workerRegisteredEncodings = new Set<TiktokenEncoding>();
  private readonly workerRegistrationByEncoding = new Map<TiktokenEncoding, WorkerRegistration>();
  private readonly pendingWorkerRequests = new Map<number, PendingWorkerRequest>();

  private readonly stats = {
    exactCount: 0,
    fallbackCount: 0,
    cacheHits: 0,
    loadDedupHits: 0,
    staleActivationsSkipped: 0,
    workerInstancesCreated: 0,
    workerFallbackCount: 0,
    loadsStarted: {
      o200k_base: 0,
      cl100k_base: 0,
    },
    activations: {
      o200k_base: 0,
      cl100k_base: 0,
    },
  };

  countTokens(text: string): number {
    if (!text) return 0;

    const encoding = this.activeEncoding;
    const encoder = this.getUsableActiveEncoder();
    if (!encoding || !encoder) {
      this.stats.fallbackCount++;
      return estimateTokensFallback(text);
    }

    const cache = this.getExactCountCache(encoding);
    if (text.length <= TiktokenService.CACHE_KEY_MAX_LENGTH) {
      const cached = cache.get(text);
      if (cached !== undefined) {
        this.stats.cacheHits++;
        return cached;
      }
    }

    const count = this.encodeCount(encoder, text);
    this.stats.exactCount++;
    if (text.length <= TiktokenService.CACHE_KEY_MAX_LENGTH) {
      cache.set(text, count);
    }
    return count;
  }

  encode(text: string): number[] {
    const encoder = this.getUsableActiveEncoder();
    return text && encoder ? encoder.encode(text) : [];
  }

  decode(tokens: number[]): string {
    const encoder = this.getUsableActiveEncoder();
    return tokens?.length && encoder ? encoder.decode(tokens) : '';
  }

  get isReady(): boolean {
    return this.getUsableActiveEncoder() !== null;
  }

  get isLoading(): boolean {
    return this.loadingByEncoding.has(this.desiredEncoding);
  }

  get isWorkerReady(): boolean {
    return !!this.worker
      && !!this.activeEncoding
      && this.workerRegisteredEncodings.has(this.activeEncoding);
  }

  get encodingName(): TiktokenEncoding {
    return this.desiredEncoding;
  }

  get activeEncodingName(): TiktokenEncoding | null {
    return this.activeEncoding;
  }

  getStats() {
    return {
      ...this.stats,
      loadsStarted: { ...this.stats.loadsStarted },
      activations: { ...this.stats.activations },
    };
  }

  async waitForReady(): Promise<boolean> {
    if (!this.modelSelectionInitialized || this.destroyed) {
      return false;
    }

    while (!this.destroyed) {
      const target = this.desiredEncoding;
      const revision = this.switchRevision;
      const encoder = await this.ensureEncodingLoaded(target);

      if (target !== this.desiredEncoding || revision !== this.switchRevision) {
        continue;
      }
      return this.activateIfCurrent(target, revision, encoder);
    }
    return false;
  }

  async switchEncoderForModel(modelName: string | null): Promise<void> {
    if (this.destroyed) return;

    const target = this.resolveEncoding(modelName);
    this.modelSelectionInitialized = true;

    if (
      this.desiredEncoding === target
      && this.activeEncoding === target
      && this.activeEncoder
    ) {
      return;
    }

    const previousEncoding = this.activeEncoding;
    const revision = ++this.switchRevision;
    this.desiredEncoding = target;

    if (this.activeEncoding !== target) {
      this.activeEncoding = null;
      this.activeEncoder = null;
    }

    const encoder = await this.ensureEncodingLoaded(target);
    if (this.activateIfCurrent(target, revision, encoder)) {
      console.log(
        `[TikToken] 编码器${previousEncoding === target ? '恢复' : '切换'}: `
        + `${previousEncoding ?? 'none'} → ${target}`,
      );
    }
  }

  async countTokensAsync(text: string): Promise<number> {
    if (!text) return 0;
    if (text.length < TiktokenService.WORKER_OFFLOAD_THRESHOLD) {
      return this.countTokens(text);
    }

    const encoding = this.activeEncoding;
    const revision = this.switchRevision;
    const worker = this.worker;
    if (
      !encoding
      || !worker
      || !this.getUsableActiveEncoder()
      || !this.workerRegisteredEncodings.has(encoding)
    ) {
      return this.countTokens(text);
    }

    try {
      const result = await this.sendWorkerRequest(
        worker,
        this.workerEpoch,
        { type: 'countTokens', encoding, text },
      );
      if (revision !== this.switchRevision || encoding !== this.activeEncoding) {
        return this.countTokens(text);
      }
      return result as number;
    } catch {
      this.stats.workerFallbackCount++;
      return this.countTokens(text);
    }
  }

  async countBatchAsync(
    items: Array<{ id: string; text: string }>,
  ): Promise<Map<string, number>> {
    if (!items?.length) return new Map();

    const encoding = this.activeEncoding;
    const revision = this.switchRevision;
    const worker = this.worker;
    if (
      !encoding
      || !worker
      || !this.getUsableActiveEncoder()
      || !this.workerRegisteredEncodings.has(encoding)
    ) {
      return this.countBatchOnMainThread(items);
    }

    try {
      const result = await this.sendWorkerRequest(
        worker,
        this.workerEpoch,
        { type: 'countBatch', encoding, items },
      );
      if (revision !== this.switchRevision || encoding !== this.activeEncoding) {
        return this.countBatchOnMainThread(items);
      }
      return new Map(Object.entries(result as Record<string, number>));
    } catch {
      this.stats.workerFallbackCount++;
      return this.countBatchOnMainThread(items);
    }
  }

  ngOnDestroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const entry of this.loadingByEncoding.values()) {
      clearTimeout(entry.timeoutId);
      entry.abortController.abort('destroy');
    }
    this.loadingByEncoding.clear();

    const worker = this.worker;
    if (worker) {
      this.resetWorker(worker, this.workerEpoch, new Error('Tiktoken service destroyed'));
    } else {
      for (const id of [...this.pendingWorkerRequests.keys()]) {
        this.settleWorkerRequest(id, undefined, new Error('Tiktoken service destroyed'));
      }
    }

    this.workerRegistrationByEncoding.clear();
    this.workerRegisteredEncodings.clear();
    this.encoderCache.clear();
    for (const cache of this.exactCountCaches.values()) {
      cache.clear();
    }
    this.exactCountCaches.clear();
    this.activeEncoder = null;
    this.activeEncoding = null;
  }

  private getUsableActiveEncoder(): TiktokenInstance | null {
    if (
      !this.activeEncoder
      || !this.activeEncoding
      || this.activeEncoding !== this.desiredEncoding
    ) {
      return null;
    }
    return this.activeEncoder;
  }

  private getExactCountCache(encoding: TiktokenEncoding): TokenCountCache {
    let cache = this.exactCountCaches.get(encoding);
    if (!cache) {
      cache = new TokenCountCache(5000);
      this.exactCountCaches.set(encoding, cache);
    }
    return cache;
  }

  private countBatchOnMainThread(
    items: Array<{ id: string; text: string }>,
  ): Map<string, number> {
    const result = new Map<string, number>();
    for (const item of items) {
      result.set(item.id, this.countTokens(item.text));
    }
    return result;
  }

  private encodeCount(encoder: TiktokenInstance, text: string): number {
    if (text.length <= TiktokenService.CHUNK_THRESHOLD) {
      return encoder.encode(text).length;
    }

    let total = 0;
    for (let index = 0; index < text.length; index += TiktokenService.CHUNK_SIZE) {
      total += encoder.encode(text.substring(index, index + TiktokenService.CHUNK_SIZE)).length;
    }
    return total;
  }

  private resolveEncoding(modelName: string | null): TiktokenEncoding {
    if (!modelName) return TiktokenService.DEFAULT_ENCODING;

    const normalizedModelName = modelName.toLowerCase();
    for (const mapping of TiktokenService.MODEL_ENCODING_MAP) {
      if (normalizedModelName.includes(mapping.pattern)) {
        return mapping.encoding;
      }
    }
    return TiktokenService.DEFAULT_ENCODING;
  }

  private activateIfCurrent(
    encoding: TiktokenEncoding,
    revision: number,
    encoder: TiktokenInstance | null,
  ): boolean {
    if (
      !encoder
      || this.destroyed
      || encoding !== this.desiredEncoding
      || revision !== this.switchRevision
    ) {
      if (encoder && !this.destroyed) {
        this.stats.staleActivationsSkipped++;
      }
      return false;
    }

    this.activeEncoding = encoding;
    this.activeEncoder = encoder;
    this.stats.activations[encoding]++;
    return true;
  }

  private ensureEncodingLoaded(
    encoding: TiktokenEncoding,
  ): Promise<TiktokenInstance | null> {
    if (this.destroyed) return Promise.resolve(null);

    const cached = this.encoderCache.get(encoding);
    if (cached) return Promise.resolve(cached);

    const pending = this.loadingByEncoding.get(encoding);
    if (pending) {
      this.stats.loadDedupHits++;
      return pending.promise;
    }

    const previousFailure = this.failureByEncoding.get(encoding);
    if (
      previousFailure
      && Date.now() - previousFailure.failedAt < TiktokenService.LOAD_RETRY_COOLDOWN_MS
    ) {
      return Promise.resolve(null);
    }
    this.failureByEncoding.delete(encoding);

    const abortController = new AbortController();
    const timeoutId = setTimeout(
      () => abortController.abort('timeout'),
      TiktokenService.LOAD_TIMEOUT_MS,
    );

    let entry!: EncodingLoadEntry;
    const loadPromise = this.loadEncodingArtifact(encoding, abortController.signal);
    const promise = this.raceWithAbortSignal(loadPromise, abortController.signal)
      .then(artifact => {
        if (this.destroyed) return null;
        if (artifact.encoding !== encoding) {
          throw new Error(
            `Loaded encoding mismatch: expected=${encoding}, actual=${artifact.encoding}`,
          );
        }

        this.encoderCache.set(encoding, artifact.encoder);
        this.failureByEncoding.delete(encoding);
        console.log(
          `[TikToken] ${encoding} BPE rank 数据已从`
          + `${artifact.source === 'local' ? '本地' : 'CDN'}加载`,
        );

        void Promise.resolve()
          .then(() => this.registerWorkerEncoding(encoding, artifact.rankData))
          .catch(error => this.handleWorkerRegistrationFailure(encoding, error));
        return artifact.encoder;
      })
      .catch(error => {
        if (this.destroyed || abortController.signal.reason === 'destroy') {
          return null;
        }
        this.failureByEncoding.set(encoding, { failedAt: Date.now() });
        console.warn(`[TikToken] ${encoding} 编码器加载失败，将使用启发式估算:`, error);
        return null;
      })
      .finally(() => {
        clearTimeout(timeoutId);
        if (this.loadingByEncoding.get(encoding) === entry) {
          this.loadingByEncoding.delete(encoding);
        }
      });

    entry = { promise, abortController, timeoutId };
    this.loadingByEncoding.set(encoding, entry);
    this.stats.loadsStarted[encoding]++;
    return promise;
  }

  private async loadEncodingArtifact(
    encoding: TiktokenEncoding,
    signal: AbortSignal,
  ): Promise<LoadedEncodingArtifact> {
    const { Tiktoken } = await import('js-tiktoken/lite');
    const config = TiktokenService.ENCODING_CONFIGS[encoding];

    let localError: unknown;
    try {
      const rankData = await this.fetchRankData(config.localPath, signal);
      return {
        encoding,
        encoder: new Tiktoken(rankData),
        rankData,
        source: 'local',
      };
    } catch (error) {
      if (signal.aborted) throw error;
      localError = error;
    }

    try {
      const rankData = await this.fetchRankData(config.cdnUrl, signal);
      return {
        encoding,
        encoder: new Tiktoken(rankData),
        rankData,
        source: 'cdn',
      };
    } catch (cdnError) {
      throw new AggregateError(
        [localError, cdnError],
        `Unable to load ${encoding} rank data from local assets or CDN`,
      );
    }
  }

  private async fetchRankData(url: string, signal: AbortSignal): Promise<TiktokenBPE> {
    const response = await fetch(url, { signal });
    if (response.ok === false) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  private raceWithAbortSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(this.createAbortError(signal.reason));
    }

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(this.createAbortError(signal.reason));
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
    });
  }

  private createAbortError(reason: unknown): Error {
    return new Error(
      reason === 'timeout' ? 'Tiktoken encoding load timed out' : 'Tiktoken encoding load aborted',
    );
  }

  private registerWorkerEncoding(
    encoding: TiktokenEncoding,
    rankData: TiktokenBPE,
  ): Promise<void> {
    return Promise.resolve().then(() => {
      if (this.destroyed) return;

      const { worker, epoch } = this.ensureWorker();
      if (this.workerRegisteredEncodings.has(encoding)) return;

      const pending = this.workerRegistrationByEncoding.get(encoding);
      if (pending?.worker === worker && pending.epoch === epoch) {
        return pending.promise;
      }

      let registration!: WorkerRegistration;
      const promise = this.sendWorkerRequest(
        worker,
        epoch,
        { type: 'registerEncoding', encoding, rankData },
      )
        .then(() => {
          if (this.worker === worker && this.workerEpoch === epoch) {
            this.workerRegisteredEncodings.add(encoding);
          }
        })
        .finally(() => {
          if (this.workerRegistrationByEncoding.get(encoding) === registration) {
            this.workerRegistrationByEncoding.delete(encoding);
          }
        });

      registration = { worker, epoch, promise };
      this.workerRegistrationByEncoding.set(encoding, registration);
      return promise;
    });
  }

  private ensureWorker(): { worker: Worker; epoch: number } {
    if (this.destroyed) {
      throw new Error('Tiktoken service destroyed');
    }
    if (this.worker) {
      return { worker: this.worker, epoch: this.workerEpoch };
    }

    const worker = new Worker(
      new URL('../workers/tiktoken.worker.ts', import.meta.url),
      { type: 'module' },
    );
    const epoch = ++this.workerEpoch;
    this.worker = worker;
    this.workerRegisteredEncodings.clear();
    this.stats.workerInstancesCreated++;

    worker.addEventListener('message', event => {
      this.handleWorkerMessage(worker, epoch, event.data);
    });
    worker.addEventListener('messageerror', () => {
      this.resetWorker(worker, epoch, new Error('Tiktoken Worker messageerror'));
    });
    worker.addEventListener('error', error => {
      this.resetWorker(worker, epoch, new Error(error.message || 'Tiktoken Worker error'));
    });

    return { worker, epoch };
  }

  private sendWorkerRequest(
    worker: Worker,
    epoch: number,
    body: TiktokenWorkerRequestBody,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.destroyed || this.worker !== worker || this.workerEpoch !== epoch) {
        reject(new Error('Tiktoken Worker is not active'));
        return;
      }

      const id = ++this.workerRequestId;
      const timeoutId = setTimeout(() => {
        if (this.pendingWorkerRequests.has(id)) {
          this.resetWorker(
            worker,
            epoch,
            new Error(`Tiktoken Worker request timed out: ${body.type}`),
          );
        }
      }, TiktokenService.WORKER_REQUEST_TIMEOUT_MS);

      const pending: PendingWorkerRequest = {
        id,
        worker,
        epoch,
        type: body.type,
        encoding: body.encoding,
        timeoutId,
        resolve,
        reject,
      };
      this.pendingWorkerRequests.set(id, pending);

      try {
        const request = { id, epoch, ...body } as TiktokenWorkerRequest;
        worker.postMessage(request);
      } catch (error) {
        this.settleWorkerRequest(
          id,
          undefined,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
  }

  private handleWorkerMessage(
    worker: Worker,
    epoch: number,
    value: unknown,
  ): void {
    if (this.worker !== worker || this.workerEpoch !== epoch) return;

    if (!isTiktokenWorkerResponse(value)) {
      this.resetWorker(worker, epoch, new Error('Invalid Tiktoken Worker response'));
      return;
    }

    const response: TiktokenWorkerResponse = value;
    const pending = this.pendingWorkerRequests.get(response.id);
    if (!pending) {
      console.warn('[TikToken Worker] 忽略未知或迟到的响应:', response.id);
      return;
    }

    if (
      pending.worker !== worker
      || pending.epoch !== response.epoch
      || pending.type !== response.type
      || pending.encoding !== response.encoding
      || !hasValidTiktokenWorkerResult(response)
    ) {
      this.resetWorker(worker, epoch, new Error('Mismatched Tiktoken Worker response'));
      return;
    }

    if (response.ok === false) {
      this.settleWorkerRequest(
        response.id,
        undefined,
        new Error(`[${response.error.code}] ${response.error.message}`),
      );
      return;
    }

    this.settleWorkerRequest(response.id, response.result);
  }

  private settleWorkerRequest(
    id: number,
    value?: unknown,
    error?: Error,
  ): void {
    const pending = this.pendingWorkerRequests.get(id);
    if (!pending) return;

    this.pendingWorkerRequests.delete(id);
    clearTimeout(pending.timeoutId);
    if (error) {
      pending.reject(error);
    } else {
      pending.resolve(value);
    }
  }

  private resetWorker(worker: Worker, epoch: number, error: Error): void {
    if (this.worker !== worker || this.workerEpoch !== epoch) return;

    this.worker = null;
    this.workerRegisteredEncodings.clear();
    for (const [encoding, registration] of this.workerRegistrationByEncoding) {
      if (registration.worker === worker && registration.epoch === epoch) {
        this.workerRegistrationByEncoding.delete(encoding);
      }
    }
    for (const [id, pending] of this.pendingWorkerRequests) {
      if (pending.worker === worker && pending.epoch === epoch) {
        this.settleWorkerRequest(id, undefined, error);
      }
    }
    worker.terminate();
  }

  private handleWorkerRegistrationFailure(
    encoding: TiktokenEncoding,
    error: unknown,
  ): void {
    console.warn(
      `[TikToken Worker] ${encoding} 注册失败，继续使用主线程计数:`,
      error,
    );
  }
}
