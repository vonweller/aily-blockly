import { Component, EventEmitter, Input, Output } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNzIconsTesting } from 'ng-zorro-antd/icon/testing';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import type { PythonRuntimeClient } from '../../../../services/python-runtime/python-runtime-client';
import type { RemoteDirectoryNode } from '../../../../services/python-runtime/remote-file-tree';
import { PythonRuntimeRegistry } from '../../../../services/python-runtime/python-runtime-registry';
import { PythonRuntimePanelComponent } from './python-runtime-panel.component';
import { PythonTerminalComponent } from './python-terminal/python-terminal.component';
import { RemoteFileTreeComponent } from './remote-file-tree/remote-file-tree.component';

@Component({
  selector: 'app-python-terminal',
  standalone: true,
  template: '',
})
class StubPythonTerminalComponent {
  @Input({ required: true }) runtime!: PythonRuntimeClient;
  @Input() inputEnabled = false;
  @Input() resizeEnabled = false;
  @Input() resizeDisabledReason = '';
}

@Component({
  selector: 'app-remote-file-tree',
  standalone: true,
  template: '',
})
class StubRemoteFileTreeComponent {
  @Input() enabled = false;
  @Input() disabledReason = '';
  @Input({ required: true }) runtime!: PythonRuntimeClient;
  @Output() fileOpen = new EventEmitter<RemoteDirectoryNode>();
}

describe('PythonRuntimePanelComponent', () => {
  function createHarness(adapterId = 'canmv-k230') {
    const state = new BehaviorSubject<any>({
      runtimeAvailable: true,
      unavailableReason: null,
      backendState: 'ready',
      connectionState: 'disconnected',
      boards: [],
      adapterId: null,
      sessionId: null,
      endpoint: null,
      capabilities: null,
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
      installAutostart: jasmine.createSpy('installAutostart').and.resolveTo({ installed: true }),
      getAutostartStatus: jasmine.createSpy('getAutostartStatus').and.resolveTo({ installed: true }),
      removeAutostart: jasmine.createSpy('removeAutostart').and.resolveTo({ removed: true }),
      dispose: jasmine.createSpy('dispose'),
    };
    const adapter = { id: adapterId, runtime, available: true, dispose: () => runtime.dispose() };
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

  async function renderPanel(
    adapterId: 'canmv-k230' | 'linux-ssh' | 'linux-serial-shell',
    stateOverride: Record<string, unknown> = {},
  ) {
    const harness = createHarness(adapterId);
    harness.state.next({
      ...harness.state.value,
      ...stateOverride,
    });
    await TestBed.configureTestingModule({
      imports: [PythonRuntimePanelComponent],
      providers: [
        { provide: PythonRuntimeRegistry, useValue: harness.registry },
        provideHttpClient(),
        provideNoopAnimations(),
        provideNzIconsTesting(),
      ],
    })
      .overrideComponent(PythonRuntimePanelComponent, {
        remove: {
          imports: [PythonTerminalComponent, RemoteFileTreeComponent],
        },
        add: {
          imports: [StubPythonTerminalComponent, StubRemoteFileTreeComponent],
        },
      })
      .compileComponents();
    const fixture = TestBed.createComponent(PythonRuntimePanelComponent);
    const component = fixture.componentInstance;
    component.runtimeMetadata = {
      kind: 'python',
      adapter: adapterId,
      entry: 'main.py',
    };
    component.runtime = harness.runtime;
    component.state$ = harness.state.asObservable() as Observable<any>;
    fixture.detectChanges();
    return { ...harness, fixture, component };
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

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

  it('renders SSH connection fields without serial or CanMV controls', async () => {
    const { fixture } = await renderPanel('linux-ssh');
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector('[data-testid="ssh-host"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="ssh-port"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="ssh-username"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="ssh-password"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="ssh-private-key-path"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="serial-port"]')).toBeNull();
    expect(root.querySelector('[data-testid="canmv-device"]')).toBeNull();
  });

  it('renders serial-shell port and baud controls with the SERIAL-A hint', async () => {
    const { fixture } = await renderPanel('linux-serial-shell');
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector('[data-testid="serial-port"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="serial-baud"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="serial-a-hint"]')?.textContent).toContain('SERIAL-A');
    expect(root.querySelector('[data-testid="ssh-host"]')).toBeNull();
    expect(root.querySelector('[data-testid="canmv-device"]')).toBeNull();
  });

  it('keeps the CanMV device dropdown and automatic rescan behavior', async () => {
    const { fixture } = await renderPanel('canmv-k230');
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector('[data-testid="canmv-device"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="ssh-host"]')).toBeNull();
    expect(root.querySelector('[data-testid="serial-port"]')).toBeNull();
  });

  it('does not scan the LAN for SSH and enumerates serial ports only once', fakeAsync(() => {
    const ssh = createHarness('linux-ssh');
    ssh.component.runtimeMetadata = {
      kind: 'python',
      adapter: 'linux-ssh',
      entry: 'main.py',
    };
    void ssh.component.activate();
    flushMicrotasks();
    tick(4_000);
    flushMicrotasks();
    expect(ssh.runtime.detectBoards).not.toHaveBeenCalled();
    ssh.component.ngOnDestroy();

    const serial = createHarness('linux-serial-shell');
    serial.runtime.detectBoards.and.resolveTo([
      { port: 'COM7', name: 'WalnutPi SERIAL-A', vid: '1a86', pid: '7523' },
    ]);
    serial.component.runtimeMetadata = {
      kind: 'python',
      adapter: 'linux-serial-shell',
      entry: 'main.py',
    };
    void serial.component.activate();
    flushMicrotasks();
    tick(4_000);
    flushMicrotasks();
    expect(serial.runtime.detectBoards).toHaveBeenCalledTimes(1);
    expect(serial.runtime.connect).not.toHaveBeenCalled();
    serial.component.ngOnDestroy();
  }));

  it('clears SSH password and passphrase after connect returns while retaining non-secret fields', async () => {
    const { component, runtime } = createHarness('linux-ssh');
    component.runtimeMetadata = {
      kind: 'python',
      adapter: 'linux-ssh',
      entry: 'main.py',
    };
    await component.activate();
    component.sshHost = 'pi.local';
    component.sshPort = 2222;
    component.sshUsername = 'pi';
    component.sshPassword = 'password-secret';
    component.sshPrivateKeyPath = 'C:\\Users\\dev\\.ssh\\id_ed25519';
    component.sshPrivateKeyPassphrase = 'key-secret';

    await component.connect();

    expect(runtime.connect).toHaveBeenCalledOnceWith(
      {
        kind: 'ssh',
        host: 'pi.local',
        port: 2222,
        username: 'pi',
        privateKeyPath: 'C:\\Users\\dev\\.ssh\\id_ed25519',
      },
      {
        password: 'password-secret',
        passphrase: 'key-secret',
      },
    );
    expect(component.sshPassword).toBe('');
    expect(component.sshPrivateKeyPassphrase).toBe('');
    expect(component.sshHost).toBe('pi.local');
    expect(component.sshPrivateKeyPath).toBe('C:\\Users\\dev\\.ssh\\id_ed25519');
  });

  it('gates files, autostart, preview, and resize while keeping PTY input active', async () => {
    const { fixture } = await renderPanel('linux-ssh', {
      connectionState: 'connected',
      running: true,
      adapterId: 'linux-ssh',
      sessionId: 'session-1',
      capabilities: {
        platform: 'linux',
        hostname: 'pi',
        architecture: 'aarch64',
        pythonVersion: '3.11',
        homeDirectory: '/home/pi',
        writableWorkspace: '/tmp/aily-runtime',
        pty: true,
        terminalResize: false,
        processGroups: true,
        files: 'none',
        autostart: 'none',
        preview: { available: false, transports: [] },
        unavailableReasons: {
          files: 'SFTP and the file helper are unavailable.',
          autostart: 'No supported autostart manager was detected.',
          preview: 'No camera backend was detected.',
          terminalResize: 'The remote PTY cannot be resized.',
        },
      },
    });
    const root: HTMLElement = fixture.nativeElement;
    const fileBrowser = fixture.debugElement.query(By.directive(StubRemoteFileTreeComponent))
      .componentInstance as StubRemoteFileTreeComponent;
    const terminal = fixture.debugElement.query(By.directive(StubPythonTerminalComponent))
      .componentInstance as StubPythonTerminalComponent;
    const preview = root.querySelector('[data-testid="preview-action"]') as HTMLButtonElement;
    const install = root.querySelector('[data-testid="autostart-install"]') as HTMLButtonElement;
    const status = root.querySelector('[data-testid="autostart-status"]') as HTMLButtonElement;
    const remove = root.querySelector('[data-testid="autostart-remove"]') as HTMLButtonElement;

    expect(fileBrowser.enabled).toBeFalse();
    expect(fileBrowser.disabledReason).toContain('SFTP');
    expect(preview.disabled).toBeTrue();
    expect(preview.title).toContain('camera backend');
    expect(install.disabled).toBeTrue();
    expect(status.disabled).toBeTrue();
    expect(remove.disabled).toBeTrue();
    expect(install.title).toContain('autostart manager');
    expect(terminal.inputEnabled).toBeTrue();
    expect(terminal.resizeEnabled).toBeFalse();
    expect(terminal.resizeDisabledReason).toContain('cannot be resized');
  });
});
