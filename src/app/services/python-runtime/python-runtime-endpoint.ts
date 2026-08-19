export type PythonRuntimeEndpoint =
  | {
    kind: 'canmv';
    port: string;
    baudRate: number;
  }
  | {
    kind: 'ssh';
    host: string;
    port: number;
    username: string;
    credentialId?: string;
    privateKeyPath?: string;
  }
  | {
    kind: 'serial-shell';
    port: string;
    baudRate: number;
  };

export interface PythonRuntimeCredentials {
  password?: string;
  passphrase?: string;
}
