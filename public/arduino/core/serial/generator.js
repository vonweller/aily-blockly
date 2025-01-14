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

Arduino.forBlock["serial_write"] = function (block) {
  const obj = block.getFieldValue("SERIAL");
  const data =
    Arduino.valueToCode(block, "DATA", Arduino.ORDER_ATOMIC) || '\"\"';
  return `${obj}.write(${data});\n`;
};

Arduino.forBlock["serial_read_string"] = function (block) {
  const obj = block.getFieldValue("SERIAL");
  return [`${obj}.readString()`, Arduino.ORDER_FUNCTION_CALL];
};

Arduino.forBlock["number_format"] = function (block) {
  const format = block.getFieldValue("FORMAT");
  const value = block.getFieldValue("VALUE");
  let code;
  switch (format) {
    case "BIN":
      code = `0b${parseInt(value, 10).toString(2)}`;
      break;
    case "OCT":
      code = `0${parseInt(value, 10).toString(8)}`;
      break;
    case "DEC":
      code = `${parseInt(value, 10)}`;
      break;
    case "HEX":
      code = `0x${parseInt(value, 10).toString(16).toUpperCase()}`;
      break;
    default:
      code = `${parseInt(value, 10)}`;
  }
  return [code, Arduino.ORDER_ATOMIC];
};
