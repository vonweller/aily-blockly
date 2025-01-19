Arduino.forBlock["io_pin_digi"] = function (block, generator) {
  const code = block.getFieldValue("PIN");
  return [code, Arduino.ORDER_ATOMIC];
};

Arduino.forBlock["io_mode"] = function (block, generator) {
  const code = block.getFieldValue("MODE");
  return [code, Arduino.ORDER_ATOMIC];
};

Arduino.forBlock["io_state"] = function (block, generator) {
  const code = block.getFieldValue("STATE");
  return [code, Arduino.ORDER_ATOMIC];
};

Arduino.forBlock["io_pin_adc"] = function (block, generator) {
  const code = block.getFieldValue("PIN");
  return [code, Arduino.ORDER_ATOMIC];
};

Arduino.forBlock["io_pin_pwm"] = function (block, generator) {
  const code = block.getFieldValue("PIN");
  return [code, Arduino.ORDER_ATOMIC];
};

Arduino.forBlock["io_pinmode"] = function (block, generator) {
  const pin = generator.valueToCode(block, "PIN", Arduino.ORDER_ATOMIC);
  const mode = generator.valueToCode(block, "MODE", Arduino.ORDER_ATOMIC);
  return `pinMode(${pin}, ${mode});\n`;
};

Arduino.forBlock["io_digitalread"] = function (block, generator) {
  const pin = generator.valueToCode(block, "PIN", Arduino.ORDER_ATOMIC);
  return [`digitalRead(${pin})`, Arduino.ORDER_FUNCTION_CALL];
};

Arduino.forBlock["io_digitalwrite"] = function (block, generator) {
  const pin = generator.valueToCode(block, "PIN", Arduino.ORDER_ATOMIC);
  const value = generator.valueToCode(block, "STATE", Arduino.ORDER_ATOMIC);
  return `digitalWrite(${pin}, ${value});\n`;
};

Arduino.forBlock["io_analogread"] = function (block, generator) {
  const pin = generator.valueToCode(block, "PIN", Arduino.ORDER_ATOMIC);
  return [`analogRead(${pin})`, Arduino.ORDER_FUNCTION_CALL];
};

Arduino.forBlock["io_analogwrite"] = function (block, generator) {
  const pin = generator.valueToCode(block, "PIN", Arduino.ORDER_ATOMIC);
  const value = generator.valueToCode(block, "PWM", Arduino.ORDER_ATOMIC);
  return `analogWrite(${pin}, ${value});\n`;
};

Arduino.forBlock["io_pulsein"] = function (block, generator) {
  const pin = generator.valueToCode(block, "PULSEPIN", Arduino.ORDER_ATOMIC);
  const type = block.getFieldValue("PULSETYPE");

  // Arduino.reservePin(block, pin, "INPUT", "Pulse Pin");

  const pinSetupCode = "pinMode(" + pin + ", INPUT);\n";
  Arduino.addSetup("io_" + pin, pinSetupCode, false);

  return `pulseIn(${pin},${type});\n`;
};

Arduino.forBlock["io_pulsetimeout"] = function (block, generator) {
  const pin = generator.valueToCode(block, "PULSEPIN", Arduino.ORDER_ATOMIC);
  const type = block.getFieldValue("PULSETYPE");
  const timeout = block.getFieldValue("TIMEOUT");
  // const timeout = generator.valueToCode(block, "TIMEOUT", Arduino.ORDER_ATOMIC);

  // Arduino.reservePin(block, pin, "INPUT", "Pulse Pin");

  const pinSetupCode = "pinMode(" + pin + ", INPUT);\n";
  Arduino.addSetup("io_" + pin, pinSetupCode, false);

  return `pulseIn(${pin},${type},${timeout});\n`;
};
