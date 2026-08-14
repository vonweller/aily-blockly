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

  it('accepts only compatible declared CanMV execution and deployment profiles', () => {
    const adapter: any = new CanmvK230RuntimeAdapter({
      available: true,
      dispose: () => undefined,
    } as any);
    const metadata = {
      kind: 'python',
      adapter: 'canmv-k230',
      entry: 'main.py',
      execution: {
        transport: 'canmv-usbdbg',
        output: 'event-stream',
        input: 'repl',
        stop: 'device-interrupt',
        files: 'canmv-io',
        temporaryRun: true,
      },
      deployment: {
        autostart: {
          kind: 'boot-start-sh',
          directory: '/boot/start',
          backgroundRequired: true,
        },
      },
    };

    expect(() => adapter.validateMetadata(metadata)).not.toThrow();
    expect(() => adapter.validateMetadata({
      ...metadata,
      execution: { ...metadata.execution, transport: 'ssh' },
    })).toThrowError(/incompatible execution profile/i);
    expect(() => adapter.validateMetadata({
      ...metadata,
      deployment: {
        autostart: { kind: 'systemd', unitDirectory: '/etc/systemd/system' },
      },
    })).toThrowError(/incompatible deployment profile/i);
  });
});
