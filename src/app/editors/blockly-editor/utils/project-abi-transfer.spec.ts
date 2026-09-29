import { needsMainThreadAbiParse } from './project-abi-transfer';

describe('deep ABI worker transport selection', () => {
  it('keeps wide documents in the worker but avoids structured clone for deep chains', () => {
    expect(needsMainThreadAbiParse(JSON.stringify({blocks: Array.from({length: 9000}, (_, id) => ({type: 'text', id}))}))).toBeFalse();
    expect(needsMainThreadAbiParse('['.repeat(512) + '0' + ']'.repeat(512))).toBeFalse();
    const deep = '['.repeat(2400) + '0' + ']'.repeat(2400);
    expect(needsMainThreadAbiParse(deep)).toBeTrue();
    expect(() => JSON.parse(deep)).not.toThrow();
  });
  it('ignores brackets inside escaped strings and leaves malformed JSON to the parser', () => {
    expect(needsMainThreadAbiParse(JSON.stringify({text: '\\"' + '[{"'.repeat(5000)}))).toBeFalse();
    expect(needsMainThreadAbiParse('{"invalid":')).toBeFalse();
  });
});
