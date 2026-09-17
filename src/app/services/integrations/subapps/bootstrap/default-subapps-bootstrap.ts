export const DEFAULT_AILY_CHAT_SUBAPP_TOOL_ID = 'aily-chat';
export const DEFAULT_SUBAPP_STATE_KEY = 'subappInitialization';
export type DefaultSubappAction = 'autoInstall' | 'defaultToolbar';

export interface DefaultSubappCatalogItem {
  id: string;
  toolId: string;
  installed: boolean;
  uninstalling?: boolean;
  enabled?: boolean;
  only?: string;
  config?: unknown;
  app?: {
    enabled?: boolean;
    autoInstall?: boolean;
    defaultToolbar?: boolean;
  };
}

export interface DefaultSubappsBootstrapAdapter {
  isCompleted(id: string, action: DefaultSubappAction): boolean;
  initialize(): Promise<void>;
  readCatalog(): readonly DefaultSubappCatalogItem[];
  isAvailable(item: DefaultSubappCatalogItem): boolean;
  install(catalogId: string): Promise<void>;
  isPinned(toolId: string): boolean;
  pin(toolId: string): boolean;
  markCompleted(id: string, action: DefaultSubappAction): Promise<void>;
  onError(id: string, error: unknown): void;
}

/** Compatibility only: legacy markers never declare which apps to install/pin. */
export function isDefaultSubappActionCompleted(
  data: Record<string, any>, id: string, action: DefaultSubappAction,
): boolean {
  if (data?.[DEFAULT_SUBAPP_STATE_KEY]?.[id]?.[action]) return true;
  if (id === 'aily-chat' && data?.['defaultAilyChatCanonicalIdInstalledAt']) return true;
  return id === 'serial-debugger' && action === 'autoInstall'
    && !!data?.['defaultSerialDebuggerInstalledAt'];
}

/** Apply catalog defaults once per action. Sequential mutations share the host's
 * install-progress stream; failures remain pending for the next launch.
 */
export async function bootstrapDefaultSubapps(
  adapter: DefaultSubappsBootstrapAdapter,
): Promise<void> {
  await adapter.initialize();
  const findItem = (id: string) => adapter.readCatalog().find(app => app.id === id);
  const eligible = (item: DefaultSubappCatalogItem | undefined): item is DefaultSubappCatalogItem =>
    !!item && !item.uninstalling && item.enabled !== false && item.app?.enabled !== false
      && adapter.isAvailable(item);

  for (const entry of adapter.readCatalog()) {
    try {
      let item = findItem(entry.id);
      if (!eligible(item)) continue;
      if (item.app?.autoInstall === true && !adapter.isCompleted(item.id, 'autoInstall')) {
        if (!item.installed) {
          await adapter.install(item.id);
          item = findItem(entry.id);
        }
        if (!eligible(item) || !item.installed || !item.config) continue;
        await adapter.markCompleted(item.id, 'autoInstall');
      }

      // Placement is independent of automatic installation and uses the tool id
      // (which may be an alias), while completion is keyed by stable catalog id.
      if (!item.installed || !item.config || item.app?.defaultToolbar !== true
        || adapter.isCompleted(item.id, 'defaultToolbar')) continue;
      if (adapter.isPinned(item.toolId) || adapter.pin(item.toolId)) {
        await adapter.markCompleted(item.id, 'defaultToolbar');
      }
    } catch (error) {
      adapter.onError(entry.id, error);
    }
  }
}
