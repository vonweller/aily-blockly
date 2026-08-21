import { collectOpenAuthRequiredToolIds, isAuthRequiredTool } from './auth-required-tool';
import {
  closeAuthRequiredTools,
  ProtectedToolCloseError,
} from './auth-required-tool-close';
import { runAuthSessionInvalidation } from './auth-session-invalidation';
import {
  normalizeChildAuthStateSnapshot,
  resolveChildAuthStateSnapshot,
} from '../tools/child-tool-host/child-auth-state';
import { withSharedAccessToken } from './shared-auth-record';

describe('shared auth record', () => {
  it('keeps the access token readable by non-Electron child runtimes', () => {
    const original = {
      refresh_token: 'refresh-token',
      access_token: 'electron-safe-storage-ciphertext',
    };

    const result = withSharedAccessToken(
      original,
      'header.payload.signature',
      '2030-08-21T00:00:00.000Z',
    );

    expect(result).toEqual({
      refresh_token: 'refresh-token',
      access_token: 'header.payload.signature',
      updated_at: '2030-08-21T00:00:00.000Z',
    });
    expect(original.access_token).toBe('electron-safe-storage-ciphertext');
  });

  it('rejects an empty shared access token', () => {
    expect(() => withSharedAccessToken({}, '   ', '2030-08-21T00:00:00.000Z'))
      .toThrowError('Shared access token cannot be empty');
  });
});

describe('isAuthRequiredTool', () => {
  it('protects account, cloud, and Aily Chat', () => {
    expect(isAuthRequiredTool('user-center')).toBeTrue();
    expect(isAuthRequiredTool('cloud-space')).toBeTrue();
    expect(isAuthRequiredTool('aily-chat')).toBeTrue();
  });

  it('does not block local development tools or the app store', () => {
    expect(isAuthRequiredTool('serial-monitor')).toBeFalse();
    expect(isAuthRequiredTool('code-viewer')).toBeFalse();
    expect(isAuthRequiredTool('app-store')).toBeFalse();
  });

  it('collects embedded and detached protected tools without duplicates', () => {
    expect(collectOpenAuthRequiredToolIds(
      ['user-center', 'cloud-space', 'serial-monitor'],
      ['/child-tool/aily-chat', '/aily-chat', '/cloud-space', '/child-tool/aily-chat'],
    )).toEqual(['user-center', 'cloud-space', 'aily-chat']);
  });

  it('resolves hash routes reported by detached windows', () => {
    expect(collectOpenAuthRequiredToolIds([], [
      'http://localhost:4200/#/child-tool/aily-chat?standalone=true',
    ])).toEqual(['aily-chat']);
  });
});

describe('closeAuthRequiredTools', () => {
  it('uses the child lifecycle close path before the force-close fallback', async () => {
    const calls: string[] = [];

    await closeAuthRequiredTools(['aily-chat', 'cloud-space'], {
      isChildTool: (toolId) => toolId === 'aily-chat',
      prepareChildApp: async (toolId) => {
        calls.push(`prepare:${toolId}`);
        return { ok: true };
      },
      controlChildApp: async (toolId) => {
        calls.push(`lifecycle:${toolId}`);
        return { ok: toolId !== 'aily-chat' };
      },
      forceCloseToolEverywhere: async (toolId) => {
        calls.push(`force:${toolId}`);
        return true;
      },
    });

    expect(calls).toEqual([
      'prepare:aily-chat',
      'lifecycle:aily-chat',
      'force:aily-chat',
      'force:cloud-space',
    ]);
  });

  it('aborts when a protected tool cannot be closed', async () => {
    await expectAsync(closeAuthRequiredTools(['cloud-space'], {
      isChildTool: () => false,
      prepareChildApp: async () => ({ ok: true }),
      controlChildApp: async () => ({ ok: false }),
      forceCloseToolEverywhere: async () => false,
    })).toBeRejectedWith(jasmine.any(ProtectedToolCloseError));
  });

  it('does not close or force-close a child app when strict preparation fails', async () => {
    const controlChildApp = jasmine.createSpy('controlChildApp');
    const forceCloseToolEverywhere = jasmine.createSpy('forceCloseToolEverywhere');

    await expectAsync(closeAuthRequiredTools(['aily-chat'], {
      isChildTool: () => true,
      prepareChildApp: async () => ({ ok: false, message: 'active turn did not settle' }),
      controlChildApp,
      forceCloseToolEverywhere,
    })).toBeRejectedWith(jasmine.any(ProtectedToolCloseError));

    expect(controlChildApp).not.toHaveBeenCalled();
    expect(forceCloseToolEverywhere).not.toHaveBeenCalled();
  });
});

describe('runAuthSessionInvalidation', () => {
  it('saves and closes protected apps before clearing local auth and requesting login', async () => {
    const calls: string[] = [];

    const result = await runAuthSessionInvalidation({
      closeProtectedTools: async () => { calls.push('close'); },
      forceCloseProtectedTools: async () => { calls.push('force-close'); },
      stopProtectedRuntime: async () => { calls.push('stop-runtime'); },
      clearLocalAuthSession: async () => { calls.push('clear-auth'); },
      completeInvalidation: () => { calls.push('complete'); },
      showSessionReplacedNotice: () => { calls.push('notice'); },
      requestLogin: () => { calls.push('request-login'); },
    });

    expect(calls).toEqual([
      'close',
      'stop-runtime',
      'clear-auth',
      'complete',
      'notice',
      'request-login',
    ]);
    expect(result).toEqual({ gracefulCloseSucceeded: true, failures: [] });
  });

  it('forces closure and still clears auth when graceful child preparation fails', async () => {
    const calls: string[] = [];
    const failures: string[] = [];

    const result = await runAuthSessionInvalidation({
      closeProtectedTools: async () => {
        calls.push('close');
        throw new Error('prepare failed');
      },
      forceCloseProtectedTools: async () => { calls.push('force-close'); },
      stopProtectedRuntime: async () => { calls.push('stop-runtime'); },
      clearLocalAuthSession: async () => { calls.push('clear-auth'); },
      completeInvalidation: () => { calls.push('complete'); },
      showSessionReplacedNotice: () => { calls.push('notice'); },
      requestLogin: () => { calls.push('request-login'); },
      reportFailure: (stage) => { failures.push(stage); },
    });

    expect(calls).toEqual([
      'close',
      'force-close',
      'stop-runtime',
      'clear-auth',
      'complete',
      'notice',
      'request-login',
    ]);
    expect(failures).toEqual(['graceful-close']);
    expect(result).toEqual({
      gracefulCloseSucceeded: false,
      failures: ['graceful-close'],
    });
  });

  it('always settles the login recovery path after runtime or storage errors', async () => {
    const calls: string[] = [];

    const result = await runAuthSessionInvalidation({
      closeProtectedTools: async () => { calls.push('close'); },
      forceCloseProtectedTools: async () => { calls.push('force-close'); },
      stopProtectedRuntime: async () => {
        calls.push('stop-runtime');
        throw new Error('runtime failed');
      },
      clearLocalAuthSession: async () => {
        calls.push('clear-auth');
        throw new Error('storage failed');
      },
      completeInvalidation: () => { calls.push('complete'); },
      showSessionReplacedNotice: () => { calls.push('notice'); },
      requestLogin: () => { calls.push('request-login'); },
    });

    expect(calls.slice(-3)).toEqual(['complete', 'notice', 'request-login']);
    expect(result.failures).toEqual(['stop-runtime', 'clear-local-auth']);
  });
});

describe('detached Aily Chat auth state', () => {
  it('does not replace host auth with the detached renderer default before IPC hydration', () => {
    expect(resolveChildAuthStateSnapshot({
      detached: true,
      detachedSnapshot: null,
      authenticated: false,
      user: null,
      authSnapshot: null,
    })).toBeNull();
  });

  it('uses the token-free main-window snapshot for a detached renderer', () => {
    const snapshot = normalizeChildAuthStateSnapshot({
      authenticated: true,
      version: 4,
      user: {
        id: 'user-1',
        email: 'user@example.com',
        nickname: 'not-forwarded',
        access_token: 'not-forwarded',
      },
      quotaSnapshot: {
        quotaSnapshots: {
          chat_monthly: { entitlement: 30, remaining: 12, resetAt: '2030-08-21T00:00:00+08:00' },
        },
      },
    });

    expect(snapshot).toEqual({
      authenticated: true,
      user: { id: 'user-1', email: 'user@example.com' },
      quotaSnapshot: {
        quotaSnapshots: {
          chat_monthly: { entitlement: 30, remaining: 12, resetAt: '2030-08-21T00:00:00+08:00' },
        },
      },
    });
    expect(resolveChildAuthStateSnapshot({
      detached: true,
      detachedSnapshot: snapshot,
      authenticated: false,
      user: null,
      authSnapshot: null,
    })).toBe(snapshot);
  });
});
