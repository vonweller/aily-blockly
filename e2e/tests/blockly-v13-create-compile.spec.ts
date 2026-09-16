import {test, expect, getMainWindow, navigate, closeAilyElectronApp} from '../fixtures/electron-app';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('v13 creates an ESP32-S3 project through the wizard and compiles twice without clearing shared caches', async ({electronApp}, testInfo) => {
  test.skip(process.env['AILY_E2E_COMPILE'] !== '1' || !process.env['AILY_E2E_TOOLCHAIN_SEED'],
    'Requires explicit compile opt-in and an installed toolchain seed.');
  test.setTimeout(480_000);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'aily-v13-create-'));
  const project = path.join(temporary, 'v13_create_regression');
  const win = await getMainWindow(electronApp);
  const logs: string[] = [];
  win.on('console', message => logs.push(message.text()));
  await win.addLocatorHandler(win.locator('.login-modal-wrap app-login .login-close'), async button => {await button.click();});
  try {
    // Only the native folder picker result is supplied by the test. The wizard,
    // package installation, project creation and compilation remain real.
    await electronApp.evaluate(({dialog}, folder) => {
      dialog.showOpenDialog = async () => ({canceled: false, filePaths: [folder]});
    }, temporary);
    await navigate(win, '/main/project-new');
    const search = win.locator('app-project-new .header input[nz-input]').first();
    await search.fill('xiao esp32s3');
    const board = win.locator('app-project-new .board-selector .board.ccenter.btn')
      .filter({has: win.locator('.name', {hasText: /^XIAO\s*ESP32S3$/i})});
    await expect(board).toBeVisible({timeout: 30_000});
    await board.click();
    await win.locator('app-project-new .desc-box .next button').first().click();
    await expect(win.locator('app-project-new input.board[disabled]')).toHaveValue('@aily-project/board-xiao_esp32s3');
    await win.locator('app-project-new .right-content input[nz-input]:not([disabled])').fill('v13_create_regression');
    await win.locator('app-project-new .ant-input-group-addon .btn').click();
    await expect(win.locator('app-project-new nz-input-group input[disabled]:not(.board)')).toHaveValue(temporary + path.sep);
    await win.locator('app-project-new .step-btns button.ant-btn-primary').first().click();
    await expect(win.locator('app-blockly-editor')).toBeVisible({timeout: 120_000});
    await expect.poll(() => win.evaluate(() => {
      const frame = document.querySelector('iframe[data-blockly-generator-runtime]') as HTMLIFrameElement;
      return frame?.getAttribute('data-runtime-ready') === 'true' && (frame.contentWindow as any).Blockly.VERSION;
    }), {timeout: 120_000}).toBe('13.3.0');
    expect(new URL(win.url().split('#')[1], 'https://test.local').searchParams.get('path')).toBe(project);
    await expect.poll(() => logs.some(log => /后台预处理完成|同步预处理完成|发现预编译缓存|预编译完成/.test(log)), {timeout: 150_000}).toBe(true);
    const builds: any[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const started = Date.now();
      await win.locator('app-header app-act-btn[data-action="compile"]').click();
      await expect.poll(async () => {
        const pkg = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
        const build = pkg.buildInfo;
        return Date.parse(build?.lastBuildTime || '') >= started ? build?.lastBuildStatus : 'waiting';
      }, {timeout: 150_000}).toBe('success');
      const info = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8')).buildInfo;
      builds.push({attempt, elapsedMs: Date.now() - started, ...info});
    }
    expect((await stat(path.join(project, '.build', 'sketch.bin'))).size).toBeGreaterThan(1000);
    expect(logs.filter(log => /编译命令执行完成/.test(log)).length).toBeGreaterThanOrEqual(2);
    await testInfo.attach('new-project-two-builds', {body: JSON.stringify(builds, null, 2), contentType: 'application/json'});
    await win.screenshot({path: testInfo.outputPath('new-project-compiled-twice.png')});
  } finally {
    await win.evaluate(() => {window.location.hash = '#/main/guide';}).catch(() => {});
    await expect(win.locator('app-blockly-editor')).toHaveCount(0).catch(() => {});
    await closeAilyElectronApp(electronApp);
    await rm(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
  }
});
