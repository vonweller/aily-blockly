Blockly.getMainWorkspace().registerButtonCallback(
  "CREATE_STRING_VARIABLE",
  (button) => {
    Blockly.Variables.createVariableButtonHandler(
      this.workspace,
      (name) => {
        console.log("变量创建成功");
        // TODO 是否动态插入变量块 @downey
      },
      "aily-variable",
    );
  },
);

Arduino.forBlock["variable_define"] = function (block) {
  const gorp = block.getFieldValue("GORP");
  let type = block.getFieldValue("TYPE");
  const name = block.getFieldValue("VAR");
  let value = Arduino.valueToCode(block, "VALUE", Arduino.ORDER_ATOMIC);
  if (!value) {
    value = ["volatile String*"].includes(type) ? `""` : 0;
  }
  if (gorp === "part") {
    type = type.replace(/volatile\s/, "");
    return `${type} ${name} = ${value};\n`;
  }
  Arduino.addVariable(`${type}_${name}`, `${type} ${name};`);
  return `${name} = ${value};\n`;
};

const setLibraryVariable = (type, code) => {
  Arduino.addVariable(
    `${type}_${code}`,
    `${type} ${code} = ${["string"].includes(type) ? `""` : 0};`,
  );
};

Arduino.forBlock["variables_get"] = function (block) {
  // Variable getter.
  const { name: code, type } = block.workspace.getVariableById(
    block.getFieldValue("VAR"),
  );
  console.log(code, type);
  setLibraryVariable(type, code);
  return [code, Arduino.ORDER_ATOMIC];
};

Arduino.forBlock["variables_set"] = function (block) {
  // Variable setter.
  const value =
    Arduino.valueToCode(block, "VALUE", Arduino.ORDER_ASSIGNMENT) || "0";

  const { name: code, type } = block.workspace.getVariableById(
    block.getFieldValue("VAR"),
  );

  // Arduino.addVariable("variable_float", `volatile float ${varName};`);
  setLibraryVariable(type, code);
  return `${code} = ${value};\n`;
};

Arduino.forBlock["variables_get_dynamic"] = Arduino.forBlock["variables_get"];
Arduino.forBlock["variables_set_dynamic"] = Arduino.forBlock["variables_set"];
