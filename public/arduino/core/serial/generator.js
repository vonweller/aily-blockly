Arduino.forBlock['serial_begin'] = function (block) {
    const baud = block.getFieldValue('BAUD');
    return `Serial.begin(${baud});\n`;
}

Arduino.forBlock['serial_print'] = function (block) {
    const content = Arduino.valueToCode(block, 'CONTENT', Arduino.ORDER_ATOMIC);
    return `Serial.print(${content});\n`;
}

Arduino.forBlock['serial_println'] = function (block) {
    const content = Arduino.valueToCode(block, 'CONTENT', Arduino.ORDER_ATOMIC);
    return `Serial.println(${content});\n`;
}

Arduino.forBlock['serial_read'] = function (block) {
    return 'Serial.read()';
}

Arduino.forBlock['serial_available'] = function (block) {
    return 'Serial.available()';
}

Arduino.forBlock['serial_flush'] = function (block) {
    return 'Serial.flush();\n';
}

Arduino.forBlock['serial_parseint'] = function (block) {
    return 'Serial.parseInt()';
}

