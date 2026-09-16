import {test, expect, getMainWindow, openBlocklyProject} from '../fixtures/electron-app';
import {constants} from 'node:fs';
import {cp, mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SOURCE = process.env['AILY_E2E_LARGE_PROJECT'];

test('large real-project copy preserves all blocks, code, JSON and live field undo', async ({electronApp}, testInfo) => {
  test.skip(!SOURCE, 'Set AILY_E2E_LARGE_PROJECT to a real Blockly project; only a temporary copy is modified.');
  test.setTimeout(180_000);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'aily-v13-large-'));
  const project = path.join(temporary, 'project');
  const win = await getMainWindow(electronApp);
  const errors: string[] = [];
  win.on('pageerror', error => errors.push(error.message));
  try {
    await cp(SOURCE!, project, {recursive: true, mode: constants.COPYFILE_FICLONE,
      // Runtime locks belong to the source instance, never to the disposable
      // clone. Keep the real user's project/lock completely untouched.
      filter: source => !['.git', '.temp', '.build', 'build', '.workspace-history', 'project-open.lock'].includes(path.basename(source))});
    const started = Date.now();
    await openBlocklyProject(win, project);
    await expect.poll(() => win.evaluate(() => document.querySelector('iframe[data-blockly-generator-runtime]')?.getAttribute('data-runtime-ready')), {timeout: 90_000}).toBe('true');
    const result = await win.evaluate(async () => {
      const realm = (document.querySelector('iframe[data-blockly-generator-runtime]') as HTMLIFrameElement).contentWindow as any;
      const B = realm.Blockly;
      const ws = (window as any).blocklyWorkspace;
      const count = ws.getAllBlocks(false).length;
      const svgCount = ws.getCanvas().querySelectorAll('.blocklyDraggable').length;
      const variables = ws.getVariableMap().getAllVariables().length;
      const start = performance.now();
      const code = realm.Arduino.workspaceToCode(ws);
      const generationMs = performance.now() - start;
      const saved = B.serialization.workspaces.save(ws);
      B.serialization.workspaces.load(saved, ws);
      await B.renderManagement.finishQueuedRenders();
      const codeAfter = realm.Arduino.workspaceToCode(ws);
      const countAfter = ws.getAllBlocks(false).length;
      const block = ws.getAllBlocks(false).find((candidate: any) => candidate.type === 'math_number');
      ws.clearUndo();
      const before = block.getFieldValue('NUM');
      block.setFieldValue(Number(before) + 1, 'NUM');
      await new Promise(resolve => setTimeout(resolve, 50));
      ws.undo(false);
      return {version: B.VERSION, count, svgCount, variables, countAfter, codeLength: code.length,
        codeMatches: code === codeAfter, generationMs, undoMatches: block.getFieldValue('NUM') === before};
    });
    expect(result.version).toBe('13.3.0');
    expect(result.count).toBeGreaterThan(2000);
    expect(result.svgCount).toBeGreaterThan(2000);
    expect(result.countAfter).toBe(result.count);
    expect(result.codeLength).toBeGreaterThan(10000);
    expect(result.codeMatches).toBe(true);
    expect(result.undoMatches).toBe(true);
    const save = await win.evaluate(async () => {
      const realm = (document.querySelector('iframe[data-blockly-generator-runtime]') as HTMLIFrameElement).contentWindow as any;
      return realm.projectService.save(undefined, 30_000);
    });
    expect(save.success, JSON.stringify(save)).toBe(true);
    await win.evaluate(() => { window.location.hash = '#/main/guide'; });
    await expect(win.locator('app-blockly-editor')).toHaveCount(0);
    await openBlocklyProject(win, project);
    await expect.poll(() => win.evaluate(() => document.querySelector('iframe[data-blockly-generator-runtime]')?.getAttribute('data-runtime-ready')), {timeout: 90_000}).toBe('true');
    expect(await win.evaluate(() => (window as any).blocklyWorkspace.getAllBlocks(false).length)).toBe(result.count);
    expect(errors).toEqual([]);
    await testInfo.attach('large-workspace-contract', {body: JSON.stringify({...result, savedAndReopened: true, elapsedMs: Date.now() - started, errors}, null, 2), contentType: 'application/json'});
    await win.screenshot({path: testInfo.outputPath('large-workspace.png')});
  } finally {
    await win.evaluate(() => { window.location.hash = '#/main/guide'; }).catch(() => {});
    await expect(win.locator('app-blockly-editor')).toHaveCount(0);
    await rm(temporary, {recursive: true, force: true});
  }
});
