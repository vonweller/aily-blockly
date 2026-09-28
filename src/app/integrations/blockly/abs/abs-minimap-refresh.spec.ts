import { Subject } from 'rxjs';
import * as Blockly from 'blockly';
import { BlocklyComponent } from '../../../editors/blockly-editor/components/blockly/blockly.component';
import { BlocklyService } from '../../../editors/blockly-editor/services/blockly.service';
import { WorkspaceMinimap } from '../../../editors/blockly-editor/utils/workspace-minimap';

describe('bulk workspace minimap refresh', () => {
  let component: any, editor: any, workspace: Blockly.WorkspaceSvg, minimap: WorkspaceMinimap;
  let host: HTMLDivElement, input: HTMLInputElement, blocked: boolean;
  beforeEach(async () => {
    blocked = false;
    host = document.createElement('div'); host.style.cssText = 'width:600px;height:400px;position:relative';
    document.body.append(host); workspace = Blockly.inject(host, {});
    Blockly.Blocks['bulk_number'] = {init() {this.appendDummyInput().appendField(new Blockly.FieldNumber(0), 'NUM');}};
    minimap = new WorkspaceMinimap(workspace, () => blocked);
    const refresh = new Subject<Blockly.WorkspaceSvg>();
    editor = Object.create(BlocklyService.prototype);
    Object.defineProperty(editor, 'workspace', {value: workspace, writable: true});
    Object.assign(editor, {workspaceVisualRefreshRequestSubject: refresh, workspaceVisualRefreshRequested$: refresh.asObservable()});
    component = Object.create(BlocklyComponent.prototype);
    Object.assign(component, {blocklyService: editor, workspace, minimap, destroy$: new Subject<void>(),
      ngZone: {runOutsideAngular: (fn: () => void) => fn()}});
    spyOn(Blockly.WidgetDiv, 'isVisible').and.returnValue(false);
    spyOn(Blockly.DropDownDiv, 'isVisible').and.returnValue(false);
    input = document.createElement('input'); document.body.append(input);
    component.initMinimapVisualRefresh();
    await new Promise(resolve => setTimeout(resolve, 60));
  });
  afterEach(() => {
    component.destroy$.next(); component.destroy$.complete(); minimap.dispose();
    input.remove(); workspace.dispose(); host.remove(); delete Blockly.Blocks['bulk_number'];
  });
  const changeSilently = (value: number) => {
    Blockly.Events.disable();
    try {
      workspace.clear(); const block = workspace.newBlock('bulk_number', 'bulk-number');
      block.initSvg(); block.setFieldValue(value, 'NUM'); block.render();
    } finally {Blockly.Events.enable();}
    editor.requestWorkspaceVisualRefresh();
  };
  const text = () => host.querySelector('[data-minimap-source] text')?.textContent;
  const settle = () => new Promise(resolve => setTimeout(resolve, 250));
  it('coalesces silent imports and renders the latest fields and deletions after the lease ends', async () => {
    blocked = true; changeSilently(1); changeSilently(2); await settle();
    expect(text()).toBeUndefined(); blocked = false; await settle(); expect(text()).toBe('2');
    Blockly.Events.disable(); try {workspace.clear();} finally {Blockly.Events.enable();}
    editor.requestWorkspaceVisualRefresh(); await settle(); expect(text()).toBeUndefined();
    minimap.dispose();
  });
  it('keeps input focused while pending, then refreshes on idle without generating code', async () => {
    input.focus(); changeSilently(42); await settle();
    expect(document.activeElement).toBe(input); expect(text()).toBeUndefined();
    input.blur(); await settle(); expect(text()).toBe('42'); minimap.dispose();
  });
  it('does not schedule work when disabled, disposed or receiving another workspace', async () => {
    const sync = spyOn(minimap, 'requestSync').and.callThrough();
    component.minimap = null; changeSilently(1); expect(sync).not.toHaveBeenCalled();
    component.minimap = minimap;
    const other = new Blockly.Workspace(); editor.workspaceVisualRefreshRequestSubject.next(other); other.dispose();
    expect(sync).not.toHaveBeenCalled(); component.destroy$.next(); editor.requestWorkspaceVisualRefresh();
    expect(sync).not.toHaveBeenCalled(); minimap.dispose(); await settle();
  });
  it('does not alter an existing event suppression scope or construct another workspace', async () => {
    const count = Blockly.common.getAllWorkspaces().length; changeSilently(3); Blockly.Events.disable();
    try {await settle(); expect(Blockly.Events.isEnabled()).toBeFalse();} finally {Blockly.Events.enable();}
    expect(Blockly.Events.isEnabled()).toBeTrue(); expect(Blockly.common.getAllWorkspaces().length).toBe(count);
    expect(text()).toBe('3'); minimap.dispose();
  });
});
