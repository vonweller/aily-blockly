Arduino.forBlock["serial_begin"] = function (block) {
  const obj = block.getFieldValue("SERIAL");
  const speed = block.getFieldValue("SPEED");
  return `${obj}.begin(${speed});\n`;
};

Arduino.forBlock["serial_print"] = function (block) {
  const obj = block.getFieldValue("SERIAL");
  const content = Arduino.valueToCode(block, "VAR", Arduino.ORDER_ATOMIC);
  return `${obj}.print(${content});\n`;
};

Arduino.forBlock["serial_println"] = function (block) {
  const obj = block.getFieldValue("SERIAL");
  const content = Arduino.valueToCode(block, "VAR", Arduino.ORDER_ATOMIC);
  return `${obj}.println(${content});\n`;
};

Arduino.forBlock["serial_read"] = function (block) {
  const obj = block.getFieldValue("SERIAL");
  return [`${obj}.read()`, Arduino.ORDER_FUNCTION_CALL];
};

Arduino.forBlock["serial_available"] = function (block) {
  const obj = block.getFieldValue("SERIAL");
  return [`${obj}.available()`, Arduino.ORDER_FUNCTION_CALL];
};

Arduino.forBlock["serial_flush"] = function (block) {
  const obj = block.getFieldValue("SERIAL");
  return `${obj}.flush();\n`;
};

Arduino.forBlock["serial_parseint"] = function (block) {
  const obj = block.getFieldValue("SERIAL");
  return [`${obj}.parseInt()`, Arduino.ORDER_FUNCTION_CALL];
};
