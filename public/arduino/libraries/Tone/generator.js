Arduino.forBlock["io_tone"] = function (block) {
  const pin = block.getFieldValue("TONEPIN");
  const freq = block.getFieldValue("FREQUENCY");
  // const freq = Arduino.valueToCode(block, "FREQUENCY", Arduino.ORDER_ATOMIC);
  // Arduino.reservePin(block, pin, "OUTPUT", "Tone Pin");

  const pinSetupCode = "pinMode(" + pin + ", OUTPUT);\n";
  Arduino.addSetup("io_" + pin, pinSetupCode, false);

  return `tone(${pin},${freq});\n`;
};

Arduino.forBlock["io_notone"] = function (block) {
  const pin = block.getFieldValue("TONEPIN");
  // Arduino.reservePin(block, pin, "OUTPUT", "Tone Pin");

  const pinSetupCode = "pinMode(" + pin + ", OUTPUT);\n";
  Arduino.addSetup("io_" + pin, pinSetupCode, false);

  return `noTone(${pin});\n`;
};
