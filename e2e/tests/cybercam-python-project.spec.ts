import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  expect,
  getMainWindow,
  openBlocklyProject,
  ROOT,
  test,
} from '../fixtures/electron-app';

const {
  cleanupTemporaryProject,
} = require('../../scripts/e2e-temp-project-cleanup');

const PROJECT_FIXTURE = path.join(ROOT, 'e2e', 'fixtures', 'projects', 'cybercam-python');

test.describe('CyberCAM Python project', () => {
  test.use({ pythonRuntimeBackend: 'fake' });

  test('generates main.py and exercises the hardware-free runtime workflow', async ({ electronApp }) => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aily-cybercam-e2e-'));
    const projectPath = path.join(tempRoot, 'project');
    await cp(PROJECT_FIXTURE, projectPath, { recursive: true });
    const win = await getMainWindow(electronApp);
    let primaryError: unknown;
    try {
      await openBlocklyProject(win, projectPath);

      const panel = win.locator('app-python-runtime-panel');
      await expect(panel).toBeVisible({ timeout: 60_000 });
      await expect(panel.getByText('Python Device', { exact: true })).toBeVisible();
      await expect.poll(async () => readFile(path.join(projectPath, 'main.py'), 'utf8').catch(() => ''))
        .toContain('cybercam-e2e');

      await expect(panel.getByText('COM-CYBERCAM / CyberCAM E2E')).toBeVisible({ timeout: 10_000 });
      await panel.getByRole('button', { name: 'Connect', exact: true }).click();
      await expect(panel.getByText('Connected', { exact: true })).toBeVisible();
      await expect(panel.getByRole('treeitem', { name: 'main.py' })).toBeVisible();

      await panel.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(panel.locator('.xterm-screen')).toContainText('fake CyberCAM output');
      await expect(panel.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();

      await panel.getByRole('button', { name: 'Preview', exact: true }).click();
      await expect(panel.getByAltText('Live Python device camera preview')).toBeVisible();
      await panel.getByRole('button', { name: 'Stop preview', exact: true }).click();
      await expect(panel.getByAltText('Live Python device camera preview')).toHaveCount(0);

      await panel.getByRole('treeitem', { name: 'main.py' }).click();
      await expect(panel.getByLabel('Remote Python file')).toHaveValue(/fake remote main/);

      await panel.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect(panel.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
      await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
      await expect(panel.getByText('Ready to connect')).toBeVisible();
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      await cleanupTemporaryProject({
        target: tempRoot,
        primaryError,
        leaveProject: async () => {
          await win.evaluate(() => { window.location.hash = '#/main/guide'; });
          await win.waitForTimeout(100);
        },
        removeDirectory: (target: string) => rm(target, { recursive: true, force: true }),
      });
    }
  });
});
