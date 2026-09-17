import type * as Blockly from 'blockly';
import type { NativeVariableState } from './blockly-native-candidate-protocol';
import { assertAbsReadback } from '../../../integrations/blockly/abs/abs-readback';
import { AbsSymbols } from '../../../integrations/blockly/abs/abs-symbols';
import type { AbsFieldDefinition, AbsFieldToken } from '../../../integrations/blockly/abs/abs-field-values';

/** Owned inputs only. Native callbacks may reuse a model, never invent or rename one. */
export class NativeCandidateModels {
  private readonly expected: NativeVariableState[];
  private readonly symbols: AbsSymbols;

  constructor(readonly workspace: Blockly.Workspace, variables: readonly NativeVariableState[] = []) {
    this.expected = structuredClone([...variables]);
    this.symbols = new AbsSymbols({ blocks: { blocks: [] }, variables: this.expected }, null, { fields: {} });
  }

  load(): void {
    for (const variable of this.expected) this.workspace.createVariable(variable.name, variable.type ?? '', variable.id);
    this.assertCurrent();
  }

  resolve(token: AbsFieldToken, definition: AbsFieldDefinition): unknown {
    return this.symbols.resolve(token, definition.symbol!);
  }

  assertCurrent(serialized?: unknown): void {
    const actual = serialized ?? this.workspace.getAllVariables().map(model => ({ id: model.getId(), name: model.name, type: model.type }));
    try {
      assertAbsReadback({ blocks: { blocks: [] }, variables: this.expected }, { blocks: { blocks: [] }, variables: actual });
    } catch (error) {
      throw new Error(`Native candidate changed unrequested blocks or models (variable ownership): ${String(error)}`);
    }
  }
}
