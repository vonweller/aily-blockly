import { editorLanguageForPath, editorOptionsForPath } from './editor-language';

describe('editorLanguageForPath', () => {
  it('selects Python for Python source and stub files', () => {
    expect(editorLanguageForPath('src/main.py')).toBe('python');
    expect(editorLanguageForPath('stubs/image.pyi')).toBe('python');
  });

  it('selects the expected Monaco language for common project files', () => {
    expect(editorLanguageForPath('package.json')).toBe('json');
    expect(editorLanguageForPath('README.md')).toBe('markdown');
    expect(editorLanguageForPath('src/main.cpp')).toBe('cpp');
    expect(editorLanguageForPath('include/main.h')).toBe('cpp');
  });

  it('falls back to plaintext for unknown extensions', () => {
    expect(editorLanguageForPath('assets/model.kmodel')).toBe('plaintext');
  });

  it('updates only the language when applying editor options for a file', () => {
    expect(editorOptionsForPath({ theme: 'vs-dark', automaticLayout: true }, 'main.py')).toEqual({
      theme: 'vs-dark',
      automaticLayout: true,
      language: 'python',
    });
  });
});
