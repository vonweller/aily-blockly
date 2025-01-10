Arduino.forBlock["variable_define"] = function (block) {
  let varType = getValue(block, "TYPE", "field_dropdown");
  let varName = getValue(block, "VAR", "field_variable");
  let value = getValue(block, "VALUE", "input_value");
  if (varType == "char") {
    value = value.replace(/^\"/, "'").replace(/\"$/, "'");
  }
  let code = `${varType} ${varName} = ${value};`;
  if (isGlobal(block)) {
    Arduino.addVariable(varName, code);
    return "";
  } else return code + "\n";
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
  return varName + " = " + argument0 + ";\n";
};

Arduino.forBlock["variables_get_dynamic"] = Arduino.forBlock["variables_get"];
Arduino.forBlock["variables_set_dynamic"] = Arduino.forBlock["variables_set"];
