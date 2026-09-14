import { ConnectionGraphService } from './connection-graph.service';

describe('ConnectionGraphService subwindow save', () => {
  const channel = 'iframe-message-connection-graph';
  let previousIpcRenderer: unknown;

  beforeEach(() => {
    previousIpcRenderer = window['ipcRenderer'];
  });

  afterEach(() => {
    window['ipcRenderer'] = previousIpcRenderer;
  });

  it('round-trips toolbar switches, theme and graph data without renderer-only configs', () => {
    let onMessage: (_event: unknown, payload: { type: string; data: any }) => void = () => {};
    const sent: Array<{ channel: string; payload: any }> = [];
    window['ipcRenderer'] = {
      on: (_channel: string, callback: typeof onMessage) => { onMessage = callback; },
      send: (sentChannel: string, payload: any) => sent.push({ channel: sentChannel, payload }),
    };
    const writes: Array<{ path: string; content: string }> = [];
    let storedContent = JSON.stringify({
      version: '1.0.0', description: 'Existing wiring notes', components: [], connections: [],
      theme: 'dark', animation: false, autoSave: true,
    });
    const electron = {
      isElectron: true,
      pathJoin: (...parts: string[]) => parts.join('/'),
      exists: () => true,
      readFile: () => storedContent,
      writeFile: (path: string, content: string) => {
        writes.push({ path, content });
        storedContent = content;
      },
    };
    const service = new ConnectionGraphService(electron as never, { currentProjectPath: '/project' } as never);

    onMessage(null, {
      type: 'save-graph-data',
      data: {
        messageId: 'request-1',
        components: [{ refId: 'board', x: 24, y: 48 }],
        connections: [{ id: 'wire-1', vertices: [{ x: 10, y: 20 }] }],
        componentConfigs: { board: { pins: ['large-render-only-data'] } },
        theme: 'light',
        edit: true,
        animation: true,
        autoRoutingMode: false,
        connectionTypeCheck: true,
        autoSave: false,
      },
    });

    expect(writes).toHaveSize(1);
    expect(writes[0].path).toBe('/project/connection_output.json');
    expect(JSON.parse(writes[0].content)).toEqual({
      version: '1.0.0',
      description: 'Existing wiring notes',
      components: [{ refId: 'board', x: 24, y: 48 }],
      connections: [{ id: 'wire-1', vertices: [{ x: 10, y: 20 }] }],
      theme: 'light',
      edit: true,
      animation: true,
      autoRoutingMode: false,
      connectionTypeCheck: true,
      autoSave: false,
    });
    expect(service.getConnectionGraph()).toEqual(JSON.parse(writes[0].content));
    expect(sent).toEqual([{ channel, payload: {
      type: 'save-graph-data-result',
      data: { messageId: 'request-1', success: true },
    } }]);
  });
});
