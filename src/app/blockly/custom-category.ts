// 给toolbox中的lib添加icon显示
import * as Blockly from 'blockly';

class CustomCategory extends Blockly.ToolboxCategory {
    /**
     * Constructor for a custom category.
     * @override
     */
    constructor(categoryDef, toolbox, opt_parent) {
        super(categoryDef, toolbox, opt_parent);
    }

    override createIconDom_() {
        let iconDiv = document.createElement('div');
        iconDiv.className = 'tbc-icon-box';
        let toolboxIcon = document.createElement('i');
        iconDiv.appendChild(toolboxIcon);
        if (this.toolboxItemDef_['icon']) {
            Blockly.utils.dom.addClass(toolboxIcon, this.toolboxItemDef_['icon']);
        }
        return iconDiv;
    }
}

Blockly.registry.register(
    Blockly.registry.Type.TOOLBOX_ITEM,
    Blockly.ToolboxCategory.registrationName,
    CustomCategory,
    true,
);