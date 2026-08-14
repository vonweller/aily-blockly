import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
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
      get snapshot() { return state.value; },
      initialize: jasmine.createSpy('initialize').and.resolveTo(),
      detectBoards: jasmine.createSpy('detectBoards').and.resolveTo([]),
      connect: jasmine.createSpy('connect').and.resolveTo({}),
      disconnect: jasmine.createSpy('disconnect').and.resolveTo(),
      runScript: jasmine.createSpy('runScript').and.resolveTo(),
      stopScript: jasmine.createSpy('stopScript').and.resolveTo(),
      startPreview: jasmine.createSpy('startPreview').and.resolveTo('preview'),
      stopPreview: jasmine.createSpy('stopPreview').and.resolveTo(),
      readRemoteTextFile: jasmine.createSpy('readRemoteTextFile').and.resolveTo('print("old")'),
      writeRemoteTextFile: jasmine.createSpy('writeRemoteTextFile').and.resolveTo(),
      dispose: jasmine.createSpy('dispose'),
    };
    const adapter = { id: 'canmv-k230', runtime, available: true, dispose: () => runtime.dispose() };
    const registry = { resolve: jasmine.createSpy('resolve').and.returnValue(adapter) };
    const component = new PythonRuntimePanelComponent(registry as any);
    return { component, runtime, state, registry };
  }

  const metadata = { kind: 'python' as const, adapter: 'canmv-k230', entry: 'main.py' };

  function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }

  it('stays hidden without Python metadata and initializes the selected adapter', async () => {
    const { component, runtime } = createHarness();
    expect(component.visible).toBeFalse();

    component.runtimeMetadata = metadata;
    await component.activate();

    expect(component.visible).toBeTrue();
    expect(runtime.initialize).toHaveBeenCalledOnceWith();
  });

  it('detects connected devices on activation and preselects the first board', async () => {
    const { component, runtime } = createHarness();
    runtime.detectBoards.and.resolveTo([
      {
        port: 'COM9',
        name: 'CyberCAM K230',
        vid: '1209',
        pid: 'abd1',
      },
    ]);
    component.runtimeMetadata = metadata;

    await component.activate();

    expect(runtime.detectBoards).toHaveBeenCalledOnceWith();
    expect(component.selectedPort).toBe('COM9');
  });

  it('automatically rescans after an empty activation scan and selects a newly inserted board', fakeAsync(() => {
    const { component, runtime } = createHarness();
    runtime.detectBoards.and.returnValues(
      Promise.resolve([]),
      Promise.resolve([
        {
          port: 'COM9',
          name: 'CyberCAM K230',
          vid: '1209',
          pid: 'abd1',
        },
      ]),
    );
    component.runtimeMetadata = metadata;

    void component.activate();
    flushMicrotasks();
    expect(runtime.detectBoards).toHaveBeenCalledTimes(1);
    expect(component.selectedPort).toBe('');

    tick(2_000);
    flushMicrotasks();

    expect(runtime.detectBoards).toHaveBeenCalledTimes(2);
    expect(component.selectedPort).toBe('COM9');
    component.ngOnDestroy();
  }));

  it('keeps scanning while other boards exist and selects a newly inserted board', fakeAsync(() => {
    const { component, runtime } = createHarness();
    runtime.detectBoards.and.returnValues(
      Promise.resolve([
        { port: 'COM3', name: 'Other Python board', vid: '1111', pid: '2222' },
      ]),
      Promise.resolve([
        { port: 'COM3', name: 'Other Python board', vid: '1111', pid: '2222' },
        { port: 'COM9', name: 'CyberCAM K230', vid: '1209', pid: 'abd1' },
      ]),
    );
    component.runtimeMetadata = metadata;

    void component.activate();
    flushMicrotasks();
    expect(component.selectedPort).toBe('COM3');

    tick(2_000);
    flushMicrotasks();

    expect(runtime.detectBoards).toHaveBeenCalledTimes(2);
    expect(component.selectedPort).toBe('COM9');
    component.ngOnDestroy();
  }));

  it('continues automatic scanning after a transient detection error', fakeAsync(() => {
    const { component, runtime } = createHarness();
    runtime.detectBoards.and.returnValues(
      Promise.reject(new Error('temporary USB scan failure')),
      Promise.resolve([
        { port: 'COM9', name: 'CyberCAM K230', vid: '1209', pid: 'abd1' },
      ]),
    );
    component.runtimeMetadata = metadata;

    void component.activate();
    flushMicrotasks();
    expect(component.error).toContain('temporary USB scan failure');

    tick(2_000);
    flushMicrotasks();

    expect(runtime.detectBoards).toHaveBeenCalledTimes(2);
    expect(component.selectedPort).toBe('COM9');
    component.ngOnDestroy();
  }));

  it('distinguishes an empty completed scan from a runtime that has not scanned yet', async () => {
    const { component, runtime, state } = createHarness();
    component.runtimeMetadata = metadata;

    expect(component.statusText(state.value)).toBe('Ready to connect');
    await component.activate();

    expect(runtime.detectBoards).toHaveBeenCalledOnceWith();
    expect(component.statusText(state.value)).toBe('No Python device found. Waiting for a board...');
  });

  it('disables run before connection and shows stop while running', async () => {
    const { component, runtime, state } = createHarness();
    component.runtimeMetadata = metadata;
    component.source = 'print("ok")\n';
    await component.activate();

    expect(component.canRun({ runtimeAvailable: true, connectionState: 'disconnected', running: false } as any)).toBeFalse();
    expect(component.canRun({ runtimeAvailable: true, connectionState: 'connected', running: false } as any)).toBeTrue();
    expect(component.showStop({ running: true } as any)).toBeTrue();
    expect(component.statusText({
      runtimeAvailable: true,
      connectionState: 'connected',
      running: true,
    } as any)).toBe('Connected · running');

    state.next({ ...state.value, connectionState: 'connected', port: 'COM9' });
    await component.run();
    expect(runtime.runScript).toHaveBeenCalledOnceWith('print("ok")\n');
  });

  it('defensively blocks run, stop, and preview RPCs without a connected device', async () => {
    const { component, runtime, state } = createHarness();
    component.runtimeMetadata = metadata;
    component.source = 'print("stale")';
    await component.activate();

    await component.run();
    await component.stop();
    await component.togglePreview({
      ...state.value,
      connectionState: 'connected',
      previewing: false,
    });

    expect(runtime.runScript).not.toHaveBeenCalled();
    expect(runtime.stopScript).not.toHaveBeenCalled();
    expect(runtime.startPreview).not.toHaveBeenCalled();
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
    component.runtimeMetadata = metadata;
    await component.activate();
    Object.defineProperty(runtime, 'snapshot', {
      configurable: true,
      get: () => ({ connectionState: 'connected' }),
    });

    component.ngOnDestroy();
    await Promise.resolve();

    expect(runtime.disconnect).toHaveBeenCalledOnceWith();
    expect(runtime.dispose).toHaveBeenCalledOnceWith();
  });

  it('serializes disconnect and reinitialize when the registry returns the same runtime singleton', async () => {
    const { component, runtime, state, registry } = createHarness();
    const disconnect = deferred();
    runtime.disconnect.and.returnValue(disconnect.promise);
    component.runtimeMetadata = metadata;
    await component.activate();
    state.next({ ...state.value, connectionState: 'connected', port: 'COM9' });

    const reactivation = component.activate();
    await Promise.resolve();

    expect(registry.resolve).toHaveBeenCalledTimes(2);
    expect(runtime.disconnect).toHaveBeenCalledOnceWith();
    expect(runtime.initialize).toHaveBeenCalledTimes(1);

    disconnect.resolve();
    await reactivation;

    expect(runtime.dispose).toHaveBeenCalledTimes(1);
    expect(runtime.initialize).toHaveBeenCalledTimes(2);
    component.ngOnDestroy();
  });

  it('clears remote editor state and resumes scanning after physical board loss', fakeAsync(() => {
    const { component, runtime, state } = createHarness();
    component.runtimeMetadata = metadata;
    void component.activate();
    flushMicrotasks();
    state.next({ ...state.value, connectionState: 'connected', port: 'COM9' });
    component.openedFilePath = '/main.py';
    component.openedFileText = 'print("old device")';

    state.next({
      ...state.value,
      connectionState: 'disconnected',
      boards: [],
      port: null,
      boardInfo: null,
    });
    tick(2_000);
    flushMicrotasks();

    expect(component.openedFilePath).toBe('');
    expect(component.openedFileText).toBe('');
    expect(runtime.detectBoards).toHaveBeenCalledTimes(2);
    component.ngOnDestroy();
  }));

  it('does not save a stale remote file after the runtime disconnects', async () => {
    const { component, runtime, state } = createHarness();
    component.runtimeMetadata = metadata;
    await component.activate();
    component.openedFilePath = '/main.py';
    component.openedFileText = 'print("old device")';
    state.next({ ...state.value, connectionState: 'disconnected' });

    await component.saveRemoteFile();

    expect(runtime.writeRemoteTextFile).not.toHaveBeenCalled();
  });

  it('creates preview blobs from only the Uint8Array view bytes', async () => {
    const { component, runtime, state } = createHarness();
    let capturedBlob: Blob | null = null;
    spyOn(URL, 'createObjectURL').and.callFake(blob => {
      capturedBlob = blob as Blob;
      return 'blob:preview';
    });
    spyOn(URL, 'revokeObjectURL');
    component.runtimeMetadata = metadata;
    await component.activate();
    state.next({
      ...state.value,
      connectionState: 'connected',
      port: 'COM9',
      previewing: true,
    });
    const source = new Uint8Array([99, 1, 2, 3, 88]);

    runtime.frame$.next({ frameId: 1, data: new Uint8Array(source.buffer, 1, 3) });

    expect(capturedBlob).not.toBeNull();
    expect(Array.from(new Uint8Array(await capturedBlob!.arrayBuffer()))).toEqual([1, 2, 3]);
    component.ngOnDestroy();
  });

  it('ignores a preview frame that arrives after the device disconnects', async () => {
    const { component, runtime, state } = createHarness();
    spyOn(URL, 'createObjectURL').and.returnValue('blob:stale-preview');
    spyOn(URL, 'revokeObjectURL');
    component.runtimeMetadata = metadata;
    await component.activate();
    state.next({
      ...state.value,
      connectionState: 'connected',
      port: 'COM9',
      previewing: true,
    });

    state.next({
      ...state.value,
      connectionState: 'disconnected',
      port: null,
      previewing: false,
    });
    runtime.frame$.next({ frameId: 2, data: new Uint8Array([1, 2, 3]) });

    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(component.frameUrl).toBe('');
    component.ngOnDestroy();
  });

  it('ignores remote file contents that arrive after the device disconnects', async () => {
    const { component, runtime, state } = createHarness();
    const remoteFile = deferred<string>();
    runtime.readRemoteTextFile.and.returnValue(remoteFile.promise);
    component.runtimeMetadata = metadata;
    await component.activate();
    state.next({
      ...state.value,
      connectionState: 'connected',
      port: 'COM9',
    });

    const opening = component.openRemoteFile({
      name: 'main.py',
      path: '/main.py',
      type: 'file',
      size: 0,
    });
    state.next({
      ...state.value,
      connectionState: 'disconnected',
      port: null,
    });
    remoteFile.resolve('print("stale")');
    await opening;

    expect(component.openedFilePath).toBe('');
    expect(component.openedFileText).toBe('');
    component.ngOnDestroy();
  });

  it('does not let an old panel dispose a singleton runtime claimed by a new panel', async () => {
    const { runtime, state, registry } = createHarness();
    const oldPanel = new PythonRuntimePanelComponent(registry as any);
    const newPanel = new PythonRuntimePanelComponent(registry as any);
    oldPanel.runtimeMetadata = metadata;
    newPanel.runtimeMetadata = metadata;
    await oldPanel.activate();
    await newPanel.activate();
    state.next({
      ...state.value,
      connectionState: 'connected',
      port: 'COM9',
    });

    oldPanel.ngOnDestroy();
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.disconnect).not.toHaveBeenCalled();
    expect(runtime.dispose).not.toHaveBeenCalled();

    newPanel.ngOnDestroy();
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.disconnect).toHaveBeenCalledOnceWith();
    expect(runtime.dispose).toHaveBeenCalledOnceWith();
  });

  it('ignores a stale activation after switching to a new runtime', async () => {
    const first = createHarness();
    const second = createHarness();
    const firstInitialize = deferred();
    first.runtime.initialize.and.returnValue(firstInitialize.promise);
    second.runtime.detectBoards.and.resolveTo([
      { port: 'COM10', name: 'New Python board' },
    ]);
    const registry = {
      resolve: jasmine.createSpy('resolve').and.returnValues(
        { runtime: first.runtime },
        { runtime: second.runtime },
      ),
    };
    const component = new PythonRuntimePanelComponent(registry as any);

    component.runtimeMetadata = metadata;
    const staleActivation = component.activate();
    await Promise.resolve();

    component.runtimeMetadata = { ...metadata };
    await component.activate();
    firstInitialize.reject(new Error('stale initialize failure'));
    await staleActivation;

    expect(first.runtime.detectBoards).not.toHaveBeenCalled();
    expect(component.runtime).toBe(second.runtime);
    expect(component.selectedPort).toBe('COM10');
    expect(component.error).toBe('');
    expect(component.busy).toBeFalse();
  });

  it('clears stale busy state when a replacement runtime cannot be resolved', async () => {
    const first = createHarness();
    const firstInitialize = deferred();
    first.runtime.initialize.and.returnValue(firstInitialize.promise);
    const registry = {
      resolve: jasmine.createSpy('resolve').and.callFake(() => {
        if (registry.resolve.calls.count() === 1) {
          return { runtime: first.runtime };
        }
        throw new Error('Unsupported Python runtime adapter: missing');
      }),
    };
    const component = new PythonRuntimePanelComponent(registry as any);

    component.runtimeMetadata = metadata;
    const staleActivation = component.activate();
    await Promise.resolve();
    expect(component.busy).toBeTrue();

    component.runtimeMetadata = {
      kind: 'python',
      adapter: 'missing',
      entry: 'main.py',
    };
    await component.activate();

    expect(component.busy).toBeFalse();
    expect(component.error).toContain('Unsupported Python runtime adapter: missing');

    firstInitialize.reject(new Error('stale initialize failure'));
    await staleActivation;
    expect(component.error).toContain('Unsupported Python runtime adapter: missing');
  });
});
