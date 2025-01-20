Arduino.forBlock["time_millis"] = function (block, generator) {
  return ["millis()", generator.ORDER_ATOMIC];
};

Arduino.forBlock["system_time"] = function (block, generator) {
  return ["__TIME__", generator.ORDER_ATOMIC];
};

Arduino.forBlock["system_date"] = function (block, generator) {
  return ["__DATE__", generator.ORDER_ATOMIC];
};
