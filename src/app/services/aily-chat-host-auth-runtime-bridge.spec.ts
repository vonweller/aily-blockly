import {
  createAilyHostAuthRequestHandler,
  type AilyHostAuthRuntimeAuthService,
} from './aily-chat-host-auth-runtime-bridge';

describe('Aily Chat host auth Runtime bridge', () => {
  function createAuthService(
    overrides: Partial<AilyHostAuthRuntimeAuthService> = {},
  ): AilyHostAuthRuntimeAuthService {
    let generation = 4;
    return {
      isLoggedIn: true,
      isSessionInvalidating: false,
      initializeAuth: async () => undefined,
      getToken2: async () => 'host-access-token',
      getAuthCredentialGeneration: () => generation,
      refreshAuthToken: async () => {
        generation += 1;
        return true;
      },
      logout: async () => {
        generation += 1;
      },
      ...overrides,
    };
  }

  it('returns the current host access token with its credential generation', async () => {
    const initializeAuth = jasmine.createSpy('initializeAuth').and.resolveTo();
    const handle = createAilyHostAuthRequestHandler(
      createAuthService({ initializeAuth }),
      () => 'https://selected.example///',
    );

    expect(await handle({ operation: 'access-token' })).toEqual({
      ok: true,
      authenticated: true,
      accessToken: 'host-access-token',
      apiServer: 'https://selected.example',
      generation: 4,
    });
    expect(initializeAuth).not.toHaveBeenCalled();
  });

  it('does not issue a credential lease without the API server that issued it', async () => {
    const handle = createAilyHostAuthRequestHandler(
      createAuthService(),
      () => 'file:///tmp/not-an-api',
    );

    const result = await handle({ operation: 'access-token' });

    expect(result.ok).toBeFalse();
    expect(result.errorCode).toBe('HOST_API_SERVER_UNAVAILABLE');
    expect(result.accessToken).toBeUndefined();
  });

  it('returns the newer host token without refreshing a stale rejected generation', async () => {
    const refreshAuthToken = jasmine.createSpy('refreshAuthToken').and.resolveTo(true);
    const handle = createAilyHostAuthRequestHandler(createAuthService({ refreshAuthToken }));

    const result = await handle({ operation: 'refresh-access-token', rejectedGeneration: 3 });

    expect(result.ok).toBeTrue();
    expect(result.generation).toBe(4);
    expect(refreshAuthToken).not.toHaveBeenCalled();
  });

  it('coalesces matching-generation refresh requests through the host', async () => {
    let resolveRefresh!: (value: boolean) => void;
    const refresh = new Promise<boolean>(resolve => { resolveRefresh = resolve; });
    const refreshAuthToken = jasmine.createSpy('refreshAuthToken').and.returnValue(refresh);
    const handle = createAilyHostAuthRequestHandler(createAuthService({ refreshAuthToken }));

    const first = handle({ operation: 'refresh-access-token', rejectedGeneration: 4 });
    const second = handle({ operation: 'refresh-access-token', rejectedGeneration: 4 });
    resolveRefresh(true);

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.ok).toBeTrue();
    expect(secondResult.ok).toBeTrue();
    expect(refreshAuthToken).toHaveBeenCalledTimes(1);
  });

  it('delegates logout to the host and returns no credential', async () => {
    const logout = jasmine.createSpy('logout').and.resolveTo();
    const handle = createAilyHostAuthRequestHandler(createAuthService({ logout }));

    const result = await handle({ operation: 'logout' });

    expect(result).toEqual({ ok: true, authenticated: false, generation: 4 });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('does not expose a credential while the host is signed out', async () => {
    const initializeAuth = jasmine.createSpy('initializeAuth').and.resolveTo();
    const handle = createAilyHostAuthRequestHandler(createAuthService({
      isLoggedIn: false,
      initializeAuth,
    }));

    const result = await handle({ operation: 'access-token' });

    expect(initializeAuth).toHaveBeenCalledTimes(1);
    expect(result.ok).toBeFalse();
    expect(result.errorCode).toBe('AUTH_SIGNED_OUT');
    expect(result.accessToken).toBeUndefined();
  });
});
