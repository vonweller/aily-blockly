Arduino.forBlock['servo_attach'] = function (block) {
    var pin = Arduino.valueToCode(block, 'PIN', Arduino.ORDER_ATOMIC);
    var angle = Arduino.valueToCode(block, 'ANGLE', Arduino.ORDER_ATOMIC);
    var code = 'servo.attach(' + pin + ');\n';
    return code;
}

Arduino.forBlock['servo_detach'] = function (block) {
    var pin = Arduino.valueToCode(block, 'PIN', Arduino.ORDER_ATOMIC);
    var code = 'servo.detach();\n';
    return code;
}

Arduino.forBlock['servo_write'] = function (block) {
    var angle = Arduino.valueToCode(block, 'ANGLE', Arduino.ORDER_ATOMIC);
    var code = 'servo.write(' + angle + ');\n';
    return code;
}