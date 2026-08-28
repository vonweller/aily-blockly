import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '../fixtures/electron-app';

type WindowOwnershipSnapshot = {
  mainWindowId: number | null;
  childWindowIds: number[];
  target: {
    id: number;
    parentWindowId: number | null;
    alwaysOnTop: boolean;
  } | null;
};

async function openWindow(mainWindow: Page, options: Record<string, unknown>) {
  await mainWindow.evaluate((openOptions) => {
    const api = (window as unknown as {
      electronAPI: { subWindow: { open: (value: Record<string, unknown>) => void } };
    }).electronAPI;
    api.subWindow.open(openOptions);
  }, options);
}

async function readHostWindowState(mainWindow: Page, path: string) {
  return mainWindow.evaluate((windowPath) => {
    const api = (window as unknown as {
      electronAPI: { subWindow: { getState: (value: string) => Promise<Record<string, unknown>> } };
    }).electronAPI;
    return api.subWindow.getState(windowPath);
  }, path);
}

async function readOwnership(
  electronApp: ElectronApplication,
  routeMarker: string,
): Promise<WindowOwnershipSnapshot> {
  return electronApp.evaluate(({ BrowserWindow }, marker) => {
    const windows = BrowserWindow.getAllWindows();
    const mainWindow = windows.find((win) => win.webContents.getURL().includes('#/main'));
    const target = windows.find((win) => win.webContents.getURL().includes(marker));
    return {
      mainWindowId: mainWindow?.id ?? null,
      childWindowIds: mainWindow?.getChildWindows().map((win) => win.id) ?? [],
      target: target
        ? {
            id: target.id,
            parentWindowId: target.getParentWindow()?.id ?? null,
            alwaysOnTop: target.isAlwaysOnTop(),
          }
        : null,
    };
  }, routeMarker);
}

test.describe('独立窗口归属', () => {
  test('内置窗口只置于主窗口之上，子应用窗口保持独立', async ({ electronApp, mainWindow }) => {
    const builtinMarker = '#/about?ownership=builtin';
    await openWindow(mainWindow, {
      path: 'about?ownership=builtin',
      windowClass: 'builtin',
      width: 700,
      height: 550,
    });

    await expect.poll(() => readOwnership(electronApp, builtinMarker)).toMatchObject({
      mainWindowId: expect.any(Number),
      target: {
        id: expect.any(Number),
        parentWindowId: expect.any(Number),
        alwaysOnTop: false,
      },
    });
    const builtinState = await readOwnership(electronApp, builtinMarker);
    expect(builtinState.target?.parentWindowId).toBe(builtinState.mainWindowId);
    expect(builtinState.childWindowIds).toContain(builtinState.target?.id);
    await expect.poll(() => readHostWindowState(mainWindow, '/about?ownership=builtin')).toMatchObject({
      windowClass: 'builtin',
      ownedByMainWindow: true,
      parentWindowId: builtinState.mainWindowId,
      alwaysOnTop: false,
    });

    const subappMarker = '#/about?ownership=subapp';
    await openWindow(mainWindow, {
      path: 'about?ownership=subapp',
      windowClass: 'subapp',
      width: 700,
      height: 550,
    });

    await expect.poll(() => readOwnership(electronApp, subappMarker)).toMatchObject({
      target: {
        id: expect.any(Number),
        parentWindowId: null,
        alwaysOnTop: false,
      },
    });
    const subappState = await readOwnership(electronApp, subappMarker);
    expect(subappState.childWindowIds).not.toContain(subappState.target?.id);
    await expect.poll(() => readHostWindowState(mainWindow, '/about?ownership=subapp')).toMatchObject({
      windowClass: 'subapp',
      ownedByMainWindow: false,
      parentWindowId: null,
      alwaysOnTop: false,
    });
  });

  test('设置预热窗口展示后归属主窗口且不再全局置顶', async ({ electronApp, mainWindow }) => {
    await openWindow(mainWindow, {
      path: 'settings',
      windowClass: 'builtin',
      width: 700,
      height: 550,
    });

    await expect.poll(() => readOwnership(electronApp, '#/settings')).toMatchObject({
      mainWindowId: expect.any(Number),
      target: {
        id: expect.any(Number),
        parentWindowId: expect.any(Number),
        alwaysOnTop: false,
      },
    });
    const settingsState = await readOwnership(electronApp, '#/settings');
    expect(settingsState.target?.parentWindowId).toBe(settingsState.mainWindowId);
    await expect.poll(() => readHostWindowState(mainWindow, '/settings')).toMatchObject({
      windowClass: 'builtin',
      ownedByMainWindow: true,
      parentWindowId: settingsState.mainWindowId,
      alwaysOnTop: false,
    });
  });
});
