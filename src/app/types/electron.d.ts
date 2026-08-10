interface PythonRuntimeBoard {
  port: string;
  name: string;
  vid: string;
  pid: string;
  serialNumber?: string;
  description?: string;
}

interface PythonRuntimeApi {
  status: () => Promise<{ state: 'stopped' | 'starting' | 'ready'; pid: number | null; executable: string }>;
  detectBoards: () => Promise<{ boards: PythonRuntimeBoard[] }>;
  connect: (options: { port: string; baudRate?: number }) => Promise<any>;
  disconnect: () => Promise<void>;
  runScript: (script: string) => Promise<{ status: 'ok' | 'error'; output?: string; message?: string }>;
  stopScript: () => Promise<void>;
  scriptRunning: () => Promise<{ running: boolean }>;
  terminalInput: (text: string) => Promise<{ status: 'ok' | 'error'; message?: string }>;
  terminalResize: (columns: number, rows: number) => Promise<Record<string, never>>;
  startPreview: (options?: { fps?: number; resolution?: { w: number; h: number } }) => Promise<{ streamId: string }>;
  stopPreview: () => Promise<void>;
  files: {
    listDir: (path: string) => Promise<any>;
    stat: (path: string) => Promise<any>;
    readFile: (path: string) => Promise<{ data?: number[]; dataBase64?: string }>;
    writeFile: (path: string, dataBase64: string) => Promise<{ success: boolean }>;
    deleteFile: (path: string) => Promise<{ success: boolean; errorCode?: number }>;
    renameFile: (oldPath: string, newPath: string) => Promise<{ success: boolean; errorCode?: number }>;
    mkdir: (path: string) => Promise<{ success: boolean; errorCode?: number }>;
    rmdir: (path: string) => Promise<{ success: boolean; errorCode?: number }>;
    exec: (path: string) => Promise<{ status: string; message?: string }>;
  };
  firmwareCommit: () => Promise<{ commitId: string; fwVersion: string; archStr: string }>;
  virtualTouchStatus: () => Promise<any>;
  virtualTouchEvent: (options: any) => Promise<{ accepted: boolean }>;
  onEvent: (callback: (event: any) => void) => () => void;
  onFrame: (callback: (frame: { frameId: number; data: Uint8Array }) => void) => () => void;
  onState: (callback: (state: string) => void) => () => void;
  onStderr: (callback: (text: string) => void) => () => void;
}

// 扩展 Window 接口以包含 electronAPI
declare global {
  interface Window {
    electronAPI: {
      SerialPort: {
        list: () => Promise<any[]>;
        create: (options: any) => any;
        createRaw: (options: any) => any;
      };
      safeStorage: {
        isEncryptionAvailable: () => boolean;
        encryptString: (plainText: string) => Buffer;
        decryptString: (encrypted: Buffer) => string;
      };
      ipcRenderer: any;
      path: any;
      platform: any;
      terminal: any;
      iWindow: any;
      subWindow: any;
      codeViewer: any;
      builder: any;
      linter: any;
      uploader: any;
      fs: any;
      ble: any;
      wifi: any;
      dialog: any;
      other: any;
      env: any;
      npm: any;
      cmd: any;
      probeRs: any;
      pythonRuntime: PythonRuntimeApi;
      updater: any;
      mcp: any;
      versions: () => any;
    };
  }
}

export {};
