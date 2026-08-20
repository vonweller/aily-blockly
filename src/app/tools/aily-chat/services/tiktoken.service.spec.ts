import { TiktokenService } from './tiktoken.service';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createEncoder(tokenCount: (text: string) => number) {
  return {
    encode: jasmine.createSpy('encode').and.callFake((text: string) =>
      Array.from({ length: tokenCount(text) }, (_, index) => index)),
    decode: jasmine.createSpy('decode').and.returnValue('decoded'),
  };
}

function createArtifact(encoding: 'o200k_base' | 'cl100k_base', encoder: unknown) {
  return {
    encoding,
    encoder,
    rankData: {
      pat_str: '',
      special_tokens: {},
      bpe_ranks: '',
    },
    source: 'local',
  };
}

describe('TiktokenService', () => {
  let service: TiktokenService;
  let registerWorkerSpy: jasmine.Spy;

  beforeEach(() => {
    service = new TiktokenService();
    registerWorkerSpy = spyOn<any>(service, 'registerWorkerEncoding')
      .and.returnValue(Promise.resolve());
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  it('does not load before the startup model selection is initialized', async () => {
    const loadSpy = spyOn<any>(service, 'loadEncodingArtifact');

    expect(await service.waitForReady()).toBeFalse();
    expect(loadSpy).not.toHaveBeenCalled();
    expect(service.countTokens('abcd')).toBe(1);
  });

  it('shares one load for concurrent requests of the same encoding', async () => {
    const load = deferred<any>();
    const encoder = createEncoder(() => 2);
    const loadSpy = spyOn<any>(service, 'loadEncodingArtifact')
      .and.returnValue(load.promise);

    const first = service.switchEncoderForModel('gpt-4o');
    const second = service.switchEncoderForModel('claude-4-sonnet');

    expect(loadSpy.calls.count()).toBe(1);
    load.resolve(createArtifact('o200k_base', encoder));
    await Promise.all([first, second]);

    expect(service.isReady).toBeTrue();
    expect(service.activeEncodingName).toBe('o200k_base');
    expect(service.getStats().loadDedupHits).toBe(1);
  });

  it('loads a different encoder instead of reusing the active instance', async () => {
    const o200k = createEncoder(() => 2);
    const cl100k = createEncoder(() => 5);
    const loadSpy = spyOn<any>(service, 'loadEncodingArtifact')
      .and.callFake((encoding: 'o200k_base' | 'cl100k_base') => Promise.resolve(
        createArtifact(encoding, encoding === 'o200k_base' ? o200k : cl100k),
      ));

    await service.switchEncoderForModel('gpt-4o');
    expect(service.countTokens('hello')).toBe(2);

    await service.switchEncoderForModel('gpt-4-turbo');
    expect(service.activeEncodingName).toBe('cl100k_base');
    expect(service.countTokens('hello')).toBe(5);

    await service.switchEncoderForModel('gpt-4o');
    expect(service.activeEncodingName).toBe('o200k_base');
    expect(loadSpy.calls.count()).toBe(2);
  });

  it('allows only the latest revision to activate after out-of-order loads', async () => {
    const oLoad = deferred<any>();
    const clLoad = deferred<any>();
    const loadSpy = spyOn<any>(service, 'loadEncodingArtifact')
      .and.callFake((encoding: 'o200k_base' | 'cl100k_base') =>
        encoding === 'o200k_base' ? oLoad.promise : clLoad.promise);

    const firstO = service.switchEncoderForModel('gpt-4o');
    const cl = service.switchEncoderForModel('gpt-4-turbo');
    const latestO = service.switchEncoderForModel('qwen-plus');

    expect(loadSpy.calls.count()).toBe(2);
    clLoad.resolve(createArtifact('cl100k_base', createEncoder(() => 3)));
    await cl;
    expect(service.encodingName).toBe('o200k_base');
    expect(service.activeEncodingName).toBeNull();

    oLoad.resolve(createArtifact('o200k_base', createEncoder(() => 4)));
    await Promise.all([firstO, latestO]);
    expect(service.activeEncodingName).toBe('o200k_base');
    expect(service.countTokens('hello')).toBe(4);
  });

  it('uses fallback and hides encode/decode while a new encoding is loading', async () => {
    const clLoad = deferred<any>();
    spyOn<any>(service, 'loadEncodingArtifact')
      .and.callFake((encoding: 'o200k_base' | 'cl100k_base') =>
        encoding === 'o200k_base'
          ? Promise.resolve(createArtifact(encoding, createEncoder(() => 99)))
          : clLoad.promise);

    await service.switchEncoderForModel('gpt-4o');
    const switching = service.switchEncoderForModel('gpt-4-turbo');

    expect(service.countTokens('abcd')).toBe(1);
    expect(service.encode('abcd')).toEqual([]);
    expect(service.decode([1, 2])).toBe('');

    clLoad.resolve(createArtifact('cl100k_base', createEncoder(() => 3)));
    await switching;
  });

  it('keeps the main-thread encoder ready when Worker registration fails', async () => {
    spyOn(console, 'warn');
    registerWorkerSpy.and.returnValue(Promise.reject(new Error('Worker unavailable')));
    spyOn<any>(service, 'loadEncodingArtifact').and.returnValue(Promise.resolve(
      createArtifact('o200k_base', createEncoder(() => 2)),
    ));

    await service.switchEncoderForModel('gpt-4o');
    await Promise.resolve();

    expect(service.isReady).toBeTrue();
    expect(service.countTokens('hello')).toBe(2);
  });

  it('keeps last-item-wins semantics for duplicate batch ids', async () => {
    spyOn<any>(service, 'loadEncodingArtifact').and.returnValue(Promise.resolve(
      createArtifact('o200k_base', createEncoder(text => text.length)),
    ));
    await service.switchEncoderForModel('gpt-4o');

    const result = await service.countBatchAsync([
      { id: 'same', text: 'a' },
      { id: 'same', text: 'abcd' },
    ]);

    expect(result.get('same')).toBe(4);
    expect(result.size).toBe(1);
  });
});
