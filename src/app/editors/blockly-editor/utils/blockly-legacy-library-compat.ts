import * as Blockly from 'blockly';

/**
 * Published Aily generator libraries are independently versioned. Keep their
 * v11 entry points backed by v13's variable map, without a second Blockly copy
 * or changes to saved variable IDs. New host code uses the v13 APIs directly.
 */
function installLegacyLibraryCompatibility(): void {
  const workspace = Blockly.Workspace.prototype as any;
  const methods: Record<string, (this: Blockly.Workspace, ...args: any[]) => any> = {
    createVariable(name, type, id) {
      return this.getVariableMap().createVariable(name, type ?? undefined, id ?? undefined);
    },
    getVariable(name, type) { return this.getVariableMap().getVariable(name, type); },
    getVariableById(id) { return this.getVariableMap().getVariableById(id); },
    getVariablesOfType(type) { return this.getVariableMap().getVariablesOfType(type ?? ''); },
    getAllVariables() { return this.getVariableMap().getAllVariables(); },
    getAllVariableNames() { return this.getVariableMap().getAllVariables().map(v => v.getName()); },
    getVariableUsesById(id) { return Blockly.Variables.getVariableUsesById(this, id); },
    renameVariableById(id, name) {
      const variable = this.getVariableMap().getVariableById(id);
      if (variable) this.getVariableMap().renameVariable(variable, name);
    },
    deleteVariableById(id) {
      const variable = this.getVariableMap().getVariableById(id);
      if (variable) Blockly.Variables.deleteVariable(this, variable);
    },
  };
  for (const [name, value] of Object.entries(methods)) {
    if (typeof workspace[name] !== 'function') {
      Object.defineProperty(workspace, name, { value, writable: true, configurable: true });
    }
  }

  const block = Blockly.Block.prototype as any;
  if (!block.getVars) {
    block.getVars = function (this: Blockly.Block) {
      return this.getVarModels().map(model => model.getId());
    };
  }
  if (!block.setEnabled) {
    block.setEnabled = function (this: Blockly.Block, enabled: boolean) {
      this.setDisabledReason(!enabled, 'MANUALLY_DISABLED');
    };
  }
  (Blockly.VariableModel as any).compareByName = Blockly.Variables.compareByName;
}

installLegacyLibraryCompatibility();
