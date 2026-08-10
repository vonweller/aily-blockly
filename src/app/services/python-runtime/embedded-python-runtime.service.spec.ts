import {
  createUnavailablePythonRuntimeBridge,
} from './embedded-python-runtime.service';
import { PythonRuntimeClient } from './python-runtime-client';

describe('embedded Python runtime fallback', () => {
  it('can initialize without Electron and reports runtime actions as unavailable', async () => {
    const client = new PythonRuntimeClient(createUnavailablePythonRuntimeBridge());

    await client.initialize();

    expect(client.snapshot.backendState).toBe('stopped');
    await expectAsync(client.detectBoards()).toBeRejectedWithError(/Electron application/);
  });
});
