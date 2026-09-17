import { createAbsProjection, indexAbsAbi } from './abs-identity-map';
import { reconcileAbs } from './abs-reconciler';
import { assertAbsSourceEdits, type AbsSourceEdits } from './abs-edit-provenance';
import type { AbsAbiWorkspace } from './abs-state';

describe('batch ABS text-edit identity', () => {
  const project = (workspace: AbsAbiWorkspace) => createAbsProjection(workspace, { document: workspace,
    generation: 'batch', baselineRef: 'batch', scope: { projectKey: 'test', pageId: 'main' }, savedAbiHash: null });
  const setup = async () => project({ blocks: { blocks: [{ type: 'container', id: 'root', deletable: false,
    inputs: { BODY: { block: { type: 'thing', id: 'first', deletable: false, data: 'first metadata', fields: { VALUE: 'one' },
      next: { block: { type: 'thing', id: 'second', data: 'second metadata', fields: { VALUE: 'two' } } } } } } }] } });
  const edit = (source: string, old: string, text: string) => {
    const start = source.indexOf(old);
    if (start < 0) throw new Error('Fixture edit target is absent: ' + old);
    return { start, end: start + old.length, text };
  };
  const apply = (source: string, edits: AbsSourceEdits) => edits.reduce((value, batch) => [...batch].reverse()
    .reduce((value, e) => value.slice(0, e.start) + e.text + value.slice(e.end), value), source);

  it('updates repeated calls in one reconciliation without leaking IDs into ABS', async () => {
    const base = await setup();
    const sourceEdits = [[edit(base.abs, '"one"', '"first changed 😀"'), edit(base.abs, '"two"', '"second changed"')]];
    const source = apply(base.abs, sourceEdits);
    await expectAsync(reconcileAbs(base, source)).toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_IDENTITY_AMBIGUOUS' }));
    const result = await reconcileAbs(base, source, { sourceEdits });
    const blocks = indexAbsAbi(result.workspace);
    expect(result.added).toEqual([]); expect(result.removed).toEqual([]);
    expect(blocks.get('first')!.fields!['VALUE']).toBe('first changed 😀');
    expect(blocks.get('second')!.fields!['VALUE']).toBe('second changed');
    expect(blocks.get('first')!['deletable']).toBeFalse();
    expect(blocks.get('second')!['data']).toBe('second metadata');
    expect(source).not.toContain('@meta');
  });

  it('tracks repeated identical calls through multiple batches and offset shifts', async () => {
    const base = await project({ blocks: { blocks: [
      { type: 'thing', id: 'a', fields: { N: 1 }, data: 'a' }, { type: 'thing', id: 'b', fields: { N: 1 }, data: 'b' },
    ] } });
    const a = base.abs.indexOf('N=1') + 2, b = base.abs.lastIndexOf('N=1') + 2;
    const sourceEdits = [[{ start: a, end: a + 1, text: '100' }, { start: b, end: b + 1, text: '200' }]];
    const intermediate = apply(base.abs, sourceEdits);
    sourceEdits.push([edit(intermediate, '100', '300'), edit(intermediate, '200', '400')]);
    const result = await reconcileAbs(base, apply(base.abs, sourceEdits), { sourceEdits });
    expect(result.workspace.blocks.blocks.map(block => [block.id, block.fields!['N'], block['data']])).toEqual([['a', 300, 'a'], ['b', 400, 'b']]);
  });

  it('retains unaffected tokens when inserting a distinct new call', async () => {
    const base = await setup();
    const at = base.abs.indexOf('thing(');
    const indent = base.abs.slice(base.abs.lastIndexOf('\n', at) + 1, at);
    const sourceEdits = [[{ start: at, end: at, text: 'new_kind()\n' + indent }, edit(base.abs, '"one"', '"new one"'), edit(base.abs, '"two"', '"new two"')]];
    const result = await reconcileAbs(base, apply(base.abs, sourceEdits), { sourceEdits, newId: () => 'new' });
    expect(result.added).toEqual(['new']); expect(result.retained).toContain('first'); expect(result.retained).toContain('second');
  });

  it('never accepts stale or out-of-range provenance, even for unchanged source', async () => {
    const base = await setup();
    for (const sourceEdits of [[[{ start: 0, end: 0, text: 'wrong' }]], [[{ start: 0, end: base.abs.length + 1, text: '' }]]]) {
      await expectAsync(reconcileAbs(base, base.abs, { sourceEdits })).toBeRejected();
    }
  });

  it('does not use full replacements as positional identity evidence', async () => {
    const base = await setup(), source = base.abs.replace('"one"', '"a"').replace('"two"', '"b"');
    await expectAsync(reconcileAbs(base, source, { sourceEdits: [[{ start: 0, end: base.abs.length, text: source }]] }))
      .toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_IDENTITY_AMBIGUOUS' }));
  });

  it('keeps protected deletion forbidden with valid text provenance', async () => {
    const base = await setup(), source = '# ABS Schema: 2\ncontainer()';
    await expectAsync(reconcileAbs(base, source, { sourceEdits: [[{ start: 0, end: base.abs.length, text: source }]] }))
      .toBeRejectedWith(jasmine.objectContaining({ code: 'PROTECTED_BLOCK_MISSING' }));
  });

  it('bounds malformed, overlapping and excessive histories', () => {
    for (const value of [null, [], [[{ start: -1, end: 0, text: '' }]], [[{ start: 2, end: 1, text: '' }]],
      [[{ start: 0, end: 3, text: '' }, { start: 2, end: 4, text: '' }]],
      Array.from({ length: 129 }, () => [{ start: 0, end: 0, text: 'x' }]), [[{ start: 0, end: 0, text: 'x'.repeat(512 * 1024 + 1) }]]]) {
      expect(() => assertAbsSourceEdits(value)).toThrow();
    }
  });

  it('does not transfer metadata across parents based on surviving text alone', async () => {
    const base = await project({ blocks: { blocks: [{ type: 'container', id: 'root', inputs: {
      BODY: { block: { type: 'thing', id: 'child', fields: { N: 1 } } },
    } }] } });
    const sourceEdits = [[edit(base.abs, 'BODY=', 'OTHER=')]];
    await expectAsync(reconcileAbs(base, apply(base.abs, sourceEdits), { sourceEdits }))
      .toBeRejectedWith(jasmine.objectContaining({ code: 'ABS_IDENTITY_AMBIGUOUS' }));
  });
});
