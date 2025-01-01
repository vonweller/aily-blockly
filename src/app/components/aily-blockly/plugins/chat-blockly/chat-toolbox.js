import * as Blockly from "blockly/core";

export class ChatToolbox extends Blockly.Toolbox {
  // constructor(workspace) {
  //   super(workspace);
  //   console.log(12312, workspace);
  // }
  init() {
    console.log(2323);
    super.init();
  }
}

Blockly.blockRendering.register("toolbox", ChatToolbox);
