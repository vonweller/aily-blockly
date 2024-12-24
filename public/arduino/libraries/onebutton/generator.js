Arduino.forBlock['onebutton_setup'] = function(block, generator) {
    var dropdown_pin = generator.valueToCode(block, 'PIN', generator.ORDER_ATOMIC);
    generator.addLibrary('#include <OneButton.h>', '#include <OneButton.h>');
    generator.addObject('OneButton button', 'OneButton button;');
    return 'button.setup(' + dropdown_pin + ');\n';
};

Arduino.forBlock['onebutton_attachClick'] = function(block, generator) {
    var code = generator.statementToCode(block, 'CLICK_FUNC');
    return 'button.attachClick(function() {\n' + code + '});\n';
};

Arduino.forBlock['onebutton_attachDoubleClick'] = function(block, generator) {
    var code = generator.statementToCode(block, 'DOUBLE_CLICK_FUNC');
    return 'button.attachDoubleClick(function() {\n' + code + '});\n';
};

Arduino.forBlock['onebutton_attachLongPressStart'] = function(block, generator) {
    var code = generator.statementToCode(block, 'LONG_PRESS_START_FUNC');
    return 'button.attachLongPressStart(function() {\n' + code + '});\n';
};

Arduino.forBlock['onebutton_attachLongPressStop'] = function(block, generator) {
    var code = generator.statementToCode(block, 'LONG_PRESS_STOP_FUNC');
    return 'button.attachLongPressStop(function() {\n' + code + '});\n';
};

Arduino.forBlock['onebutton_attachDuringLongPress'] = function(block, generator) {
    var code = generator.statementToCode(block, 'DURING_LONG_PRESS_FUNC');
    return 'button.attachDuringLongPress(function() {\n' + code + '});\n';
};

Arduino.forBlock['onebutton_tick'] = function(block, generator) {
    return 'button.tick();\n';
};
