import {
  bootstrapDefaultSubapps,
  DEFAULT_SUBAPP_STATE_KEY,
  DefaultSubappAction,
  DefaultSubappCatalogItem,
  DefaultSubappsBootstrapAdapter,
  isDefaultSubappActionCompleted,
} from './default-subapps-bootstrap';

function createHarness(initial: DefaultSubappCatalogItem[] = []) {
  let catalog = initial;
  const data: Record<string, any> = {};
  const completed: string[] = [];
  const installedIds: string[] = [];
  const pinned: string[] = [];
  const errors: string[] = [];
  const initialize = jasmine.createSpy('initialize').and.resolveTo(undefined);
  const adapter: DefaultSubappsBootstrapAdapter = {
    isCompleted: (id, action) => isDefaultSubappActionCompleted(data, id, action),
    initialize,
    readCatalog: () => catalog,
    isAvailable: item => !item.only || item.only === 'all' || item.only === 'aily blockly',
    install: async id => {
      installedIds.push(id);
      catalog = catalog.map(item => item.id === id ? { ...item, installed: true, config: {} } : item);
    },
    isPinned: id => pinned.includes(id),
    pin: id => { pinned.push(id); return true; },
    markCompleted: async (id, action) => {
      data[DEFAULT_SUBAPP_STATE_KEY] ??= {};
      data[DEFAULT_SUBAPP_STATE_KEY][id] ??= {};
      data[DEFAULT_SUBAPP_STATE_KEY][id][action] = 1;
      completed.push(`${id}:${action}`);
    },
    onError: id => { errors.push(id); },
  };
  return { adapter, data, completed, installedIds, pinned, errors, initialize,
    setCatalog: (items: DefaultSubappCatalogItem[]) => { catalog = items; } };
}

const freshCatalog = (): DefaultSubappCatalogItem[] => [
  { id: 'aily-chat', toolId: 'aily-chat', installed: false, app: { autoInstall: true, defaultToolbar: true } },
  { id: 'serial-debugger', toolId: 'serial-debugger', installed: false, app: { autoInstall: true, defaultToolbar: false } },
];

describe('bootstrapDefaultSubapps catalog policies', () => {
  it('installs and pins arbitrary configured entries using catalog and tool ids respectively', async () => {
    const h = createHarness([
      ...freshCatalog(),
      { id: 'new-tool', toolId: 'new-tool-alias', installed: false, app: { autoInstall: true, defaultToolbar: true } },
    ]);
    await bootstrapDefaultSubapps(h.adapter);
    expect(h.installedIds).toEqual(['aily-chat', 'serial-debugger', 'new-tool']);
    expect(h.pinned).toEqual(['aily-chat', 'new-tool-alias']);
    expect(h.completed).toEqual([
      'aily-chat:autoInstall', 'aily-chat:defaultToolbar', 'serial-debugger:autoInstall',
      'new-tool:autoInstall', 'new-tool:defaultToolbar',
    ]);
  });

  it('does nothing when flags are missing or false, including for Chat and serial', async () => {
    const h = createHarness(freshCatalog().map(item => ({ ...item, app: {} })));
    await bootstrapDefaultSubapps(h.adapter);
    h.setCatalog(freshCatalog().map(item => ({ ...item, app: { autoInstall: false, defaultToolbar: false } })));
    await bootstrapDefaultSubapps(h.adapter);
    expect(h.installedIds).toEqual([]);
    expect(h.pinned).toEqual([]);
    expect(h.completed).toEqual([]);
  });

  it('waits for catalog initialization before discovering policies', async () => {
    const h = createHarness([]);
    h.initialize.and.callFake(async () => { h.setCatalog(freshCatalog()); });
    await bootstrapDefaultSubapps(h.adapter);
    expect(h.installedIds.length).toBe(2);
  });

  it('continues after failure and only retries the failed action next launch', async () => {
    const h = createHarness(freshCatalog());
    const install = h.adapter.install;
    h.adapter.install = async id => {
      if (id === 'aily-chat') throw new Error('offline');
      await install(id);
    };
    await bootstrapDefaultSubapps(h.adapter);
    expect(h.errors).toEqual(['aily-chat']);
    expect(h.installedIds).toEqual(['serial-debugger']);
    expect(h.completed).toEqual(['serial-debugger:autoInstall']);
    h.adapter.install = install;
    await bootstrapDefaultSubapps(h.adapter);
    expect(h.installedIds).toEqual(['serial-debugger', 'aily-chat']);
  });

  it('respects user uninstall and unpin after successful initialization', async () => {
    const h = createHarness(freshCatalog());
    await bootstrapDefaultSubapps(h.adapter);
    h.pinned.length = 0;
    h.setCatalog(freshCatalog().map(item => item.id === 'aily-chat' ? { ...item, installed: true, config: {} } : item));
    await bootstrapDefaultSubapps(h.adapter);
    expect(h.installedIds).toEqual(['aily-chat', 'serial-debugger']);
    expect(h.pinned).toEqual([]);
  });

  it('recognizes old completion markers without using them as a policy list', async () => {
    const h = createHarness(freshCatalog());
    h.data['defaultAilyChatCanonicalIdInstalledAt'] = 1;
    h.data['defaultSerialDebuggerInstalledAt'] = 1;
    await bootstrapDefaultSubapps(h.adapter);
    expect(h.installedIds).toEqual([]);
    expect(h.pinned).toEqual([]);
    expect(isDefaultSubappActionCompleted(h.data, 'aily-chat', 'defaultToolbar')).toBeTrue();
    expect(isDefaultSubappActionCompleted(h.data, 'serial-debugger', 'defaultToolbar')).toBeFalse();
  });

  it('pins an installed app independently of auto-install, preserving existing versions', async () => {
    const h = createHarness([{ id: 'installed-tool', toolId: 'installed-tool', installed: true, config: {},
      app: { autoInstall: false, defaultToolbar: true } }]);
    await bootstrapDefaultSubapps(h.adapter);
    expect(h.installedIds).toEqual([]);
    expect(h.pinned).toEqual(['installed-tool']);
    expect(h.completed).toEqual(['installed-tool:defaultToolbar']);
  });

  it('does not install an app merely because it requests default toolbar placement', async () => {
    const h = createHarness([{ id: 'manual-tool', toolId: 'manual-tool', installed: false,
      app: { defaultToolbar: true } }]);
    await bootstrapDefaultSubapps(h.adapter);
    expect(h.installedIds).toEqual([]);
    expect(h.pinned).toEqual([]);
    expect(h.completed).toEqual([]);
  });

  it('reuses runnable installed development packages without replacing or updating', async () => {
    const h = createHarness(freshCatalog().map(item => ({ ...item, installed: true, config: {} })));
    await bootstrapDefaultSubapps(h.adapter);
    expect(h.installedIds).toEqual([]);
    expect(h.completed.length).toBe(3);
  });

  it('skips uninstalling, disabled, and other-product entries', async () => {
    const base = freshCatalog()[0];
    const h = createHarness([
      { ...base, id: 'uninstalling', uninstalling: true },
      { ...base, id: 'disabled', enabled: false },
      { ...base, id: 'app-disabled', app: { ...base.app, enabled: false } },
      { ...base, id: 'coder-only', only: 'aily coder' },
    ]);
    await bootstrapDefaultSubapps(h.adapter);
    expect(h.installedIds).toEqual([]);
    expect(h.completed).toEqual([]);
  });

  it('does not mark incomplete or unconfirmed installations as complete', async () => {
    const h = createHarness(freshCatalog().map(item => ({ ...item, installed: true })));
    await bootstrapDefaultSubapps(h.adapter);
    expect(h.completed).toEqual([]);
    h.setCatalog(freshCatalog());
    h.adapter.install = async () => undefined;
    await bootstrapDefaultSubapps(h.adapter);
    expect(h.completed).toEqual([]);
  });

  it('retries a full toolbar later without repeating installation', async () => {
    const h = createHarness(freshCatalog());
    const pin = h.adapter.pin;
    h.adapter.pin = () => false;
    await bootstrapDefaultSubapps(h.adapter);
    expect(h.completed).toEqual(['aily-chat:autoInstall', 'serial-debugger:autoInstall']);
    h.adapter.pin = pin;
    await bootstrapDefaultSubapps(h.adapter);
    expect(h.installedIds).toEqual(['aily-chat', 'serial-debugger']);
    expect(h.pinned).toEqual(['aily-chat']);
  });

  it('accepts an already pinned app and records placement without changing layout', async () => {
    const h = createHarness(freshCatalog());
    h.pinned.push('aily-chat');
    await bootstrapDefaultSubapps(h.adapter);
    expect(h.pinned).toEqual(['aily-chat']);
    expect(h.completed).toContain('aily-chat:defaultToolbar');
  });

  it('keeps other apps independent of failed completion persistence', async () => {
    const h = createHarness(freshCatalog());
    const mark = h.adapter.markCompleted;
    h.adapter.markCompleted = async (id: string, action: DefaultSubappAction) => {
      if (id === 'aily-chat') throw new Error('write failed');
      await mark(id, action);
    };
    await bootstrapDefaultSubapps(h.adapter);
    expect(h.errors).toEqual(['aily-chat']);
    expect(h.completed).toEqual(['serial-debugger:autoInstall']);
    expect(h.installedIds.length).toBe(2);
  });
});
