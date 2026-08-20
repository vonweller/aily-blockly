import {
  hasValidTiktokenWorkerResult,
  isTiktokenWorkerResponse,
  type TiktokenWorkerResponse,
} from './tiktoken-worker-protocol';

describe('tiktoken Worker protocol', () => {
  it('accepts a valid count response', () => {
    const response: TiktokenWorkerResponse = {
      id: 1,
      epoch: 2,
      type: 'countTokens',
      encoding: 'o200k_base',
      ok: true,
      result: 42,
    };

    expect(isTiktokenWorkerResponse(response)).toBeTrue();
    expect(hasValidTiktokenWorkerResult(response)).toBeTrue();
  });

  it('rejects a malformed success payload for its operation', () => {
    const response = {
      id: 1,
      epoch: 2,
      type: 'countTokens',
      encoding: 'o200k_base',
      ok: true,
      result: true,
    } as unknown as TiktokenWorkerResponse;

    expect(isTiktokenWorkerResponse(response)).toBeTrue();
    expect(hasValidTiktokenWorkerResult(response)).toBeFalse();
  });

  it('accepts structured request failures', () => {
    const response: TiktokenWorkerResponse = {
      id: 3,
      epoch: 4,
      type: 'countBatch',
      encoding: 'cl100k_base',
      ok: false,
      error: {
        code: 'ENCODING_NOT_REGISTERED',
        message: 'missing',
      },
    };

    expect(hasValidTiktokenWorkerResult(response)).toBeTrue();
  });

  it('rejects unknown operations and encodings at the protocol boundary', () => {
    expect(isTiktokenWorkerResponse({
      id: 1,
      epoch: 1,
      type: 'unknown',
      encoding: 'o200k_base',
      ok: true,
    })).toBeFalse();
    expect(isTiktokenWorkerResponse({
      id: 1,
      epoch: 1,
      type: 'countTokens',
      encoding: 'unknown',
      ok: true,
    })).toBeFalse();
  });

  it('rejects a null batch result without throwing', () => {
    const response = {
      id: 1,
      epoch: 1,
      type: 'countBatch',
      encoding: 'o200k_base',
      ok: true,
      result: null,
    } as unknown as TiktokenWorkerResponse;

    expect(() => hasValidTiktokenWorkerResult(response)).not.toThrow();
    expect(hasValidTiktokenWorkerResult(response)).toBeFalse();
  });
});
