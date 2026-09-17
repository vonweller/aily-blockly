import type * as Blockly from 'blockly';
import { AbsSyncError, type AbsSyntaxNode } from '../../../integrations/blockly/abs/abs-state';
import type { AbsNativeModelDeclaration } from '../../../integrations/blockly/abs/abs-native-model-declarations';
import type { NativeCandidateWorkspace } from './blockly-native-candidate-workspace';
import { withNativeModelRegistrations } from './blockly-native-model-effects';

/** A bounded preparation pass, not speculative full code generation. Invoke real
 * generators only for configured subtrees, before binding unresolved references.
 * No fake dropdown value, empty consumer code or missing-reference-created model.
 * The final fresh realm must reproduce each registration with the complete ABI. */
export function prepareNativeModels(execution: NativeCandidateWorkspace, generator: Blockly.Generator,
  blocks: ReadonlyMap<AbsSyntaxNode, Blockly.Block>, unresolved: ReadonlySet<Blockly.Block>, requestId: string): AbsNativeModelDeclaration[] {
  const nodes = new Map([...blocks].map(([node, block]) => [block, node]));
  const disabled = (block: Blockly.Block): boolean => {
    for (let current: Blockly.Block | null = block; current; current = current.getParent()) if (nodes.get(current)?.disabled) return true;
    return false;
  };
  const declarations = new Map<string, AbsNativeModelDeclaration>();
  const ready = (block: Blockly.Block) => !unresolved.has(block)
    && block.inputList.every(input => !input.connection?.targetBlock()?.getDescendants(false).some(child => unresolved.has(child)));
  withNativeModelRegistrations(window, generator, (block, name, type) => {
    const node = nodes.get(block);
    if (!node || disabled(block)) throw new AbsSyncError('ABS_MODEL_DECLARATION_UNOWNED', 'Only an active ABS initializer may prepare a model.');
    const effect = execution.models.declare(node.start, block.type, name, type, requestId);
    const key = effect.name.toLowerCase(), previous = declarations.get(key);
    if (previous && (previous.start !== effect.start || previous.type !== effect.type)) {
      throw new AbsSyncError('ABS_MODEL_DECLARATION_CONFLICT', `Multiple initializers declare ${JSON.stringify(name)}. Keep one declaration per object.`, node);
    }
    declarations.set(key, effect); // Repeated registration by the same native producer is idempotent.
    if (declarations.size > 128) throw new Error('Native model preparation exceeds declaration limits.');
  }, () => {
    generator.init(execution.workspace);
    for (const block of blocks.values()) {
      if (disabled(block) || !ready(block)) continue;
      const callback = generator.forBlock[block.type];
      if (!callback) continue; // Complete generation remains the authority for generator coverage.
      callback.call(generator, block, generator);
      execution.assertClean(); execution.models.assertCurrent();
    }
  });
  return [...declarations.values()].sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
}
