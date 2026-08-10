import { PythonRuntimeClient } from './python-runtime-client';

describe('PythonRuntimeClient', () => {
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

  it('tracks backend script state events', async () => {
    const { api, listeners } = createApi();
    const client = new PythonRuntimeClient(api);
    await client.initialize();

    listeners['event']({ event: 'scriptState', params: { state: 'started' } });
    expect(client.snapshot.running).toBeTrue();

    listeners['event']({ event: 'scriptState', params: { state: 'finished' } });
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
