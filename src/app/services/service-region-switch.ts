export const SERVICE_REGION_LOGIN_REASON = 'service-region-changed';

export interface ServiceRegionSwitchDependencies {
  closeProtectedTools: () => Promise<void>;
  logout: () => Promise<void>;
  setRegion: (regionKey: string) => Promise<void>;
  requestLogin: (reason: string) => void;
}

/**
 * Keep the region switch on the main-window auth/config instance so the old
 * account is cleared before the new server is used by the login dialog.
 */
export async function switchServiceRegionAndRequestLogin(
  regionKey: string,
  dependencies: ServiceRegionSwitchDependencies,
): Promise<void> {
  const normalizedRegionKey = regionKey.trim();
  if (!normalizedRegionKey) {
    throw new Error('Service region is required');
  }

  await dependencies.closeProtectedTools();
  await dependencies.logout();
  await dependencies.setRegion(normalizedRegionKey);
  dependencies.requestLogin(SERVICE_REGION_LOGIN_REASON);
}
