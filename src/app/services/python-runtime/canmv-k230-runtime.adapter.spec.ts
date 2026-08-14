import { CanmvK230RuntimeAdapter } from './canmv-k230-runtime.adapter';

describe('CanmvK230RuntimeAdapter', () => {
  it('exposes the embedded runtime without starting it and disposes idempotently', () => {
    const runtime = {
      available: true,
      dispose: jasmine.createSpy('dispose'),
    };
    const adapter = new CanmvK230RuntimeAdapter(runtime as any);

    expect(adapter.id).toBe('canmv-k230');
    expect(adapter.available).toBeTrue();
    expect(adapter.runtime).toBe(runtime as any);
    expect(runtime.dispose).not.toHaveBeenCalled();

    adapter.dispose();
    adapter.dispose();
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });
});
