import * as Blockly from 'blockly';
import {addAilyIconToBlock} from '../components/blockly/renderer/aily-icon/acon';

describe('Aily icon render reuse', () => {
  it('retains unchanged DOM across renders and still applies actual state changes', () => {
    const host = document.createElement('div'); host.style.cssText = 'width:600px;height:400px';
    document.body.append(host);
    const workspace = Blockly.inject(host, {});
    Blockly.Blocks['icon_reuse_probe'] = {init() {this.appendDummyInput().appendField('icon');}};
    try {
      const block = workspace.newBlock('icon_reuse_probe'); block.initSvg();
      const icon = addAilyIconToBlock(block, 'fa-solid fa-play'); block.render();
      const original = block.getSvgRoot().querySelector('foreignObject');
      expect(original).not.toBeNull();
      const registrations = spyOn(Blockly.icons.registry, 'register').and.callThrough();
      for (let i = 0; i < 20; i++) {addAilyIconToBlock(block, 'fa-solid fa-play'); block.render();}
      expect(block.getSvgRoot().querySelector('foreignObject')).toBe(original);
      expect(registrations).not.toHaveBeenCalled();
      icon.setState({src: 'fa-solid fa-stop', color: '#123456', width: 24});
      expect(block.getSvgRoot().querySelector('foreignObject')).not.toBe(original);
      expect(block.getSvgRoot().querySelector('i')!.className).toContain('fa-stop');
      expect(icon.getSize().width).toBe(24);
      expect(icon.getState().color).toBe('#123456');
    } finally {workspace.dispose(); host.remove(); delete Blockly.Blocks['icon_reuse_probe'];}
  });
});
