import { Component, OnInit, OnDestroy } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { ProjectService } from '../../services/project.service';
import { NotificationComponent } from '../../components/notification/notification.component';
import { BuilderService } from '../code-editor/services/builder.service';
import { UploaderService } from '../../services/uploader.service';
import { ElectronService } from '../../services/electron.service';
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

  private readonly coderDevEmbedBase = 'http://127.0.0.1:5174/';

  constructor(
    private projectService: ProjectService,
    private proProject: CodeEditorProProjectService,
    private activatedRoute: ActivatedRoute,
    private message: NzMessageService,
    private builderService: BuilderService,
    private uploadService: UploaderService,
    private electronService: ElectronService,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnInit() {
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
    await this.loadProject(projectPath);
    await this.initCoderEmbed(projectPath);
  }

  ngOnDestroy(): void {
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
}
