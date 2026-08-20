/**
 * Tiktoken Web Worker
 *
 * 一个 Worker 缓存多个编码器。每个请求显式携带 encoding，避免模型切换与
 * Worker 消息乱序时使用错误的编码器。
 */

/// <reference lib="webworker" />

import type {
  TiktokenEncoding,
  TiktokenWorkerErrorCode,
  TiktokenWorkerRequest,
  TiktokenWorkerResponse,
} from './tiktoken-worker-protocol';

interface TiktokenInstance {
  encode(text: string): number[];
}

class WorkerRequestError extends Error {
  constructor(
    readonly code: TiktokenWorkerErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const encoders = new Map<TiktokenEncoding, TiktokenInstance>();
const CHUNK_SIZE = 20000;
const CHUNK_THRESHOLD = 50000;

function encodeCount(encoder: TiktokenInstance, text: string): number {
  if (text.length <= CHUNK_THRESHOLD) {
    return encoder.encode(text).length;
  }

  let total = 0;
  for (let index = 0; index < text.length; index += CHUNK_SIZE) {
    total += encoder.encode(text.substring(index, index + CHUNK_SIZE)).length;
  }
  return total;
}

function postResponse(response: TiktokenWorkerResponse): void {
  postMessage(response);
}

function postFailure(
  request: TiktokenWorkerRequest,
  code: TiktokenWorkerErrorCode,
  message: string,
): void {
  postResponse({
    id: request.id,
    epoch: request.epoch,
    type: request.type,
    encoding: request.encoding,
    ok: false,
    error: { code, message },
  });
}

async function registerEncoding(
  request: Extract<TiktokenWorkerRequest, { type: 'registerEncoding' }>,
): Promise<void> {
  if (!encoders.has(request.encoding)) {
    const { Tiktoken } = await import('js-tiktoken/lite');
    if (!encoders.has(request.encoding)) {
      encoders.set(request.encoding, new Tiktoken(request.rankData));
    }
  }

  postResponse({
    id: request.id,
    epoch: request.epoch,
    type: request.type,
    encoding: request.encoding,
    ok: true,
    result: true,
  });
}

function getEncoder(encoding: TiktokenEncoding): TiktokenInstance {
  const encoder = encoders.get(encoding);
  if (!encoder) {
    throw new WorkerRequestError(
      'ENCODING_NOT_REGISTERED',
      `Encoding not registered: ${encoding}`,
    );
  }
  return encoder;
}

addEventListener('message', async (event: MessageEvent<TiktokenWorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case 'registerEncoding':
        await registerEncoding(request);
        return;

      case 'countTokens': {
        const encoder = getEncoder(request.encoding);
        postResponse({
          id: request.id,
          epoch: request.epoch,
          type: request.type,
          encoding: request.encoding,
          ok: true,
          result: encodeCount(encoder, request.text),
        });
        return;
      }

      case 'countBatch': {
        const encoder = getEncoder(request.encoding);
        const results: Record<string, number> = {};
        for (const item of request.items) {
          // 重复 id 保持既有“后项覆盖前项”语义。
          results[item.id] = encodeCount(encoder, item.text);
        }
        postResponse({
          id: request.id,
          epoch: request.epoch,
          type: request.type,
          encoding: request.encoding,
          ok: true,
          result: results,
        });
        return;
      }
    }
  } catch (error) {
    const workerError = error instanceof WorkerRequestError
      ? error
      : new WorkerRequestError(
        request.type === 'registerEncoding' ? 'ENCODER_INIT_FAILED' : 'ENCODE_FAILED',
        error instanceof Error ? error.message : String(error),
      );
    postFailure(request, workerError.code, workerError.message);
  }
});
