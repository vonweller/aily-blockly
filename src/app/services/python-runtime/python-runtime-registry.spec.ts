import type { PythonRuntimeMetadata } from './python-mode';
import type { PythonRuntimeAdapter } from './python-runtime-adapter';
import { PythonRuntimeRegistry } from './python-runtime-registry';

describe('PythonRuntimeRegistry', () => {
  const metadata: PythonRuntimeMetadata = {
    kind: 'python',
    adapter: 'canmv-k230',
    entry: 'main.py',
  };

  it('resolves an adapter from board runtime metadata', () => {
    const validateMetadata = jasmine.createSpy('validateMetadata');
    const canmvAdapter = { id: 'canmv-k230', validateMetadata } as unknown as PythonRuntimeAdapter;
    const registry = new PythonRuntimeRegistry([canmvAdapter]);

    expect(registry.resolve(metadata)).toBe(canmvAdapter);
    expect(validateMetadata).toHaveBeenCalledOnceWith(metadata);
  });

  it('rejects unsupported or malformed adapter metadata', () => {
    const registry = new PythonRuntimeRegistry([{ id: 'canmv-k230' } as PythonRuntimeAdapter]);

    expect(() => registry.resolve({ ...metadata, adapter: 'missing' }))
      .toThrowError(/Unsupported Python runtime adapter: missing/);
    expect(() => registry.resolve(null as any))
      .toThrowError(/valid Python runtime metadata/);
  });
});
