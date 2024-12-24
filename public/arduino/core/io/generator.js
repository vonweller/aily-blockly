Arduino.forBlock['io_pinmode'] = function (block, generator) {
    var pin = generator.valueToCode(block, 'PIN', arduino.ORDER_ATOMIC);
    var mode = generator.valueToCode(block, 'MODE', arduino.ORDER_ATOMIC);
    return 'pinMode(' + pin + ', ' + mode + ');\n';
}

Arduino.forBlock['io_digitalwrite'] = function (block, generator) {
    var pin = generator.valueToCode(block, 'PIN', arduino.ORDER_ATOMIC);
    var value = generator.valueToCode(block, 'VALUE', arduino.ORDER_ATOMIC);
    return 'digitalWrite(' + pin + ', ' + value + ');\n';
}