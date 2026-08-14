import { PythonRuntimeClient } from './python-runtime-client';

describe('PythonRuntimeClient', () => {
  it('starts unavailable until backend status has been checked', () => {
    const client = new PythonRuntimeClient(createApi().api);
    expect(client.snapshot.runtimeAvailable).toBeFalse();
  });
  function createApi() {
    const listeners: Record<string, (value: any) => void> = {};
    const api: any = {
      status: async () => ({ state: 'ready', pid: 1234 }),
      detectBoards: async () => ({
        boards: [{ port: 'COM8', name: 'CyberCam', vid: '1234', pid: '5678' }],
      }),
      connect: async () => ({ boardType: 'k230', fwVersion: '1.0.0', protocolVersion: 1 }),
      disconnect: async () => undefined,
      runScript: async () => ({ status: 'ok' }),
      stopScript: async () => undefined,
      scriptRunning: async () => ({ running: false }),
      terminalInput: async () => ({ status: 'ok' }),
      terminalResize: async () => ({}),
      startPreview: async () => ({ streamId: 'default' }),
      stopPreview: async () => undefined,
      firmwareCommit: async () => ({ commitId: 'abc', fwVersion: '1.0.0', archStr: 'k230' }),
      virtualTouchStatus: async () => ({ supported: false, enabled: false }),
      virtualTouchEvent: async () => ({ accepted: false }),
      files: {
        listDir: async (path: string) => ({ path, entries: [] }),
        stat: async () => ({ exists: true, type: 'file', size: 3 }),
        readFile: async () => ({ dataBase64: 'YWJj' }),
        writeFile: async () => ({ success: true }),
        deleteFile: async () => ({ success: true }),
        renameFile: async () => ({ success: true }),
        mkdir: async () => ({ success: true }),
        rmdir: async () => ({ success: true }),
        exec: async () => ({ status: 'ok' }),
      },
      onEvent: (callback: (value: any) => void) => { listeners['event'] = callback; return () => {}; },
      onFrame: (callback: (value: any) => void) => { listeners['frame'] = callback; return () => {}; },
      onState: (callback: (value: any) => void) => { listeners['state'] = callback; return () => {}; },
      onStderr: (callback: (value: any) => void) => { listeners['stderr'] = callback; return () => {}; },
    };
    return { api, listeners };
  }

  function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: any) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }

  it('shares one in-flight initialization and registers bridge listeners once', async () => {
    const { api } = createApi();
    const status = deferred<{ state: 'ready'; pid: number }>();
    api.status = jasmine.createSpy('status').and.returnValue(status.promise);
    api.onEvent = jasmine.createSpy('onEvent').and.callFake(() => () => {});
    api.onFrame = jasmine.createSpy('onFrame').and.callFake(() => () => {});
    api.onState = jasmine.createSpy('onState').and.callFake(() => () => {});
    api.onStderr = jasmine.createSpy('onStderr').and.callFake(() => () => {});
    const client = new PythonRuntimeClient(api);

    const first = client.initialize();
    const second = client.initialize();

    expect(api.status).toHaveBeenCalledTimes(1);
    expect(api.onEvent).toHaveBeenCalledTimes(1);
    expect(api.onFrame).toHaveBeenCalledTimes(1);
    expect(api.onState).toHaveBeenCalledTimes(1);
    expect(api.onStderr).toHaveBeenCalledTimes(1);

    status.resolve({ state: 'ready', pid: 1234 });
    await Promise.all([first, second]);
  });

  it('cleans up a failed initialization and allows a clean retry', async () => {
    const { api } = createApi();
    const cleanup = [
      jasmine.createSpy('cleanupEvent'),
      jasmine.createSpy('cleanupFrame'),
      jasmine.createSpy('cleanupState'),
      jasmine.createSpy('cleanupStderr'),
    ];
    api.status = jasmine.createSpy('status').and.returnValues(
      Promise.reject(new Error('status unavailable')),
      Promise.resolve({ state: 'ready', pid: 1234 }),
    );
    api.onEvent = jasmine.createSpy('onEvent').and.returnValues(cleanup[0], () => {});
    api.onFrame = jasmine.createSpy('onFrame').and.returnValues(cleanup[1], () => {});
    api.onState = jasmine.createSpy('onState').and.returnValues(cleanup[2], () => {});
    api.onStderr = jasmine.createSpy('onStderr').and.returnValues(cleanup[3], () => {});
    const client = new PythonRuntimeClient(api);

    await expectAsync(client.initialize()).toBeRejectedWithError('status unavailable');

    for (const listenerCleanup of cleanup) {
      expect(listenerCleanup).toHaveBeenCalledTimes(1);
    }

    await client.initialize();
    expect(api.status).toHaveBeenCalledTimes(2);
    expect(api.onEvent).toHaveBeenCalledTimes(2);
    expect(client.snapshot.backendState).toBe('ready');
  });

  it('does not complete an initialization that was disposed while status was pending', async () => {
    const { api } = createApi();
    const status = deferred<{ state: 'ready'; pid: number }>();
    const cleanup = jasmine.createSpy('cleanup');
    api.status = jasmine.createSpy('status').and.returnValues(
      status.promise,
      Promise.resolve({ state: 'ready', pid: 4321 }),
    );
    api.onEvent = jasmine.createSpy('onEvent').and.returnValue(cleanup);
    api.onFrame = jasmine.createSpy('onFrame').and.returnValue(() => {});
    api.onState = jasmine.createSpy('onState').and.returnValue(() => {});
    api.onStderr = jasmine.createSpy('onStderr').and.returnValue(() => {});
    const client = new PythonRuntimeClient(api);

    const pending = client.initialize();
    client.dispose();
    status.resolve({ state: 'ready', pid: 1234 });
    await pending;

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(client.snapshot.runtimeAvailable).toBeFalse();
    expect(client.snapshot.backendState).toBe('stopped');

    await client.initialize();
    expect(api.status).toHaveBeenCalledTimes(2);
    expect(client.snapshot.backendState).toBe('ready');
  });

  it('tracks board detection and connection state', async () => {
    const { api } = createApi();
    const client = new PythonRuntimeClient(api);

    await client.initialize();
    const boards = await client.detectBoards();
    await client.connect('COM8');

    expect(boards.map(board => board.port)).toEqual(['COM8']);
    expect(client.snapshot.backendState).toBe('ready');
    expect(client.snapshot.connectionState).toBe('connected');
    expect(client.snapshot.port).toBe('COM8');
    expect(client.snapshot.boardInfo?.['boardType']).toBe('k230');
  });

  it('forwards script output and tracks run and stop state', async () => {
    const { api, listeners } = createApi();
    const client = new PythonRuntimeClient(api);
    const output: string[] = [];
    client.terminalOutput$.subscribe(text => output.push(text));
    await client.initialize();

    await client.runScript('print(1)');
    listeners['event']({ event: 'scriptOutput', params: { text: '1\r\n' } });
    expect(client.snapshot.running).toBeTrue();
    expect(output).toEqual(['1\r\n']);

    await client.stopScript();
    expect(client.snapshot.running).toBeFalse();
  });

  it('returns to disconnected state when the backend reports board loss', async () => {
    const { api, listeners } = createApi();
    const client = new PythonRuntimeClient(api);
    await client.initialize();
    await client.connect('COM8');

    listeners['event']({ event: 'boardDisconnected', params: {} });

    expect(client.snapshot.connectionState).toBe('disconnected');
    expect(client.snapshot.running).toBeFalse();
    expect(client.snapshot.previewing).toBeFalse();
  });

  it('invalidates the connected device session when the backend stops', async () => {
    const { api, listeners } = createApi();
    const client = new PythonRuntimeClient(api);
    await client.initialize();
    await client.detectBoards();
    await client.connect('COM8');
    await client.runScript('while True: pass');
    await client.startPreview();

    listeners['state']('stopped');

    expect(client.snapshot).toEqual(jasmine.objectContaining({
      backendState: 'stopped',
      connectionState: 'disconnected',
      boards: [],
      port: null,
      boardInfo: null,
      running: false,
      previewing: false,
    }));
  });

  it('invalidates the connected session after a timed-out request stops the backend', async () => {
    const { api } = createApi();
    api.runScript = async () => {
      const error: any = new Error('CanMV request timed out: runScript');
      error.code = 1002;
      throw error;
    };
    const client = new PythonRuntimeClient(api);
    await client.initialize();
    await client.connect('COM8');
    await client.startPreview();

    await expectAsync(client.runScript('while True: pass')).toBeRejectedWithError(/timed out/);

    expect(client.snapshot.connectionState).toBe('disconnected');
    expect(client.snapshot.port).toBeNull();
    expect(client.snapshot.boardInfo).toBeNull();
    expect(client.snapshot.running).toBeFalse();
    expect(client.snapshot.previewing).toBeFalse();
  });

  it('does not restore stale detected boards after the backend stops', async () => {
    const { api, listeners } = createApi();
    const detection = deferred<{ boards: any[] }>();
    api.detectBoards = () => detection.promise;
    const client = new PythonRuntimeClient(api);
    await client.initialize();

    const pending = client.detectBoards();
    listeners['state']('stopped');
    detection.resolve({
      boards: [{ port: 'COM8', name: 'Old board', vid: '1234', pid: '5678' }],
    });
    await pending;

    expect(client.snapshot.boards).toEqual([]);
    expect(client.snapshot.connectionState).toBe('disconnected');
  });

  it('does not restore a stale connection or preview after board loss', async () => {
    const { api, listeners } = createApi();
    const connection = deferred<Record<string, any>>();
    const preview = deferred<{ streamId: string }>();
    api.connect = () => connection.promise;
    api.startPreview = () => preview.promise;
    const client = new PythonRuntimeClient(api);
    await client.initialize();

    const pendingConnection = client.connect('COM8');
    listeners['event']({ event: 'boardDisconnected', params: {} });
    connection.resolve({ boardType: 'k230' });
    await pendingConnection;

    expect(client.snapshot.port).toBeNull();
    expect(client.snapshot.connectionState).toBe('disconnected');

    const pendingPreview = client.startPreview();
    listeners['state']('stopped');
    preview.resolve({ streamId: 'stale' });
    await pendingPreview;

    expect(client.snapshot.previewing).toBeFalse();
  });

  it('serializes disconnect after an in-flight connect so no device connection is left behind', async () => {
    const { api } = createApi();
    const connection = deferred<Record<string, any>>();
    const order: string[] = [];
    api.connect = jasmine.createSpy('connect').and.callFake(async () => {
      order.push('connect-started');
      const result = await connection.promise;
      order.push('connect-finished');
      return result;
    });
    api.disconnect = jasmine.createSpy('disconnect').and.callFake(async () => {
      order.push('disconnect');
    });
    const client = new PythonRuntimeClient(api);
    await client.initialize();

    const pendingConnection = client.connect('COM8');
    await Promise.resolve();
    const pendingDisconnect = client.disconnect();

    expect(api.disconnect).not.toHaveBeenCalled();

    connection.resolve({ boardType: 'k230' });
    await pendingConnection;
    await pendingDisconnect;

    expect(order).toEqual(['connect-started', 'connect-finished', 'disconnect']);
    expect(client.snapshot.connectionState).toBe('disconnected');
    expect(client.snapshot.port).toBeNull();
  });

  it('serializes a new connect after disconnect so the old disconnect cannot clear it', async () => {
    const { api } = createApi();
    const disconnection = deferred<void>();
    api.disconnect = jasmine.createSpy('disconnect').and.returnValue(disconnection.promise);
    api.connect = jasmine.createSpy('connect').and.resolveTo({ boardType: 'k230-new' });
    const client = new PythonRuntimeClient(api);
    await client.initialize();
    await client.connect('COM8');

    const pendingDisconnect = client.disconnect();
    await Promise.resolve();
    const pendingConnection = client.connect('COM9');

    expect(api.connect).toHaveBeenCalledTimes(1);

    disconnection.resolve();
    await pendingDisconnect;
    await pendingConnection;

    expect(api.connect).toHaveBeenCalledTimes(2);
    expect(client.snapshot.connectionState).toBe('connected');
    expect(client.snapshot.port).toBe('COM9');
    expect(client.snapshot.boardInfo?.['boardType']).toBe('k230-new');
  });

  it('does not let a stale disconnect timeout invalidate a newer queued connection', async () => {
    const { api } = createApi();
    const disconnection = deferred<void>();
    api.disconnect = jasmine.createSpy('disconnect').and.returnValue(disconnection.promise);
    api.connect = jasmine.createSpy('connect').and.resolveTo({ boardType: 'k230-new' });
    const client = new PythonRuntimeClient(api);
    await client.initialize();
    await client.connect('COM8');

    const pendingDisconnect = client.disconnect();
    await Promise.resolve();
    const pendingConnection = client.connect('COM9');
    const timeout: any = new Error('CanMV request timed out: disconnectBoard');
    timeout.code = 1002;
    disconnection.reject(timeout);

    await expectAsync(pendingDisconnect).toBeRejectedWithError(/timed out/);
    await pendingConnection;

    expect(client.snapshot.connectionState).toBe('connected');
    expect(client.snapshot.port).toBe('COM9');
    expect(client.snapshot.boardInfo?.['boardType']).toBe('k230-new');
  });

  it('disconnects after a pending connect when disposed during shutdown', async () => {
    const { api } = createApi();
    const connection = deferred<Record<string, any>>();
    api.connect = jasmine.createSpy('connect').and.returnValue(connection.promise);
    api.disconnect = jasmine.createSpy('disconnect').and.resolveTo(undefined);
    const client = new PythonRuntimeClient(api);
    await client.initialize();

    const pendingConnection = client.connect('COM8');
    await Promise.resolve();
    client.dispose();

    expect(api.disconnect).not.toHaveBeenCalled();

    connection.resolve({ boardType: 'k230' });
    await pendingConnection;
    await Promise.resolve();

    expect(api.disconnect).toHaveBeenCalledTimes(1);
    expect(client.snapshot.connectionState).toBe('disconnected');
    expect(client.snapshot.port).toBeNull();
  });

  it('serializes a new script run after a delayed stop response', async () => {
    const { api, listeners } = createApi();
    const stopped = deferred<void>();
    api.stopScript = jasmine.createSpy('stopScript').and.returnValue(stopped.promise);
    api.runScript = jasmine.createSpy('runScript').and.resolveTo({ status: 'ok' });
    const client = new PythonRuntimeClient(api);
    await client.initialize();
    listeners['event']({ event: 'scriptState', params: { state: 'started' } });

    const pendingStop = client.stopScript();
    await Promise.resolve();
    const pendingRun = client.runScript('print("new")');

    expect(api.runScript).not.toHaveBeenCalled();

    stopped.resolve();
    await pendingStop;
    await pendingRun;

    expect(api.runScript).toHaveBeenCalledTimes(1);
    expect(client.snapshot.running).toBeTrue();
  });

  it('serializes a new preview after a delayed stop response', async () => {
    const { api } = createApi();
    const stopped = deferred<void>();
    const client = new PythonRuntimeClient(api);
    await client.initialize();
    await client.connect('COM8');
    await client.startPreview();
    api.stopPreview = jasmine.createSpy('stopPreview').and.returnValue(stopped.promise);
    api.startPreview = jasmine.createSpy('startPreview').and.resolveTo({ streamId: 'new' });

    const pendingStop = client.stopPreview();
    await Promise.resolve();
    const pendingStart = client.startPreview();

    expect(api.startPreview).not.toHaveBeenCalled();

    stopped.resolve();
    await pendingStop;
    await pendingStart;

    expect(api.startPreview).toHaveBeenCalledTimes(1);
    expect(client.snapshot.previewing).toBeTrue();
  });

  it('shares one in-flight board detection request', async () => {
    const { api } = createApi();
    const detection = deferred<{ boards: any[] }>();
    api.detectBoards = jasmine.createSpy('detectBoards').and.returnValue(detection.promise);
    const client = new PythonRuntimeClient(api);
    await client.initialize();

    const first = client.detectBoards();
    const second = client.detectBoards();
    detection.resolve({ boards: [] });

    expect(await first).toEqual([]);
    expect(await second).toEqual([]);
    expect(api.detectBoards).toHaveBeenCalledTimes(1);
  });

  it('tracks backend script state events', async () => {
    const { api, listeners } = createApi();
    const client = new PythonRuntimeClient(api);
    await client.initialize();

    listeners['event']({ event: 'scriptState', params: { state: 'started' } });
    expect(client.snapshot.running).toBeTrue();

    listeners['event']({ event: 'scriptState', params: { state: 'finished' } });
    expect(client.snapshot.running).toBeFalse();
  });

  it('treats scriptState error as a terminal state and exposes its message', async () => {
    const { api, listeners } = createApi();
    const client = new PythonRuntimeClient(api);
    const output: string[] = [];
    client.terminalOutput$.subscribe(text => output.push(text));
    await client.initialize();

    listeners['event']({ event: 'scriptState', params: { state: 'started' } });
    listeners['event']({
      event: 'scriptState',
      params: { state: 'error', message: 'NameError: missing_name' },
    });

    expect(client.snapshot.running).toBeFalse();
    expect(client.snapshot.error).toBe('NameError: missing_name');
    expect(output).toEqual(['NameError: missing_name\r\n']);
  });

  it('does not restore running when scriptState error arrives before runScript returns', async () => {
    const { api, listeners } = createApi();
    let resolveRun!: (result: { status: 'ok' }) => void;
    api.runScript = () => new Promise(resolve => {
      resolveRun = resolve;
    });
    const client = new PythonRuntimeClient(api);
    await client.initialize();

    const run = client.runScript('missing_name()');
    listeners['event']({
      event: 'scriptState',
      params: { state: 'error', error: 'NameError: missing_name' },
    });
    resolveRun({ status: 'ok' });
    await run;

    expect(client.snapshot.running).toBeFalse();
    expect(client.snapshot.error).toBe('NameError: missing_name');
  });

  it('does not restore running after a fast script finishes before runScript returns', async () => {
    const { api, listeners } = createApi();
    let resolveRun!: (result: { status: 'ok' }) => void;
    api.runScript = () => new Promise(resolve => {
      resolveRun = resolve;
    });
    const client = new PythonRuntimeClient(api);
    await client.initialize();

    const run = client.runScript('print("fast")');
    listeners['event']({ event: 'scriptState', params: { state: 'started' } });
    listeners['event']({ event: 'scriptState', params: { state: 'finished' } });
    resolveRun({ status: 'ok' });
    await run;

    expect(client.snapshot.running).toBeFalse();
  });

  it('reads and writes UTF-8 remote text files', async () => {
    const { api } = createApi();
    let written = '';
    api.files.readFile = async () => ({ dataBase64: '5L2g5aW9' });
    api.files.writeFile = async (_path: string, dataBase64: string) => {
      written = dataBase64;
      return { success: true };
    };
    const client = new PythonRuntimeClient(api);

    expect(await client.readRemoteTextFile('/main.py')).toBe('你好');
    await client.writeRemoteTextFile('/main.py', 'print("你好")');

    const binary = atob(written);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe('print("你好")');
  });
});
