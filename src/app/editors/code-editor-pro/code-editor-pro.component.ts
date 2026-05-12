import { Component, OnInit, OnDestroy } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { ProjectService } from '../../services/project.service';
import { NotificationComponent } from '../../components/notification/notification.component';
import { BuilderService } from '../code-editor/services/builder.service';
import { UploaderService } from '../../services/uploader.service';
import { ElectronService } from '../../services/electron.service';
import { ThemeService } from '../../services/theme.service';
import { CodeEditorProProjectService } from './services/code-editor-pro-project.service';

@Component({
  selector: 'app-code-editor-pro',
  imports: [CommonModule, NotificationComponent],
  templateUrl: './code-editor-pro.component.html',
  styleUrl: './code-editor-pro.component.scss',
})
export class CodeEditorProComponent implements OnInit, OnDestroy {
  coderEmbedSrc: SafeResourceUrl | null = null;
  coderEmbedError: string | null = null;
  /** 内嵌 iframe 打开的本地工程根路径（Electron postMessage FS 断言用） */
  private coderEmbedWorkspaceRoot: string | null = null;

  private readonly coderDevEmbedBase = 'http://127.0.0.1:5174/';

  private readonly coderNativeFsBridgeListener = (ev: MessageEvent) => this.onCoderNativeFsMessage(ev);

  constructor(
    private projectService: ProjectService,
    private proProject: CodeEditorProProjectService,
    private activatedRoute: ActivatedRoute,
    private message: NzMessageService,
    private builderService: BuilderService,
    private uploadService: UploaderService,
    private electronService: ElectronService,
    private sanitizer: DomSanitizer,
    private themeService: ThemeService,
  ) {
    toObservable(this.themeService.theme)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        const root = this.coderEmbedWorkspaceRoot;
        if (root) void this.initCoderEmbed(root);
      });
  }

  ngOnInit() {
    window.addEventListener('message', this.coderNativeFsBridgeListener);
    this.proProject.init();
    this.activatedRoute.queryParams.subscribe((params) => {
      if (params['path']) {
        try {
          void this.bootstrap(params['path']);
        } catch (error) {
          console.error('加载项目失败', error);
          this.message.error('加载项目失败，请检查项目文件是否完整');
        }
      } else {
        this.message.error('没有找到项目路径');
      }
    });
    window.history.replaceState(null, '', window.location.href);
    window.history.pushState(null, '', window.location.href);
  }

  private async bootstrap(projectPath: string) {
    this.coderEmbedWorkspaceRoot = projectPath;
    await this.loadProject(projectPath);
    await this.initCoderEmbed(projectPath);
  }

  ngOnDestroy(): void {
    window.removeEventListener('message', this.coderNativeFsBridgeListener);
    this.coderEmbedWorkspaceRoot = null;
    this.proProject.destroy();
    this.builderService.cancel();
    this.uploadService.cancel();
    this.electronService.setTitle('aily blockly');
  }

  async loadProject(projectPath: string) {
    if (!this.electronService.exists(projectPath + '/package.json')) {
      const fileList = this.electronService.readDir(projectPath);
      if (this.hasFileWithExtension(fileList, '.ino')) {
        const projectName = projectPath.split(/[/\\]/).filter(Boolean).pop() || '';
        const packageData = {
          version: '1.0.0',
          name: projectName,
          platform: 'arduino',
        };
        this.electronService.writeFile(projectPath + '/package.json', JSON.stringify(packageData));
      }
    }

    const packageJson = JSON.parse(this.electronService.readFile(`${projectPath}/package.json`));
    this.electronService.setTitle(`aily blockly - ${packageJson.name}`);
    this.projectService.currentPackageData = packageJson;
    this.projectService.addRecentlyProject({
      name: packageJson.name,
      path: projectPath,
      nickname: packageJson.nickname || packageJson.name,
    });
    this.projectService.currentPackageData = packageJson;
    this.projectService.currentProjectPath = projectPath;
    this.projectService.stateSubject.next('loaded');
  }

  private async initCoderEmbed(projectPath: string) {
    try {
      let base: string;
      const api = (window as any).electronAPI;
      if (this.electronService.isElectron && api?.coderEmbed) {
        base = await api.coderEmbed.getBaseUrl();
      } else {
        base = this.coderDevEmbedBase;
      }
      const u = new URL(base.endsWith('/') ? base : `${base}/`);
      u.searchParams.set('mode', 'full-workbench');
      u.searchParams.set('folder', projectPath);
      u.searchParams.set('theme', this.themeService.theme());
      if (this.electronService.isElectron) {
        u.searchParams.set('nativeFsBridge', 'true');
      }
      this.coderEmbedSrc = this.sanitizer.bypassSecurityTrustResourceUrl(u.toString());
      this.coderEmbedError = null;
    } catch (e: any) {
      console.error(e);
      this.coderEmbedError = e?.message || String(e);
      this.message.error('无法启动内嵌代码编辑器：' + this.coderEmbedError);
    }
  }

  private hasFileWithExtension(
    fileList: Array<{ name: string; parentPath: string; path: string }>,
    extension: string,
  ): boolean {
    return fileList.some((file) => file.name.toLowerCase().endsWith(extension.toLowerCase()));
  }

  private replyCoderNativeFs(
    src: Window | null | undefined,
    id: number,
    result?: unknown,
    error?: string,
  ) {
    try {
      src?.postMessage(
        {
          channel: 'aily-coder-native-fs-reply',
          id,
          ...(error ? { error } : {}),
          ...(result !== undefined ? { result } : {}),
        },
        '*',
      );
    } catch {
      /* ignore */
    }
  }

  /** 将Coder iframe 请求的绝对路径规范到当前工程目录内 */
  private assertPathInsideCoderEmbedRoot(candidatePath: string): string {
    const root = this.coderEmbedWorkspaceRoot;
    if (!root?.trim()) {
      throw new Error('未初始化工程路径');
    }
    const pathApi = window['path'] as { resolve?: (p: string) => string; normalize?: (p: string) => string; sep?: string };
    const resolvedRoot = pathApi.resolve ? pathApi.resolve(root) : root;
    const resolvedCandidate = pathApi.normalize ? pathApi.normalize(candidatePath) : candidatePath;
    const full = pathApi.resolve ? pathApi.resolve(resolvedCandidate) : resolvedCandidate;
    const sep = pathApi.sep ?? '/';
    const ok =
      full === resolvedRoot ||
      full.startsWith(resolvedRoot + sep) ||
      full.toLowerCase().startsWith((resolvedRoot + sep).toLowerCase());
    if (!ok) {
      throw new Error('路径不在当前工程目录内');
    }
    return full;
  }

  private onCoderNativeFsMessage(ev: MessageEvent): void {
    const msg = ev.data as {
      channel?: string;
      id?: number;
      op?: string;
      payload?: Record<string, unknown>;
    };
    if (msg?.channel !== 'aily-coder-native-fs' || typeof msg.id !== 'number' || !msg.op) {
      return;
    }
    const replyErr = (e: unknown) =>
      this.replyCoderNativeFs(
        ev.source as Window | undefined | null,
        msg.id as number,
        undefined,
        e instanceof Error ? e.message : String(e),
      );

    try {
      const payload = msg.payload ?? {};
      const fsAny = window['fs'] as any;
      if (!window['path']?.['resolve'] || !fsAny?.['existsSync']) {
        replyErr(new Error('文件系统不可用（非 Electron 环境？）'));
        return;
      }
      switch (msg.op) {
        case 'nativeFsStat': {
          const abs = this.assertPathInsideCoderEmbedRoot(String(payload['path']));
          if (!fsAny['existsSync'](abs)) {
            this.replyCoderNativeFs(ev.source as Window, msg.id!, {
              exists: false,
              size: 0,
              mtimeMs: 0,
            });
            return;
          }
          const st = fsAny['statSync'](abs) as {
            size: number;
            mtime: string;
            _isDirectory?: boolean;
            _isFile?: boolean;
          };
          this.replyCoderNativeFs(ev.source as Window, msg.id!, {
            exists: true,
            _isDirectory: st._isDirectory,
            _isFile: st._isFile,
            size: st.size,
            mtimeMs: Date.parse(st.mtime),
          });
          break;
        }
        case 'nativeFsReaddir': {
          const abs = this.assertPathInsideCoderEmbedRoot(String(payload['path']));
          const list = fsAny['readDirSync'](abs) as Array<{
            name: string;
            _isDirectory: boolean;
            _isFile: boolean;
          }>;
          this.replyCoderNativeFs(ev.source as Window, msg.id!, list);
          break;
        }
        case 'nativeFsReadBinary': {
          const abs = this.assertPathInsideCoderEmbedRoot(String(payload['path']));
          const base64 = fsAny['readFileAsBase64'](abs) as string;
          this.replyCoderNativeFs(ev.source as Window, msg.id!, { base64 });
          break;
        }
        case 'nativeFsWriteBinary': {
          const abs = this.assertPathInsideCoderEmbedRoot(String(payload['path']));
          fsAny['writeBase64File'](abs, String(payload['base64'] ?? ''));
          this.replyCoderNativeFs(ev.source as Window, msg.id!, {});
          break;
        }
        case 'nativeFsMkdir': {
          const abs = this.assertPathInsideCoderEmbedRoot(String(payload['path']));
          fsAny['mkdirSync'](abs);
          this.replyCoderNativeFs(ev.source as Window, msg.id!, {});
          break;
        }
        case 'nativeFsDelete': {
          const abs = this.assertPathInsideCoderEmbedRoot(String(payload['path']));
          const recursive = !!payload['recursive'];
          if (fsAny['isDirectory'](abs)) {
            if (recursive) {
              fsAny['rmdirSync'](abs);
            } else {
              const entries = fsAny['readDirSync'](abs) as unknown[];
              if (entries?.length > 0) {
                replyErr(new Error('目录非空'));
                return;
              }
              fsAny['rmdirSync'](abs);
            }
          } else {
            fsAny['unlinkSync'](abs);
          }
          this.replyCoderNativeFs(ev.source as Window, msg.id!, {});
          break;
        }
        case 'nativeFsRename': {
          const from = this.assertPathInsideCoderEmbedRoot(String(payload['oldPath']));
          const to = this.assertPathInsideCoderEmbedRoot(String(payload['newPath']));
          const overwrite = !!payload['overwrite'];
          if (fsAny['existsSync'](to)) {
            if (!overwrite) {
              replyErr(new Error('目标已存在'));
              return;
            }
            const dir = fsAny['isDirectory'](to);
            if (typeof fsAny['rmSync'] === 'function') {
              fsAny['rmSync'](to, { recursive: true, force: true });
            } else if (dir) {
              fsAny['rmdirSync'](to);
            } else {
              fsAny['unlinkSync'](to);
            }
          }
          fsAny['renameSync'](from, to);
          this.replyCoderNativeFs(ev.source as Window, msg.id!, {});
          break;
        }
        default:
          replyErr(new Error(`未知 nativeFs op: ${msg.op}`));
      }
    } catch (e: unknown) {
      replyErr(e);
    }
  }
}
