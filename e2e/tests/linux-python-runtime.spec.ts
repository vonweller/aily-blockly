import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  expect,
  getMainWindow,
  navigate,
  openBlocklyProject,
  ROOT,
  test,
} from '../fixtures/electron-app';

const {
  cleanupTemporaryProject,
} = require('../../scripts/e2e-temp-project-cleanup');

const PROJECT_FIXTURE = path.join(ROOT, 'e2e', 'fixtures', 'projects', 'cybercam-python');
const BOARD_METADATA_PATH = path.join(
  'node_modules',
  '@aily-project',
  'board-cybercam-e2e',
  'board.json',
);

type RuntimeAdapterId = 'canmv-k230' | 'linux-serial-shell' | 'linux-ssh';

test.describe('Linux Python runtime', () => {
  test('covers SSH, serial-shell, capability gating, runtime feedback, and the unchanged CyberCAM form', async ({
    electronApp,
  }) => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aily-linux-python-e2e-'));
    const projects = {
      ssh: await createRuntimeProject(tempRoot, 'ssh', 'linux-ssh'),
      serial: await createRuntimeProject(tempRoot, 'serial', 'linux-serial-shell'),
      canmv: await createRuntimeProject(tempRoot, 'canmv', 'canmv-k230'),
    };
    const win = await getMainWindow(electronApp);
    let primaryError: unknown;

    try {
      await installFakeRuntimeIpc(electronApp);

      await openBlocklyProject(win, projects.ssh);
      const sshPanel = await visibleRuntimePanel(win);
      await expect(sshPanel.locator('[data-testid="ssh-host"]')).toBeVisible();
      await expect(sshPanel.locator('[data-testid="ssh-port"]')).toBeVisible();
      await expect(sshPanel.locator('[data-testid="ssh-username"]')).toBeVisible();
      await expect(sshPanel.locator('[data-testid="ssh-password"]')).toBeVisible();
      await expect(sshPanel.locator('[data-testid="serial-port"]')).toHaveCount(0);
      await expect(sshPanel.locator('[data-testid="canmv-device"]')).toHaveCount(0);
      await expect(sshPanel.locator('[data-testid="preview-action"]')).toBeDisabled();
      await expect(sshPanel.locator('[data-testid="autostart-install"]')).toBeDisabled();

      await sshPanel.locator('[data-testid="ssh-host"]').fill('raspberrypi.fixture');
      await sshPanel.locator('[data-testid="ssh-username"]').fill('pi');
      await sshPanel.locator('[data-testid="ssh-password"]').fill('not-a-real-secret');
      await sshPanel.getByRole('button', { name: 'Connect', exact: true }).click();

      await expect(sshPanel.getByText('Connected', { exact: true })).toBeVisible();
      await expect(sshPanel.locator('[data-testid="ssh-password"]')).toHaveValue('');
      await expect(sshPanel.getByRole('treeitem', { name: 'main.py' })).toBeVisible();
      await expect(sshPanel.locator('[data-testid="preview-action"]')).toBeEnabled();
      await expect(sshPanel.locator('[data-testid="autostart-install"]')).toBeEnabled();
      await expect(sshPanel.locator('[data-testid="autostart-status"]')).toBeEnabled();
      await expect(sshPanel.locator('[data-testid="autostart-remove"]')).toBeEnabled();

      await sshPanel.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(sshPanel.locator('.xterm-screen')).toContainText('linux-ssh live output');
      await expect(sshPanel.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();

      await sshPanel.getByRole('button', { name: 'Preview', exact: true }).click();
      await expect(sshPanel.getByAltText('Live Python device camera preview')).toBeVisible();

      await sshPanel.locator('[data-testid="autostart-install"]').click();
      await expect(sshPanel.getByRole('status')).toContainText('Autostart installed by fake SSH peer');
      await sshPanel.locator('[data-testid="autostart-status"]').click();
      await expect(sshPanel.getByRole('status')).toContainText('Autostart is installed');
      await sshPanel.locator('[data-testid="autostart-remove"]').click();
      await expect(sshPanel.getByRole('status')).toContainText('Autostart removed');

      await sshPanel.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect(sshPanel.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
      await sshPanel.getByRole('button', { name: 'Disconnect', exact: true }).click();
      await expect(sshPanel.getByText('Ready to connect', { exact: true })).toBeVisible();

      await leaveProject(win);
      await openBlocklyProject(win, projects.serial);
      const serialPanel = await visibleRuntimePanel(win);
      await expect(serialPanel.locator('[data-testid="serial-port"]')).toBeVisible();
      await expect(serialPanel.locator('[data-testid="serial-baud"]')).toBeVisible();
      await expect(serialPanel.locator('[data-testid="serial-a-hint"]')).toContainText('SERIAL-A');
      await expect(serialPanel.locator('[data-testid="ssh-host"]')).toHaveCount(0);
      await expect(serialPanel.locator('[data-testid="canmv-device"]')).toHaveCount(0);
      await expect(serialPanel.getByText('COM-WALNUT-A / WalnutPi SERIAL-A')).toBeVisible();

      await serialPanel.getByRole('button', { name: 'Connect', exact: true }).click();
      await expect(serialPanel.getByText('Connected', { exact: true })).toBeVisible();
      await expect(serialPanel.locator('[data-testid="preview-action"]')).toBeDisabled();
      await expect(serialPanel.locator('[data-testid="autostart-install"]')).toBeDisabled();
      await expect(serialPanel.locator('[data-testid="autostart-status"]')).toBeDisabled();
      await expect(serialPanel.locator('[data-testid="autostart-remove"]')).toBeDisabled();
      await expect(serialPanel.getByText('Serial file helper disabled by fixture.')).toBeVisible();
      await expect(serialPanel.locator('[data-testid="preview-action"]')).toHaveAttribute(
        'title',
        'Serial preview disabled by fixture.',
      );
      await expect(serialPanel.locator('[data-testid="autostart-install"]')).toHaveAttribute(
        'title',
        'Serial autostart disabled by fixture.',
      );
      await expect(serialPanel.getByText('Serial PTY resize disabled by fixture.')).toBeVisible();

      await leaveProject(win);
      await openBlocklyProject(win, projects.canmv);
      const canmvPanel = await visibleRuntimePanel(win);
      await expect(canmvPanel.locator('[data-testid="canmv-device"]')).toBeVisible();
      await expect(canmvPanel.locator('[data-testid="ssh-host"]')).toHaveCount(0);
      await expect(canmvPanel.locator('[data-testid="serial-port"]')).toHaveCount(0);
      await expect(canmvPanel.getByText('COM-CYBERCAM / CyberCAM E2E')).toBeVisible();
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      await cleanupTemporaryProject({
        target: tempRoot,
        primaryError,
        leaveProject: () => leaveProject(win),
        removeDirectory: (target: string) => rm(target, { recursive: true, force: true }),
      });
    }
  });
});

async function createRuntimeProject(
  tempRoot: string,
  name: string,
  adapter: RuntimeAdapterId,
): Promise<string> {
  const projectPath = path.join(tempRoot, name);
  await cp(PROJECT_FIXTURE, projectPath, { recursive: true });
  const boardPath = path.join(projectPath, BOARD_METADATA_PATH);
  const board = JSON.parse(await readFile(boardPath, 'utf8'));
  board.runtime = {
    kind: 'python',
    adapter,
    entry: 'main.py',
  };
  await writeFile(boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  return projectPath;
}

async function visibleRuntimePanel(win: Page) {
  const panel = win.locator('app-python-runtime-panel');
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByText('Python Device', { exact: true })).toBeVisible();
  return panel;
}

async function leaveProject(win: Page): Promise<void> {
  await navigate(win, '/main/guide');
  await expect(win.locator('app-python-runtime-panel')).toHaveCount(0);
}

async function installFakeRuntimeIpc(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    const channels = [
      'python-runtime-status',
      'python-runtime-detect-boards',
      'python-runtime-connect',
      'python-runtime-disconnect',
      'python-runtime-run-script',
      'python-runtime-stop-script',
      'python-runtime-script-running',
      'python-runtime-terminal-input',
      'python-runtime-terminal-resize',
      'python-runtime-start-preview',
      'python-runtime-stop-preview',
      'python-runtime-list-dir',
      'python-runtime-stat',
      'python-runtime-read-file',
      'python-runtime-write-file',
      'python-runtime-delete-file',
      'python-runtime-rename-file',
      'python-runtime-mkdir',
      'python-runtime-rmdir',
      'python-runtime-file-exec',
      'python-runtime-install-autostart',
      'python-runtime-autostart-status',
      'python-runtime-remove-autostart',
    ];
    for (const channel of channels) ipcMain.removeHandler(channel);

    const sessions = new Map<string, {
      adapterId: RuntimeAdapterId;
      sessionId: string;
      running: boolean;
      previewing: boolean;
    }>();
    let sequence = 0;

    const fullSshCapabilities = {
      platform: 'raspberry-pi',
      hostname: 'raspberrypi-fixture',
      architecture: 'aarch64',
      pythonVersion: '3.11.9',
      homeDirectory: '/home/pi',
      writableWorkspace: '/home/pi/.aily',
      pty: true,
      terminalResize: true,
      processGroups: true,
      files: 'sftp',
      autostart: 'systemd',
      preview: {
        available: true,
        backend: 'opencv',
        transports: ['ssh-binary'],
      },
    };
    const gatedSerialCapabilities = {
      platform: 'walnutpi',
      hostname: 'walnutpi-fixture',
      architecture: 'aarch64',
      pythonVersion: '3.11.2',
      homeDirectory: '/home/walnut',
      writableWorkspace: '/tmp/aily-runtime',
      pty: true,
      terminalResize: false,
      processGroups: true,
      files: 'none',
      autostart: 'none',
      preview: {
        available: false,
        transports: [],
      },
      unavailableReasons: {
        files: 'Serial file helper disabled by fixture.',
        autostart: 'Serial autostart disabled by fixture.',
        preview: 'Serial preview disabled by fixture.',
        terminalResize: 'Serial PTY resize disabled by fixture.',
      },
    };

    const contextOf = (data: any) => {
      const adapterId = data?.context?.adapterId as RuntimeAdapterId;
      const sessionId = data?.context?.sessionId as string;
      return { adapterId, sessionId };
    };
    const sessionOf = (data: any) => {
      const context = contextOf(data);
      const session = sessions.get(context.sessionId);
      if (!session || session.adapterId !== context.adapterId) {
        throw new Error('Fake Linux runtime session is not connected');
      }
      return session;
    };
    const send = (sender: Electron.WebContents, channel: string, session: {
      adapterId: RuntimeAdapterId;
      sessionId: string;
    }, payload: any) => {
      if (sender.isDestroyed()) return;
      sender.send(channel, {
        adapterId: session.adapterId,
        sessionId: session.sessionId,
        payload,
      });
    };

    ipcMain.handle('python-runtime-status', async () => ({
      state: 'ready',
      pid: null,
      available: true,
      unavailableReason: null,
    }));
    ipcMain.handle('python-runtime-detect-boards', async (_event, data) => {
      const adapterId = data?.context?.adapterId || 'canmv-k230';
      if (adapterId === 'linux-serial-shell') {
        return {
          boards: [{
            port: 'COM-WALNUT-A',
            name: 'WalnutPi SERIAL-A',
            vid: '1a86',
            pid: '7523',
          }],
        };
      }
      if (adapterId === 'canmv-k230') {
        return {
          boards: [{
            port: 'COM-CYBERCAM',
            name: 'CyberCAM E2E',
            vid: '1209',
            pid: 'abd1',
          }],
        };
      }
      return { boards: [] };
    });
    ipcMain.handle('python-runtime-connect', async (_event, data) => {
      const adapterId = data?.context?.adapterId as RuntimeAdapterId;
      const sessionId = `linux-python-e2e-${++sequence}`;
      const session = {
        adapterId,
        sessionId,
        running: false,
        previewing: false,
      };
      sessions.set(sessionId, session);
      const capabilities = adapterId === 'linux-ssh'
        ? fullSshCapabilities
        : adapterId === 'linux-serial-shell'
          ? gatedSerialCapabilities
          : null;
      return {
        adapterId,
        sessionId,
        capabilities,
        boardInfo: {
          name: adapterId === 'linux-ssh' ? 'Raspberry Pi fixture' : 'WalnutPi fixture',
        },
      };
    });
    ipcMain.handle('python-runtime-disconnect', async (_event, data) => {
      const { sessionId } = contextOf(data);
      sessions.delete(sessionId);
    });
    ipcMain.handle('python-runtime-run-script', async (event, data) => {
      const session = sessionOf(data);
      session.running = true;
      setTimeout(() => {
        send(event.sender, 'python-runtime-event', session, {
          event: 'scriptState',
          params: { state: 'started' },
        });
        send(event.sender, 'python-runtime-event', session, {
          event: 'scriptOutput',
          params: { text: `${session.adapterId} live output\r\n` },
        });
      }, 10);
      return { status: 'ok' };
    });
    ipcMain.handle('python-runtime-stop-script', async (event, data) => {
      const session = sessionOf(data);
      session.running = false;
      send(event.sender, 'python-runtime-event', session, {
        event: 'scriptState',
        params: { state: 'stopped' },
      });
    });
    ipcMain.handle('python-runtime-script-running', async (_event, data) => ({
      running: sessionOf(data).running,
    }));
    ipcMain.handle('python-runtime-terminal-input', async (_event, data) => ({
      accepted: sessionOf(data).running,
      text: data?.payload?.text,
    }));
    ipcMain.handle('python-runtime-terminal-resize', async (_event, data) => ({
      accepted: sessionOf(data).running,
      columns: data?.payload?.columns,
      rows: data?.payload?.rows,
    }));
    ipcMain.handle('python-runtime-start-preview', async (event, data) => {
      const session = sessionOf(data);
      session.previewing = true;
      setTimeout(() => {
        if (!session.previewing) return;
        send(event.sender, 'python-runtime-frame', session, {
          frameId: 1,
          data: Uint8Array.from([0xff, 0xd8, 0x45, 0x32, 0x45, 0xff, 0xd9]),
        });
      }, 25);
      return { streamId: `${session.sessionId}-preview` };
    });
    ipcMain.handle('python-runtime-stop-preview', async (_event, data) => {
      sessionOf(data).previewing = false;
    });
    ipcMain.handle('python-runtime-list-dir', async (_event, data) => {
      sessionOf(data);
      return {
        entries: [{
          name: 'main.py',
          type: 'file',
          size: 25,
          mtime: 1_787_027_200,
        }],
      };
    });
    ipcMain.handle('python-runtime-stat', async (_event, data) => {
      sessionOf(data);
      return { type: 'file', size: 25 };
    });
    ipcMain.handle('python-runtime-read-file', async (_event, data) => {
      sessionOf(data);
      return {
        dataBase64: Buffer.from('print("fake remote main")\n').toString('base64'),
      };
    });
    for (const channel of [
      'python-runtime-write-file',
      'python-runtime-delete-file',
      'python-runtime-rename-file',
      'python-runtime-mkdir',
      'python-runtime-rmdir',
      'python-runtime-file-exec',
    ]) {
      ipcMain.handle(channel, async (_event, data) => {
        sessionOf(data);
        return { ok: true };
      });
    }
    ipcMain.handle('python-runtime-install-autostart', async (_event, data) => {
      sessionOf(data);
      return { message: 'Autostart installed by fake SSH peer', installed: true };
    });
    ipcMain.handle('python-runtime-autostart-status', async (_event, data) => {
      sessionOf(data);
      return { installed: true, running: true };
    });
    ipcMain.handle('python-runtime-remove-autostart', async (_event, data) => {
      sessionOf(data);
      return { removed: true };
    });
  });
}
