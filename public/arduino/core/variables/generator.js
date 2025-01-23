Arduino.forBlock["variable_define"] = function (block) {
  const varType = block.getFieldValue("TYPE");
  const varName = block.getFieldValue("VAR");
  let value = block.getFieldValue("VALUR");
  if (varType === "char") {
    value = value.replace(/^\"/, "'").replace(/\"$/, "'");
  }
  const code = `${varType} ${varName} = ${value};`;
  // if (isGlobal(block)) {
  //   Arduino.addVariable(varName, code);
  //   return "";
  // } else return code + "\n";
  return [code, Arduino.ORDER_ATOMIC];
};

Arduino.forBlock["variables_get"] = function (block) {
  // Variable getter.
  const code = Arduino.getVariableName(block.getFieldValue("VAR"));
  return [code, Arduino.ORDER_ATOMIC];
};

Arduino.forBlock["variables_set"] = function (block) {
  // Variable setter.
  const argument0 =
    Arduino.valueToCode(block, "VALUE", Arduino.ORDER_ASSIGNMENT) || "0";
  const varName = Arduino.getVariableName(block.getFieldValue("VAR"));

  Arduino.addVariable("variable_float", `volatile float ${varName};`);
  // TODO 还得区分创建的类型 @downey
  return varName + " = " + argument0 + ";\n";
};

Arduino.forBlock["variables_get_dynamic"] = Arduino.forBlock["variables_get"];
Arduino.forBlock["variables_set_dynamic"] = Arduino.forBlock["variables_set"];
