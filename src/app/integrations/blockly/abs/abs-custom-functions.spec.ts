import { captureAbsCustomFunctions } from './abs-custom-functions';
import { absJson, createAbsProjection, indexAbsAbi } from './abs-identity-map';
import { reconcileAbsDraft } from './abs-reconciler';
import { assertAbsRuntimeShapeSupported } from './abs-workspace-state';
import { getAbsProcedureReferences } from './abs-procedures';
import type { DeclarativeBlockSnapshot } from '../../../editors/blockly-editor/services/blockly-declarative-block-catalog';

describe('pure typed custom-function preparation', () => {
  const json = { type: 'custom_function_def', mutator: 'function_params_mutator', args0: [
    { type: 'field_input', name: 'FUNC_NAME', text: 'myFunction' },
    { type: 'field_dropdown', name: 'RETURN_TYPE', options: [['void', 'void'], ['int', 'int'], ['float', 'float'], ['---', '---']] },
    { type: 'input_statement', name: 'STACK' }] };
  const kinds = { custom_function_def: 'definition', custom_function_call_advance: 'statement-call', custom_function_call_return_advance: 'value-call' } as const;
  const snapshot: DeclarativeBlockSnapshot = { types: Object.keys(kinds), registered: type => !!kinds[type], assertCurrent() {}, get: type => type === json.type ? json : undefined,
    customFunctions: { get: type => kinds[type] && { kind: kinds[type], parameterTypes: ['int', 'float'] }, assertCurrent() {}, synchronize() {}, prepareSerialization() {} } };
  const adapter = captureAbsCustomFunctions(snapshot), empty = { blocks: { blocks: [] } };
  const base = (workspace: any = empty, contracts = { fields: {} }) => createAbsProjection(workspace, { document: workspace, contracts,
    generation: 'g', baselineRef: 'r', scope: { projectKey: 'p', pageId: 'main' }, savedAbiHash: null });
  const def = 'custom_function_def(FUNC_NAME="work", RETURN_TYPE="int") @extra:{"params":[{"name":"amount","type":"int"}]}';
  const call = 'custom_function_call_return_advance(FUNC_NAME="work") @extra:{"params":[{"name":"amount","type":"int"}]}';
  const create = [{ name: 'work', type: 'FUNC' }, { name: 'amount' }];
  const run = async (source = def + '\n' + call, baseline?: Awaited<ReturnType<typeof base>>, variables: any[] | null = baseline ? null : create) => {
    const before = baseline ?? await base();
    const result = await reconcileAbsDraft(before, '# ABS Schema: 2\n' + source, { fieldDefinition: adapter.field,
      prepareBlock: adapter.prepare, ...(variables ? { variableCreation: { requestId: 'custom-function-test', variables } } : {}) });
    assertAbsRuntimeShapeSupported(before.workspace, result.workspace, result.contracts, adapter.get);
    return result;
  };
  it('prepares explicit function/parameter models, native fields and complete reference paths', async () => {
    const result = await run(), [definition, caller] = result.workspace.blocks.blocks;
    expect((definition.extraState as any).funcVarId).toBe('abs-variable:custom-function-test:0');
    expect((definition.extraState as any).paramVarIds).toEqual(['abs-variable:custom-function-test:1']);
    expect(definition.fields!['PARAM_NAME0']).toBe('amount'); expect(caller.fields!['FUNC_NAME']).toEqual({ id: 'abs-variable:custom-function-test:0' });
    const refs = getAbsProcedureReferences(result.workspace, result.contracts.procedures);
    expect(refs.some(ref => ref.statePath === '/extraState/paramVarIds/0')).toBeTrue();
    expect(refs.some(ref => ref.kind === 'procedure' && ref.modelId === definition.id)).toBeTrue();
  });
  it('preserves identities across repeated edits, type changes and parameter removal without deleting models', async () => {
    const first = await run(), before = await base(first.workspace, first.contracts);
    const changed = await run(before.abs.replaceAll('"type":"int"', '"type":"float"'), before, undefined);
    expect([...indexAbsAbi(changed.workspace).keys()]).toEqual([...indexAbsAbi(first.workspace).keys()]);
    expect((changed.workspace.blocks.blocks[0].extraState as any).paramVarIds).toEqual((first.workspace.blocks.blocks[0].extraState as any).paramVarIds);
    const canonical = await base(changed.workspace, changed.contracts);
    const removed = await run(canonical.abs.replaceAll('"params":[{"name":"amount","type":"float"}]', '"params":[]'), canonical, undefined);
    expect(removed.workspace['variables']).toEqual(first.workspace['variables']);
    expect(removed.workspace.blocks.blocks[0].fields!['PARAM_NAME0']).toBeUndefined();
  });
  it('requires explicit model creation and leaves inputs untouched after rejection', async () => {
    const before = await base(), original = absJson(before);
    await expectAsync(run(def + '\n' + call, before, undefined)).toBeRejected();
    expect(absJson(before)).toBe(original);
  });
  it('rejects supplied IDs, unknown serializer members and conflicting derived fields', async () => {
    for (const source of [def.replace('"params":', '"funcVarId":"forged","params":'),
      def.replace('"params":', '"paramVarIds":[],"params":'), def.replace('"params":', '"opaque":1,"params":'),
      def.replace('RETURN_TYPE="int"', 'RETURN_TYPE="int", PARAM_NAME0="wrong"'),
      def.replace('"type":"int"', '"type":"---"'), def.replace('RETURN_TYPE="int"', 'RETURN_TYPE="---"')]) {
      await expectAsync(run(source)).toBeRejected();
    }
  });
  it('rejects dangling calls, mismatched typed signatures and value calls to void definitions', async () => {
    for (const source of [call, def + '\n' + call.replace('"type":"int"', '"type":"float"'),
      def.replace('RETURN_TYPE="int"', 'RETURN_TYPE="void"') + '\n' + call]) await expectAsync(run(source)).toBeRejected();
  });
  it('allows a statement call to deliberately discard a function result', async () => {
    const result = await run(def + '\n' + call.replace('custom_function_call_return_advance', 'custom_function_call_advance'));
    expect(result.workspace.blocks.blocks.length).toBe(2);
  });
  it('does not promote unknown or structurally changed definitions into a custom protocol', () => {
    expect(captureAbsCustomFunctions({ ...snapshot, customFunctions: undefined }).describe('custom_function_def')).toBeUndefined();
    expect(captureAbsCustomFunctions({ ...snapshot, get: () => ({ ...json, args1: [{ type: 'field_custom', name: 'OPAQUE' }] }) }).describe('custom_function_def')).toBeUndefined();
  });
});
