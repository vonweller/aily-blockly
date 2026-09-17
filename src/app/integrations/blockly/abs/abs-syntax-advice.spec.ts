import { describePreparedAbsSyntax } from './abs-syntax-advice';

describe('prepared ABS syntax advice', () => {
  it('uses actual namespaces and options, never payloads or persisted IDs', () => {
    const state = { blocks: { blocks: [{ id: 'private-id', type: 'example', fields: { TEXT: 'private payload' } }] } };
    const result = describePreparedAbsSyntax(state, { fields: { 'private-id': {
      TEXT: { type: 'field_input' }, MODE: { type: 'field_dropdown', options: [['Display', 'KEY']] },
    } }, syntax: { 'private-id': [{ name: 'TEXT', kind: 'field' }, { name: 'TEXT', kind: 'valueInput' }, { name: 'MODE', kind: 'field' }] } },
    [{ start: 25, id: 'private-id' }]);
    expect(result.authority).toBeFalse(); expect(result.variants[0].sourceStart).toBe(25);
    expect(result.variants[0].argsOrder.length).toBe(3);
    expect(result.variants[0].fields['MODE']).toEqual({ type: 'field_dropdown', options: ['KEY'], optionsTruncated: false });
    expect(JSON.stringify(result)).not.toMatch(/private|Display/);
  });

  it('deduplicates shapes and explicitly bounds advice without authorizing omitted variants', () => {
    const blocks = Array.from({ length: 40 }, (_, i) => ({ id: 'b' + i, type: 'type' + i }));
    const result = describePreparedAbsSyntax({ blocks: { blocks } }, {
      fields: {}, syntax: Object.fromEntries(blocks.map(block => [block.id, []])),
    }, blocks.map((block, i) => ({ id: block.id, start: i })));
    expect(result.variants.length).toBe(32); expect(result.truncated).toBeTrue();
  });
});
