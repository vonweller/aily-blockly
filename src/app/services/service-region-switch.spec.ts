import {
  SERVICE_REGION_LOGIN_REASON,
  switchServiceRegionAndRequestLogin,
} from './service-region-switch';

describe('switchServiceRegionAndRequestLogin', () => {
  it('logs out from the old region before switching and opening login', async () => {
    const calls: string[] = [];

    await switchServiceRegionAndRequestLogin('eu', {
      closeProtectedTools: async () => { calls.push('close-protected-tools'); },
      logout: async () => { calls.push('logout'); },
      setRegion: async (regionKey) => { calls.push(`set-region:${regionKey}`); },
      requestLogin: (reason) => { calls.push(`request-login:${reason}`); },
    });

    expect(calls).toEqual([
      'close-protected-tools',
      'logout',
      'set-region:eu',
      `request-login:${SERVICE_REGION_LOGIN_REASON}`,
    ]);
  });

  it('does not switch region or request login when logout fails', async () => {
    const setRegion = jasmine.createSpy('setRegion');
    const requestLogin = jasmine.createSpy('requestLogin');

    await expectAsync(switchServiceRegionAndRequestLogin('eu', {
      closeProtectedTools: async () => undefined,
      logout: async () => { throw new Error('logout failed'); },
      setRegion,
      requestLogin,
    })).toBeRejectedWithError('logout failed');

    expect(setRegion).not.toHaveBeenCalled();
    expect(requestLogin).not.toHaveBeenCalled();
  });

  it('does not open login until the new region has been applied', async () => {
    const requestLogin = jasmine.createSpy('requestLogin');

    await expectAsync(switchServiceRegionAndRequestLogin('eu', {
      closeProtectedTools: async () => undefined,
      logout: async () => undefined,
      setRegion: async () => { throw new Error('switch failed'); },
      requestLogin,
    })).toBeRejectedWithError('switch failed');

    expect(requestLogin).not.toHaveBeenCalled();
  });

  it('does not log out or switch region when a protected tool cannot close', async () => {
    const logout = jasmine.createSpy('logout');
    const setRegion = jasmine.createSpy('setRegion');
    const requestLogin = jasmine.createSpy('requestLogin');

    await expectAsync(switchServiceRegionAndRequestLogin('eu', {
      closeProtectedTools: async () => { throw new Error('close failed'); },
      logout,
      setRegion,
      requestLogin,
    })).toBeRejectedWithError('close failed');

    expect(logout).not.toHaveBeenCalled();
    expect(setRegion).not.toHaveBeenCalled();
    expect(requestLogin).not.toHaveBeenCalled();
  });
});
