import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';

import { ProjectService } from '../../services/project.service';
import { BlocklyService } from '../../editors/blockly-editor/services/blockly.service';
import { SimulatorEditorComponent } from './simulator-editor/simulator-editor.component';
import {
  SimulatorSubappFrameAdapter,
  type SimulatorSubappDebugLocationHint,
  type SimulatorSubappSurface,
  type SimulatorSubappFrameState,
} from './simulator-subapp-frame-adapter';
import { SimulatorProjectRebuildBridgeService } from '../../services/simulator-project-rebuild-bridge.service';

interface SimulatorSubappElectronApi {
  openProjectScene(options: {
    projectPath: string;
    ownerId: string;
    sceneId: string;
  }): Promise<SimulatorSubappSurface>;
  attachProjectSceneSession(ownerId?: string): Promise<unknown>;
  close(ownerId?: string): Promise<unknown>;
  onStateChanged?(callback: (event: {
    state: string;
    unexpected?: boolean;
    failure?: { message?: string };
  }) => void): () => void;
}

@Component({
  selector: 'app-simulator-subapp-host',
  imports: [CommonModule, SimulatorEditorComponent],
  templateUrl: './simulator-subapp-host.component.html',
  styleUrl: './simulator-subapp-host.component.scss',
})
export class SimulatorSubappHostComponent
implements AfterViewInit, OnDestroy {
  @ViewChild('subappFrame') private frame?: ElementRef<HTMLIFrameElement>;

  readonly useLegacySimulator =
    typeof (window as any).electronAPI?.simulatorSubapp?.openProjectScene
      !== 'function';

  state: SimulatorSubappFrameState = 'idle';
  errorMessage = '';
  runtimeSource = '';

  private readonly ownerId = createOwnerId();
  private adapter: SimulatorSubappFrameAdapter | null = null;
  private projectActivationSubscription: Subscription | null = null;
  private removeHostStateListener: (() => void) | null = null;
  private launchGeneration = 0;
  private destroyed = false;

  constructor(
    private readonly projectService: ProjectService,
    private readonly blocklyService: BlocklyService,
    private readonly ngZone: NgZone,
    rebuildBridge: SimulatorProjectRebuildBridgeService,
  ) {
    rebuildBridge.start();
    if (this.useLegacySimulator) return;
    this.projectActivationSubscription =
      this.projectService.projectActivation$.subscribe(() => {
        if (!this.destroyed) void this.restart();
      });
    this.removeHostStateListener =
      (window as any).electronAPI.simulatorSubapp?.onStateChanged((event: {
        state: string;
        unexpected?: boolean;
        failure?: { message?: string };
      }) => {
        if (
          !event.unexpected
          || (event.state !== 'failed' && event.state !== 'stopped')
          || this.destroyed
        ) {
          return;
        }
        this.ngZone.run(() => {
          this.errorMessage = event.failure?.message
            || '独立仿真服务意外退出，请重新启动。';
          this.state = 'failed';
        });
      }) ?? null;
  }

  ngAfterViewInit(): void {
    if (!this.useLegacySimulator) void this.launch();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.launchGeneration += 1;
    this.projectActivationSubscription?.unsubscribe();
    this.projectActivationSubscription = null;
    this.removeHostStateListener?.();
    this.removeHostStateListener = null;
    const adapter = this.adapter;
    this.adapter = null;
    this.blocklyService.clearDebugExecutionMarker();
    void adapter?.close();
  }

  retry(): void {
    void this.restart();
  }

  private async restart(): Promise<void> {
    const generation = ++this.launchGeneration;
    const previous = this.adapter;
    this.adapter = null;
    this.blocklyService.clearDebugExecutionMarker();
    await previous?.close();
    if (this.destroyed || generation !== this.launchGeneration) return;
    await this.launch(generation);
  }

  private async launch(generation = ++this.launchGeneration): Promise<void> {
    const frame = this.frame?.nativeElement;
    const api = (window as any).electronAPI?.simulatorSubapp as
      | SimulatorSubappElectronApi
      | undefined;
    if (!frame || !api || this.destroyed) return;

    this.errorMessage = '';
    this.runtimeSource = '';
    let projectPath: string;
    try {
      projectPath = this.projectService.currentProjectPath;
      if (!projectPath) {
        throw new Error('请先打开并编译一个项目，再启动仿真。');
      }
    } catch (error) {
      this.applyLaunchError(error, generation);
      return;
    }
    if (
      this.destroyed
      || generation !== this.launchGeneration
      || projectPath !== this.projectService.currentProjectPath
    ) {
      return;
    }

    const adapter = new SimulatorSubappFrameAdapter({
      window,
      frame,
      acquireSurface: async () => {
        const surface = await api.openProjectScene({
          projectPath,
          ownerId: this.ownerId,
          sceneId: 'main',
        });
        try {
          await api.attachProjectSceneSession(this.ownerId);
        } catch {
          // Wiring remains available when the fixed .build Artifact is absent
          // or stale. The independent Subapp exposes the detached state.
        }
        this.ngZone.run(() => {
          this.runtimeSource = surface.runtimePackId
            ? `${surface.runtimePackId} (${surface.runtimeMode || 'unknown'})`
            : surface.runtimeSource;
        });
        return surface;
      },
      releaseSurface: () => api.close(this.ownerId),
      onStateChange: (state, error) => {
        this.ngZone.run(() => {
          if (this.adapter !== adapter || this.destroyed) return;
          this.state = state;
          if (error) this.errorMessage = publicErrorMessage(error);
        });
      },
      onDebugLocationHint: (hint) => {
        this.applyDebugLocationHint(adapter, projectPath, hint);
      },
    });
    this.adapter = adapter;
    try {
      await adapter.start();
    } catch (error) {
      this.applyLaunchError(error, generation);
    }
  }

  private applyDebugLocationHint(
    adapter: SimulatorSubappFrameAdapter,
    projectPath: string,
    hint: SimulatorSubappDebugLocationHint,
  ): void {
    this.ngZone.run(() => {
      if (
        this.adapter !== adapter
        || this.destroyed
        || this.projectService.currentProjectPath !== projectPath
      ) {
        return;
      }
      if (hint.status === 'available' && hint.primaryBlockId) {
        this.blocklyService.setDebugExecutionMarker(
          projectPath,
          hint.primaryBlockId,
        );
      } else {
        this.blocklyService.clearDebugExecutionMarker(projectPath);
      }
    });
  }

  private applyLaunchError(error: unknown, generation: number): void {
    if (this.destroyed || generation !== this.launchGeneration) return;
    this.ngZone.run(() => {
      this.blocklyService.clearDebugExecutionMarker();
      this.state = 'failed';
      this.errorMessage = publicErrorMessage(error);
    });
  }
}

function createOwnerId(): string {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `simulator-subapp-host:${random}`;
}

function publicErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/explicit HTTP\(S\) renderer origin|opaque file origins/i.test(message)) {
    return '当前打包版仍使用 file:// 页面，无法建立安全 iframe origin；请先在开发环境运行，打包版将在本地 HTTP 渲染入口完成后启用。';
  }
  return message || '独立仿真服务启动失败。';
}
