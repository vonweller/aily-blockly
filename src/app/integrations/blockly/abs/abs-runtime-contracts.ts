import type * as Blockly from 'blockly';
import { serializeRuntimeFieldContract } from '../../../editors/blockly-editor/services/blockly-runtime-block-metadata';
import { AbsFieldDefinition } from './abs-field-values';
import { AbsAbiWorkspace, AbsProjectionContracts, AbsSyncError, getAbsFieldDefinition } from './abs-state';
import { indexAbsAbi } from './abs-identity-map';
import type { DeclarativeBlockSnapshot } from '../../../editors/blockly-editor/services/blockly-declarative-block-catalog';
import { captureAbsDeclarativeContracts } from './abs-declarative-contracts';

/** Captures existing instances only. No probe blocks, global cache, library edits or Runtime rebuild. */
export function captureAbsRuntimeContracts(
  workspace: Blockly.Workspace, serialized: AbsAbiWorkspace, assertCurrent: () => void, definitions?: DeclarativeBlockSnapshot,
): { contracts: AbsProjectionContracts; fieldDefinition: (type: string, field: string, id?: string) => AbsFieldDefinition | undefined } {
  assertCurrent();
  const states = indexAbsAbi(serialized);
  const contracts: AbsProjectionContracts = { fields: Object.create(null) };
  const declared = definitions && captureAbsDeclarativeContracts(definitions);
  for (const block of workspace.getAllBlocks(false)) {
    const state = states.get(block.id);
    if (!state) continue;
    const fields: Record<string, AbsFieldDefinition> = Object.create(null);
    for (const input of block.inputList) {
      for (const field of input.fieldRow) {
        if (!field.name || field.SERIALIZABLE === false) continue;
        try {
          const runtime = serializeRuntimeFieldContract(field, state.fields?.[field.name]);
          const { variableTypes, ...definition } = runtime;
          fields[field.name] = {
            ...definition,
            ...(runtime.type === 'field_variable' ? { symbol: {
              kind: 'variable' as const, storage: 'variable-state' as const,
              ...(variableTypes ? { allowedTypes: variableTypes } : {}),
            } } : {}),
          };
        } catch (error) {
          throw new AbsSyncError('ABS_FIELD_CONTRACT_UNAVAILABLE', `${block.type}.${field.name}: ${String(error)}`, undefined, [block.id]);
        }
        assertCurrent();
      }
    }
    contracts.fields[block.id] = fields;
    // Static JSON provides original args order; visual inputList order is not equivalent.
    const order = declared?.get(block.type, state.extraState)?.argumentOrder;
    if (order && Object.keys(fields).every(name => order.some(arg => arg.kind === 'field' && arg.name === name))
      && Object.keys(state.inputs ?? {}).every(name => order.some(arg => arg.kind !== 'field' && arg.name === name))) {
      (contracts.syntax ??= Object.create(null))[block.id] = order;
    }
  }
  assertCurrent();
  return {
    contracts,
    fieldDefinition: (type, field, id) => {
      assertCurrent();
      if (!id) return undefined; // New blocks need host/static definitions, not another block's dynamic options.
      if (states.get(id)?.type !== type) throw new AbsSyncError('ABS_FIELD_CONTRACT_UNAVAILABLE', 'Field contract belongs to a different block.');
      return getAbsFieldDefinition(contracts, id, field);
    },
  };
}
