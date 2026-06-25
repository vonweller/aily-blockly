// 扩展 Window 接口以包含 electronAPI
declare global {
  interface Window {
    openAndSendToAilyChat: (text: string, options?: Record<string, any>) => void;
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
      /** 系统文件管理器高亮（如访达、资源管理器） */
      shell?: {
        showItemInFolder: (fullPath: string) => void;
      };
      clipboard?: {
        writeText: (text: string) => void;
        readText: () => string;
      };
      terminal: any;
      ailyServicesStream?: {
        start: (data: any) => Promise<{ ok?: boolean; streamId?: string; error?: string }>;
        cancel: (streamId: string) => Promise<any>;
        onEvent: (streamId: string, callback: (payload: any) => void) => () => void;
      };
      chatRuntimeHost?: {
        registerExecutionWorker: (executionWorkerId: string) => Promise<{ ok?: boolean; executionWorkerId?: string }>;
        unregisterExecutionWorker: (executionWorkerId: string) => Promise<{ ok?: boolean }>;
        registerResourceOperationHandler: (handlerId: string) => Promise<{ ok?: boolean; handlerId?: string }>;
        unregisterResourceOperationHandler: (handlerId: string) => Promise<{ ok?: boolean }>;
        call: (method: string, args: readonly unknown[]) => Promise<unknown>;
        onExecutionWorkerCommand: (callback: (payload: unknown) => void) => () => void;
        onResourceOperationCommand: (callback: (payload: unknown) => void) => () => void;
        sendExecutionWorkerResponse: (payload: unknown) => void;
        sendResourceOperationResponse: (payload: unknown) => void;
        emitExecutionWorkerEvent: (payload: unknown) => void;
        onEvent: (callback: (payload: any) => void) => () => void;
      };
      iWindow: any;
      subWindow: any;
      coderEmbed: {
        getBaseUrl: () => Promise<string>;
      };
      codeViewer: any;
      builder: any;
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
      updater: any;
      mcp: any;
      versions: () => any;
    };
  }
}

export {};
