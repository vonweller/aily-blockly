import {
  decodeRemoteFileContent,
  encodeRemoteFileContent,
} from './remote-file-codec';

describe('remote file codec', () => {
  it('decodes both base64 and legacy byte-array responses', () => {
    expect(Array.from(decodeRemoteFileContent({ dataBase64: 'YWJj' }))).toEqual([97, 98, 99]);
    expect(Array.from(decodeRemoteFileContent({ data: [0, 127, 255] }))).toEqual([0, 127, 255]);
  });

  it('encodes binary file content as base64', () => {
    expect(encodeRemoteFileContent(new Uint8Array([0, 127, 255]))).toBe('AH//');
  });

  it('rejects malformed remote file responses', () => {
    expect(() => decodeRemoteFileContent({ data: [256] })).toThrowError(/invalid byte/);
    expect(() => decodeRemoteFileContent({})).toThrowError(/does not contain file data/);
  });
});
