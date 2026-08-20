export type TiktokenEncoding = 'o200k_base' | 'cl100k_base';

export interface TiktokenBPE {
  pat_str: string;
  special_tokens: Record<string, number>;
  bpe_ranks: string;
}

export type TiktokenWorkerOperation =
  | 'registerEncoding'
  | 'countTokens'
  | 'countBatch';

interface TiktokenWorkerEnvelope {
  id: number;
  epoch: number;
  type: TiktokenWorkerOperation;
  encoding: TiktokenEncoding;
}

export type TiktokenWorkerRequest =
  | (TiktokenWorkerEnvelope & {
      type: 'registerEncoding';
      rankData: TiktokenBPE;
    })
  | (TiktokenWorkerEnvelope & {
      type: 'countTokens';
      text: string;
    })
  | (TiktokenWorkerEnvelope & {
      type: 'countBatch';
      items: Array<{ id: string; text: string }>;
    });

type WithoutWorkerEnvelope<T> = T extends unknown
  ? Omit<T, 'id' | 'epoch'>
  : never;

export type TiktokenWorkerRequestBody = WithoutWorkerEnvelope<TiktokenWorkerRequest>;

export type TiktokenWorkerErrorCode =
  | 'INVALID_REQUEST'
  | 'ENCODING_NOT_REGISTERED'
  | 'ENCODER_INIT_FAILED'
  | 'ENCODE_FAILED';

export type TiktokenWorkerResponse =
  | (TiktokenWorkerEnvelope & {
      type: 'registerEncoding';
      ok: true;
      result: true;
    })
  | (TiktokenWorkerEnvelope & {
      type: 'countTokens';
      ok: true;
      result: number;
    })
  | (TiktokenWorkerEnvelope & {
      type: 'countBatch';
      ok: true;
      result: Record<string, number>;
    })
  | (TiktokenWorkerEnvelope & {
      ok: false;
      error: {
        code: TiktokenWorkerErrorCode;
        message: string;
      };
    });

const WORKER_OPERATIONS: ReadonlySet<string> = new Set<TiktokenWorkerOperation>([
  'registerEncoding',
  'countTokens',
  'countBatch',
]);

const TIKTOKEN_ENCODINGS: ReadonlySet<string> = new Set<TiktokenEncoding>([
  'o200k_base',
  'cl100k_base',
]);

export function isTiktokenWorkerResponse(value: unknown): value is TiktokenWorkerResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<TiktokenWorkerResponse>;
  return Number.isInteger(candidate.id)
    && Number.isInteger(candidate.epoch)
    && typeof candidate.type === 'string'
    && WORKER_OPERATIONS.has(candidate.type)
    && typeof candidate.encoding === 'string'
    && TIKTOKEN_ENCODINGS.has(candidate.encoding)
    && typeof candidate.ok === 'boolean';
}

export function hasValidTiktokenWorkerResult(response: TiktokenWorkerResponse): boolean {
  if (response.ok === false) {
    return typeof response.error?.code === 'string'
      && typeof response.error?.message === 'string';
  }

  switch (response.type) {
    case 'registerEncoding':
      return response.result === true;
    case 'countTokens':
      return Number.isFinite(response.result) && response.result >= 0;
    case 'countBatch': {
      const result = response.result;
      return !!result
        && typeof result === 'object'
        && !Array.isArray(result)
        && Object.values(result).every(
          value => Number.isFinite(value) && value >= 0,
        );
    }
  }
}
