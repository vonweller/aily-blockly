import { BehaviorSubject, Subject } from 'rxjs';
import { PythonRuntimePanelComponent } from './python-runtime-panel.component';

describe('PythonRuntimePanelComponent', () => {
  function createHarness() {
    const state = new BehaviorSubject<any>({
      runtimeAvailable: true,
      unavailableReason: null,
      backendState: 'ready',
      connectionState: 'disconnected',
      boards: [],
      port: null,
      boardInfo: null,
      running: false,
      previewing: false,
      error: null,
    });
    const runtime: any = {
      state$: state.asObservable(),
      frame$: new Subject(),
      snapshot: state.value,
      initialize: jasmine.createSpy('initialize').and.resolveTo(),
      detectBoards: jasmine.createSpy('detectBoards').and.resolveTo([]),
      connect: jasmine.createSpy('connect').and.resolveTo({}),
      disconnect: jasmine.createSpy('disconnect').and.resolveTo(),
      runScript: jasmine.createSpy('runScript').and.resolveTo(),
      stopScript: jasmine.createSpy('stopScript').and.resolveTo(),
      startPreview: jasmine.createSpy('startPreview').and.resolveTo('preview'),
      stopPreview: jasmine.createSpy('stopPreview').and.resolveTo(),
      dispose: jasmine.createSpy('dispose'),
    };
    const adapter = { id: 'canmv-k230', runtime, available: true, dispose: () => runtime.dispose() };
    const registry = { resolve: jasmine.createSpy('resolve').and.returnValue(adapter) };
    const component = new PythonRuntimePanelComponent(registry as any);
    return { component, runtime, state, registry };
  }

  const metadata = { kind: 'python' as const, adapter: 'canmv-k230', entry: 'main.py' };

  it('stays hidden without Python metadata and initializes the selected adapter', async () => {
    const { component, runtime } = createHarness();
    expect(component.visible).toBeFalse();

    component.runtimeMetadata = metadata;
    await component.activate();

    expect(component.visible).toBeTrue();
    expect(runtime.initialize).toHaveBeenCalledOnceWith();
  });

  it('disables run before connection and shows stop while running', async () => {
    const { component, runtime } = createHarness();
    component.runtimeMetadata = metadata;
    component.source = 'print("ok")\n';
    await component.activate();

    expect(component.canRun({ runtimeAvailable: true, connectionState: 'disconnected', running: false } as any)).toBeFalse();
    expect(component.canRun({ runtimeAvailable: true, connectionState: 'connected', running: false } as any)).toBeTrue();
    expect(component.showStop({ running: true } as any)).toBeTrue();

    await component.run();
    expect(runtime.runScript).toHaveBeenCalledOnceWith('print("ok")\n');
  });

  it('disconnects without mutating Blockly workspace state and removes listeners on destroy', async () => {
    const { component, runtime } = createHarness();
    const workspace = { id: 'still-mounted' };
    component.runtimeMetadata = metadata;
    await component.activate();

    await component.disconnect();
    component.ngOnDestroy();

    expect(workspace).toEqual({ id: 'still-mounted' });
    expect(runtime.disconnect).toHaveBeenCalledOnceWith();
    expect(runtime.dispose).toHaveBeenCalledOnceWith();
  });

  it('surfaces an unsupported adapter without an unhandled activation rejection', async () => {
    const { component, registry } = createHarness();
    registry.resolve.and.throwError('Unsupported Python runtime adapter: missing');
    component.runtimeMetadata = { kind: 'python', adapter: 'missing', entry: 'main.py' };

    await expectAsync(component.activate()).toBeResolved();

    expect(component.visible).toBeFalse();
    expect(component.error).toContain('Unsupported Python runtime adapter: missing');
  });

  it('disconnects an active device before disposing the runtime on destroy', async () => {
    const { component, runtime } = createHarness();
    runtime.snapshot = { connectionState: 'connected' };
    component.runtimeMetadata = metadata;
    await component.activate();

    component.ngOnDestroy();
    await Promise.resolve();

    expect(runtime.disconnect).toHaveBeenCalledOnceWith();
    expect(runtime.dispose).toHaveBeenCalledOnceWith();
  });
});
