Arduino.forBlock["math_number"] = function (block) {
  // Numeric value.
  const code = Number(block.getFieldValue("NUM"));
  const order = code >= 0 ? Arduino.ORDER_ATOMIC : Arduino.ORDER_UNARY_NEGATION;
  return [code, order];
};

Arduino.forBlock["math_arithmetic"] = (block) => {
  // Basic arithmetic operators, and power.
  const OPERATORS = {
    ADD: [" + ", Arduino.ORDER_ADDITION],
    MINUS: [" - ", Arduino.ORDER_SUBTRACTION],
    MULTIPLY: [" * ", Arduino.ORDER_MULTIPLICATION],
    DIVIDE: [" / ", Arduino.ORDER_DIVISION],
    POWER: [null, Arduino.ORDER_NONE], // Handle power separately.
  };
  const tuple = OPERATORS[block.getFieldValue("OP")];
  const operator = tuple[0];
  const order = tuple[1];
  const argument0 = Arduino.valueToCode(block, "A", order) || "0";
  const argument1 = Arduino.valueToCode(block, "B", order) || "0";
  let code;
  // Power in JavaScript requires a special case since it has no operator.
  if (!operator) {
    code = "Math.pow(" + argument0 + ", " + argument1 + ")";
    return [code, Arduino.ORDER_FUNCTION_CALL];
  }
  code = argument0 + operator + argument1;
  return [code, order];
};
