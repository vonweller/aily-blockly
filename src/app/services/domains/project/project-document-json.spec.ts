import { canonicalProjectJsonStringify } from './project-document-json';
import { canonicalJsonStringify, createDefaultProjectDataCodecRegistry } from './project-data/project-data-codec.registry';

describe('deep Blockly document canonical snapshots', () => {
  it('preserves existing canonical bytes for object keys, arrays, primitives and null-prototype dictionaries', () => {
    const shared = {b: 2, a: -0};
    for (const value of [null, '字符😀', [true, 12.3, shared], {z: shared, a: shared},
      JSON.parse('{"10":1,"2":2,"01":3,"4294967295":4,"__proto__":{"ok":true},"a/b~":0}'),
      Object.assign(Object.create(null), {z: 2, a: 1}), new Array(4)]) {
      expect(canonicalProjectJsonStringify(value)).toBe(canonicalJsonStringify(value));
    }
  });
  it('serializes 12000 next-connected blocks iteratively while retaining the resource codec depth limit', async () => {
    let block: any = {type: 'text', id: 'tail'};
    for (let index = 0; index < 12000; index++) block = {type: 'statement', id: `b${index}`, next: {block}};
    const document = {pages: [{content: {blocks: {blocks: [block]}}}]};
    const text = canonicalProjectJsonStringify(document);
    expect(text.match(/"type":/g)!.length).toBe(12001);
    expect(text).toContain('"id":"tail"');
    expect(() => canonicalJsonStringify(document)).toThrow();
    await expectAsync(createDefaultProjectDataCodecRegistry().get('canonical-json-v1').encode(document)).toBeRejected();
  });
  it('rejects cycles, unsupported values and excess depth without losing the cycle location', () => {
    const cycle: any = {}; cycle['loop/~'] = cycle;
    expect(() => canonicalProjectJsonStringify(cycle)).toThrowError(/\$\/loop~1~0/);
    for (const value of [undefined, {x: undefined}, [NaN], Infinity, new Date(), {x: 1n}, {x: () => 1}]) {
      expect(() => canonicalProjectJsonStringify(value)).toThrow();
    }
    let deep: any = 0; for (let i = 0; i < 32770; i++) deep = [deep];
    expect(() => canonicalProjectJsonStringify(deep)).toThrowError(/complexity limit/);
  });
});
