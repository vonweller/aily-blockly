import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { BaseDialogComponent, DialogButton } from '../base-dialog/base-dialog.component';
import {
  BlocklyLibraryPackageRef,
  BlocklyLibraryPackageService,
  BlocklyLibrarySubmissionPackage,
} from '../../services/blockly-library-package.service';
import { ElectronService } from '../../services/electron.service';
import { ConfigService } from '../../services/config.service';

export interface LibraryPublishDialogResult {
  packageJsonPatch: Record<string, unknown>;
  localPackageJsonPatch: Record<string, unknown>;
  saveToLocalPackageJson: boolean;
}

export interface LibraryPublishSubmitResult {
  success: boolean;
  packageNameConflictMessage?: string;
  packageNameConflictValue?: string;
}

@Component({
  selector: 'app-library-publish-dialog',
  imports: [
    CommonModule,
    FormsModule,
    NzButtonModule,
    NzCheckboxModule,
    NzInputModule,
    BaseDialogComponent,
  ],
  templateUrl: './library-publish-dialog.component.html',
  styleUrl: './library-publish-dialog.component.scss',
})
export class LibraryPublishDialogComponent {
  readonly modal = inject(NzModalRef);
  readonly data: {
    ref: BlocklyLibraryPackageRef;
    displayName?: string;
    initialPackageJsonPatch?: Record<string, unknown>;
    packageNameConflictMessage?: string;
    packageNameConflictValue?: string;
    submitPublish?: (result: LibraryPublishDialogResult) => Promise<LibraryPublishSubmitResult>;
  } = inject(NZ_MODAL_DATA);

  packageName = '';
  nickname = '';
  description = '';
  author = '';
  keywords = '';
  version = '';
  blockCount = 0;
  saveToLocalPackageJson = false;
  hardwareTestConfirmed = false;
  isSubmitting = false;
  currentPackageNameConflictMessage = '';
  currentPackageNameConflictValue = '';

  private readonly packageNamePattern = /^@aily-project\/lib-[a-zA-Z0-9._-]+$/;
  private readonly versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

  get packageNameConflictMessage(): string {
    const conflictValue = this.currentPackageNameConflictValue || '';
    if (!conflictValue || this.packageName.trim() !== conflictValue) {
      return '';
    }

    return this.currentPackageNameConflictMessage || '';
  }

  get isKnownPublicLibraryName(): boolean {
    const packageName = this.packageName.trim();
    return !!packageName && !!this.configService.libraryDict?.[packageName];
  }

  get buttons(): DialogButton[] {
    return [
      {
        text: '取消',
        type: 'default',
        action: 'cancel',
      },
      {
        text: '发布库',
        type: 'primary',
        action: 'publish',
      },
    ];
  }

  constructor(
    private message: NzMessageService,
    private blocklyLibraryPackageService: BlocklyLibraryPackageService,
    private electronService: ElectronService,
    private configService: ConfigService,
  ) {}

  ngOnInit(): void {
    try {
      const bundle = this.blocklyLibraryPackageService.readLibrarySubmissionPackageByRef(this.data.ref);
      this.applyPackage(bundle.package);
      this.applyInitialPatch();
      this.currentPackageNameConflictMessage = this.data.packageNameConflictMessage || '';
      this.currentPackageNameConflictValue = this.data.packageNameConflictValue || '';
    } catch (error) {
      this.message.error(`库信息读取失败: ${error instanceof Error ? error.message : error}`);
      this.modal.close({ result: 'cancel' });
    }
  }

  onCloseDialog(): void {
    this.modal.close({ result: 'cancel' });
  }

  onButtonClick(action: string): void {
    if (action === 'cancel') {
      this.onCloseDialog();
      return;
    }

    if (action === 'publish') {
      this.publish();
    }
  }

  openLibraryRepo(event: MouseEvent): void {
    event.preventDefault();
    this.electronService.openUrl('https://github.com/ailyProject/aily-blockly-libraries');
  }

  private applyPackage(pkg: BlocklyLibrarySubmissionPackage): void {
    const packageJson = pkg.packageJson || {};
    this.packageName = packageJson.name || this.data.ref.name || '';
    this.nickname = packageJson.nickname || this.data.displayName || this.packageName;
    this.description = packageJson.description || '';
    this.author = this.normalizeAuthor(packageJson.author);
    this.version = packageJson.version || '';
    this.keywords = Array.isArray(packageJson.keywords) ? packageJson.keywords.join(', ') : '';
    this.blockCount = Array.isArray(pkg.blockJson) ? pkg.blockJson.length : 0;
  }

  private applyInitialPatch(): void {
    const patch = this.data.initialPackageJsonPatch;
    if (!patch || typeof patch !== 'object') {
      return;
    }

    if (typeof patch['name'] === 'string') {
      this.packageName = patch['name'];
    }
    if (typeof patch['version'] === 'string') {
      this.version = patch['version'];
    }
    if (typeof patch['nickname'] === 'string') {
      this.nickname = patch['nickname'];
    }
    if (typeof patch['description'] === 'string') {
      this.description = patch['description'];
    }
    if (typeof patch['author'] === 'string') {
      this.author = patch['author'];
    }
    if (Array.isArray(patch['keywords'])) {
      this.keywords = patch['keywords']
        .filter((keyword): keyword is string => typeof keyword === 'string')
        .join(', ');
    }
  }

  private normalizeAuthor(author: unknown): string {
    if (typeof author === 'string') {
      return author;
    }
    if (author && typeof author === 'object' && !Array.isArray(author)) {
      const authorName = (author as { name?: unknown }).name;
      return typeof authorName === 'string' ? authorName : '';
    }
    return '';
  }

  private async publish(): Promise<void> {
    if (this.isSubmitting) {
      return;
    }

    const packageName = this.packageName.trim();
    if (!this.packageNamePattern.test(packageName)) {
      this.message.warning('库名必须以 @aily-project/lib- 开头，且只能包含字母、数字、点、下划线和短横线');
      return;
    }

    if (!this.nickname.trim()) {
      this.message.warning('请填写库显示名称');
      return;
    }

    if (!this.versionPattern.test(this.version.trim())) {
      this.message.warning('版本号格式应为 1.0.0 或 1.0.0-beta.1');
      return;
    }

    if (!this.hardwareTestConfirmed) {
      this.message.warning('请确认该库已在真实硬件上测试通过');
      return;
    }

    const result: LibraryPublishDialogResult = {
      packageJsonPatch: {
        name: packageName,
        version: this.version.trim(),
        nickname: this.nickname.trim(),
        description: this.description.trim(),
        author: this.author.trim(),
        keywords: this.parseKeywords(),
      },
      localPackageJsonPatch: {
        version: this.version.trim(),
        nickname: this.nickname.trim(),
        description: this.description.trim(),
        author: this.author.trim(),
        keywords: this.parseKeywords(),
      },
      saveToLocalPackageJson: this.saveToLocalPackageJson,
    };

    if (!this.data.submitPublish) {
      this.modal.close({ result: 'publish', data: result });
      return;
    }

    this.isSubmitting = true;
    try {
      const submitResult = await this.data.submitPublish(result);
      if (submitResult.success) {
        this.modal.close({ result: 'success', data: result });
        return;
      }

      this.currentPackageNameConflictMessage = submitResult.packageNameConflictMessage || '';
      this.currentPackageNameConflictValue = submitResult.packageNameConflictValue || packageName;
    } catch (error) {
      this.message.error(error instanceof Error ? error.message : String(error), { nzDuration: 8000 });
    } finally {
      this.isSubmitting = false;
    }
  }

  private parseKeywords(): string[] {
    return this.keywords
      .split(',')
      .map(keyword => keyword.trim())
      .filter(keyword => keyword.length > 0);
  }
}
