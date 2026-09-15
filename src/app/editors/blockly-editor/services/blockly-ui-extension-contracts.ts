import * as Blockly from 'blockly';

// Version-local Blockly adapter: this installed version exposes registration identities
// only through TEST_ONLY. Missing access fails closed; never run callbacks to infer a shape.
const registry = () => (Blockly.Extensions as any).TEST_ONLY?.allExtensions;
const originalRegistry = registry();
const originalApply = Blockly.Extensions.apply;
const builtin = new Map<string, unknown>([
  // Bundled implementation only installs customContextMenu, no persisted state or onchange.
  ['contextMenu_variableSetterGetter', originalRegistry?.['contextMenu_variableSetterGetter']],
  // Captures the current tooltip and sets a parent-aware tooltip callback only.
  ['parent_tooltip_when_inline', originalRegistry?.['parent_tooltip_when_inline']],
]);

export function captureBlocklyUiExtensionContracts() {
  const used = new Set<string>();
  const intact = (name: string) => typeof builtin.get(name) === 'function' && registry() === originalRegistry
    && registry()?.[name] === builtin.get(name) && Blockly.Extensions.apply === originalApply;
  return {
    supports: (name: string) => {
      if (!intact(name)) return false;
      used.add(name); return true;
    },
    assertCurrent: () => {
      if ([...used].some(name => !intact(name))) throw new Error('Prepared Blockly UI extension registration changed.');
    },
  };
}
