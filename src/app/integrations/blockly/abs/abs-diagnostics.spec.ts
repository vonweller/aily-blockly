import { restoreAbsFailure, serializeAbsFailure } from './abs-diagnostics';
import { AbsSyncError } from './abs-state';
import { AbsSymbols } from './abs-symbols';
import { resolveAbsFieldValue, readAbsFieldToken } from './abs-field-values';
import { AbsGenerationToolsService } from './abs-generation-tools.service';
import { createAbsProjection } from './abs-identity-map';
import { reconcileAbs } from './abs-reconciler';
import { assertAbsProtectedBlocks } from './abs-import-policy';

describe('ABS actionable diagnostic contract', () => {
  it('identifies the protected root across the wire without exposing private IDs', () => {
    const root = { type: 'arduino_global', id: 'private-root', deletable: false };
    for (const [blocks, code] of [
      [[], 'ABS_PROTECTED_BLOCK_MISSING'],
      [[{ ...root, type: 'arduino_loop' }], 'ABS_PROTECTED_BLOCK_TYPE_CHANGED'],
      [[{ ...root, deletable: true }], 'ABS_PROTECTED_BLOCK_UNLOCK'],
    ] as const) {
      try {
        assertAbsProtectedBlocks({ blocks: { blocks: [root] } }, { blocks: { blocks: [...blocks] } });
        fail('accepted protected root mutation');
      } catch (error) {
        const wire = serializeAbsFailure(error);
        expect(wire.code).toBe(code);
        expect(wire.diagnostic!.blockType).toBe('arduino_global');
        expect(wire.diagnostic!.hint).toContain('including empty roots');
        expect(JSON.stringify(wire)).not.toContain('private-root');
      }
    }
    expect(() => assertAbsProtectedBlocks({ blocks: { blocks: [root] } }, { blocks: { blocks: [root] } })).not.toThrow();
  });
  it('preserves the identity reason and specific recovery guidance through the wire boundary', async () => {
    const sync = { exportGeneration: async () => {
      throw new AbsSyncError('ABS_IDENTITY_AMBIGUOUS', 'Identity is ambiguous', { start: 4, end: 8 }, [], {
        blockType: 'step', reason: 'indistinguishable-relocation', received: 2,
        hint: 'Preserve call tokens; changing literals or querying block_info cannot repair identity.',
        identity: { evidence: 'tracked', batches: 1, edits: 2, baselineCount: 1, candidateCount: 2,
          baselineRanges: [{ start: 5, end: 9 }], candidateRanges: [{ start: 4, end: 8 }, { start: 11, end: 15 }],
          replacedBaselineRanges: [{ start: 5, end: 9 }] },
      });
    } };
    const result: any = await new AbsGenerationToolsService(sync as any).execute('abs_projection', {
      version: 2, requestId: 'identity-diagnostic-request', expectedAbiHash: 'sha256:' + 'a'.repeat(64),
    }, 'abc\nstep()');
    expect(result.ok).toBeFalse(); expect(result.receipt).toBeUndefined();
    expect(result.diagnostic.reason).toBe('indistinguishable-relocation');
    expect(result.recovery).toBe(result.diagnostic.hint);
    expect(result.location).toEqual({ line: 2, column: 1 });
    expect(result.diagnostic.identity.baselineRanges).toEqual([{ start: 5, end: 9 }]);
    expect(result.diagnostic.identity.candidateCount).toBe(2);
  });
  it('preserves the same diagnostic in the pure existing-block reconciliation path', async () => {
    const baseline = await createAbsProjection({ blocks: { blocks: [{ type: 'device', id: 'b', fields: { PIN: 'D0' } }] } }, {
      contracts: { fields: { b: { PIN: { type: 'field_dropdown', options: [['D0', 'D0'], ['D3', 'D3']] } } } },
      document: null, generation: 'g1', baselineRef: 'base', savedAbiHash: null, scope: { projectKey: 'test', pageId: 'main' },
    });
    const source = baseline.abs.replace('PIN=D0', 'PIN=3');
    expect(source).not.toBe(baseline.abs);
    await expectAsync(reconcileAbs(baseline, source)).toBeRejectedWith(jasmine.objectContaining({
      code: 'ABS_FIELD_OPTION_INVALID', diagnostic: jasmine.objectContaining({
        blockType: 'device', field: 'PIN', received: 3, allowedValues: ['D0', 'D3'],
      }),
    }));
    expect(baseline.workspace.blocks.blocks[0].fields!['PIN']).toBe('D0');
  });
  it('returns a failed tool result with line/column and no success receipt', async () => {
    const sync = { exportGeneration: async () => {
      throw new AbsSyncError('ABS_FIELD_OPTION_INVALID', 'Wrong pin', { start: 4, end: 5 }, [],
        { blockType: 'device', field: 'PIN', received: 3, allowedValues: ['D3'] });
    } };
    const result: any = await new AbsGenerationToolsService(sync as any).execute('abs_projection', {
      version: 2, requestId: 'test-diagnostic-request', expectedAbiHash: 'sha256:' + 'a'.repeat(64),
    }, 'abc\n3');
    expect(result.ok).toBeFalse(); expect(result.code).toBe('ABS_FIELD_OPTION_INVALID');
    expect(result.location).toEqual({ line: 2, column: 1 });
    expect(result.diagnostic.allowedValues).toEqual(['D3']); expect(result.receipt).toBeUndefined();
  });
  it('retains typed error data across a data-only boundary without unknown properties', () => {
    const error = new AbsSyncError('ABS_FIELD_OPTION_INVALID', 'Wrong pin', { start: 2, end: 3 }, ['private-id'],
      { blockType: 'device', field: 'PIN', received: 3, allowedValues: ['D0', 'D3'] });
    const wire = serializeAbsFailure(error), restored = restoreAbsFailure(JSON.parse(JSON.stringify(wire)));
    expect(restored.code).toBe(error.code);
    expect(restored.diagnostic).toEqual(error.diagnostic);
    expect(restored.range).toEqual(error.range);
    expect(JSON.stringify(wire)).not.toContain('private-id');
    expect(restored instanceof Error).toBeTrue();
  });

  it('bounds third-party payloads and rejects injected properties/invalid ranges', () => {
    const wire = serializeAbsFailure({ code: 'library-code', message: 'x'.repeat(5000), range: { start: -1, end: 3 },
      diagnostic: { field: 'x'.repeat(500), allowedValues: Array(200).fill('a'), expectedTypes: [1, 'T'],
        received: { huge: 'payload' }, receipt: 'fake' }, receipt: 'fake' });
    expect(wire.code).toBe('ABS_GENERATION_FAILED'); expect(wire.message.length).toBe(2000);
    expect(wire.range).toBeUndefined(); expect(wire.diagnostic!.field!.length).toBe(256);
    expect(wire.diagnostic!.allowedValues!.length).toBe(64); expect(wire.diagnostic!.truncated).toBeTrue();
    expect(wire.diagnostic!.expectedTypes).toEqual(['T']); expect(wire.diagnostic!.received).toBeUndefined();
    expect(JSON.stringify(wire)).not.toContain('fake');
  });

  it('bounds identity evidence and strips source, IDs and malformed ranges', () => {
    const identity = { evidence: 'tracked', batches: 1, edits: 2, baselineCount: 100, candidateCount: 100,
      baselineRanges: Array(100).fill({ start: 1, end: 5, id: 'private-id' }),
      candidateRanges: [{ start: -1, end: 0 }, { start: 5, end: 2 }, { start: 2, end: 6, text: 'private-source' }],
      replacedBaselineRanges: [], source: 'private-source' };
    const wire = serializeAbsFailure({ diagnostic: { identity } });
    expect(wire.diagnostic!.identity!.baselineRanges.length).toBe(8);
    expect(wire.diagnostic!.identity!.baselineCount).toBe(100);
    expect(wire.diagnostic!.identity!.candidateRanges).toEqual([{ start: 2, end: 6 }]);
    expect(wire.diagnostic!.truncated).toBeTrue();
    expect(JSON.stringify(wire)).not.toContain('private-');
    for (const value of [{ ...identity, evidence: 'forged' }, { ...identity, batches: -1 }, { ...identity, edits: NaN }]) {
      expect(serializeAbsFailure({ diagnostic: { identity: value } }).diagnostic).toBeUndefined();
    }
  });

  it('gives exact pin choices without converting numeric pins to board aliases', () => {
    try { resolveAbsFieldValue(readAbsFieldToken('3'), { type: 'field_dropdown', options: [['pin 3', 'D3']] }); fail('accepted'); }
    catch (error) {
      const wire = serializeAbsFailure(error);
      expect(wire.code).toBe('ABS_FIELD_OPTION_INVALID');
      expect(wire.diagnostic).toEqual(jasmine.objectContaining({ received: 3, allowedValues: ['D3'] }));
    }
  });

  it('distinguishes missing models from incompatible same-name types without creating anything', () => {
    const contract = { kind: 'variable' as const, storage: 'id' as const, allowedTypes: ['SENSOR'] };
    const models = [{ id: 'id', name: 'sensor', type: '' }];
    const symbols = new AbsSymbols({ blocks: { blocks: [] }, variables: models }, null, { fields: {} });
    for (const [name, code, actualTypes] of [['sensor', 'ABS_SYMBOL_TYPE_MISMATCH', ['']], ['missing', 'ABS_SYMBOL_MISSING', []]] as const) {
      try { symbols.resolve(readAbsFieldToken('$' + name), contract); fail('accepted'); }
      catch (error) {
        const wire = serializeAbsFailure(error);
        expect(wire.code).toBe(code);
        expect(wire.diagnostic).toEqual(jasmine.objectContaining({ modelName: name, expectedTypes: ['SENSOR'], actualTypes }));
      }
    }
    expect(models).toEqual([{ id: 'id', name: 'sensor', type: '' }]);
  });
});
