export interface RemoteFileReadResult {
  data?: number[];
  dataBase64?: string;
}

export function decodeRemoteFileContent(result: RemoteFileReadResult): Uint8Array {
  if (typeof result?.dataBase64 === 'string') {
    const binary = atob(result.dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  if (Array.isArray(result?.data)) {
    for (const byte of result.data) {
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
        throw new TypeError('Remote file response contains an invalid byte');
      }
    }
    return Uint8Array.from(result.data);
  }
  throw new TypeError('Remote file response does not contain file data');
}

export function encodeRemoteFileContent(content: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < content.length; offset += chunkSize) {
    binary += String.fromCharCode(...content.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
