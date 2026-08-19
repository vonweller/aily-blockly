import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ElectronService } from '../../services/electron.service';
import { ProjectService } from '../../services/project.service';
import { resolvePlatformPackagesForCurrentProject } from '../../utils/platform-packages.utils';
import {
  isSafeComponentLibraryDirectoryName,
  parseArduinoLibraryProperties,
  type ArduinoLibraryProperties,
} from './coder-component-library.utils';

interface CoderComponentLibraryEntry extends ArduinoLibraryProperties {
  readonly id: string;
  readonly folderName: string;
  readonly sourcePath: string;
  readonly sdkLabel: string;
  installed: boolean;
  installing: boolean;
}

@Component({
  selector: 'app-coder-component-library',
  imports: [
    CommonModule,
    FormsModule,
    NzButtonModule,
    NzInputModule,
    TranslateModule,
  ],
  templateUrl: './coder-component-library.component.html',
  styleUrl: './coder-component-library.component.scss',
})
export class CoderComponentLibraryComponent implements OnInit {
  keyword = '';
  loading = false;
  libraries: CoderComponentLibraryEntry[] = [];

  constructor(
    private readonly electronService: ElectronService,
    private readonly projectService: ProjectService,
    private readonly message: NzMessageService,
    private readonly translate: TranslateService,
  ) {}

  get filteredLibraries(): CoderComponentLibraryEntry[] {
    const query = this.keyword.trim().toLowerCase();
    if (!query) {
      return this.libraries;
    }
    return this.libraries.filter(library => [
      library.name,
      library.folderName,
      library.author,
      library.sentence,
      library.category,
      library.architectures.join(' '),
    ].some(value => value.toLowerCase().includes(query)));
  }

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading = true;
    try {
      const projectRoot = this.projectService.currentProjectPath;
      if (!projectRoot) {
        this.libraries = [];
        return;
      }
      const platformPackages = await resolvePlatformPackagesForCurrentProject(
        () => this.projectService.getEffectiveBoardDependencies(),
      );
      const componentsRoot = this.electronService.pathJoin(projectRoot, 'components');
      const found = new Map<string, CoderComponentLibraryEntry>();

      for (const sdk of platformPackages.filter(item => item.kind === 'sdk')) {
        const sdkLibrariesRoot = this.electronService.pathJoin(sdk.absolutePath, 'libraries');
        if (!this.electronService.exists(sdkLibrariesRoot)) {
          continue;
        }
        for (const folderName of this.listDirectoryNames(sdkLibrariesRoot)) {
          if (!isSafeComponentLibraryDirectoryName(folderName)) {
            continue;
          }
          const sourcePath = this.electronService.pathJoin(sdkLibrariesRoot, folderName);
          if (!this.electronService.isDirectory(sourcePath)) {
            continue;
          }
          const propertiesPath = this.electronService.pathJoin(sourcePath, 'library.properties');
          if (!this.electronService.exists(propertiesPath)) {
            continue;
          }
          const properties = parseArduinoLibraryProperties(
            this.electronService.readFile(propertiesPath),
          );
          const id = `${sdk.packageName}:${folderName}`;
          if (found.has(id)) {
            continue;
          }
          found.set(id, {
            ...properties,
            id,
            folderName,
            sourcePath,
            sdkLabel: sdk.label,
            installed: this.electronService.exists(
              this.electronService.pathJoin(componentsRoot, folderName),
            ),
            installing: false,
          });
        }
      }

      this.libraries = [...found.values()].sort((left, right) => (
        Number(right.installed) - Number(left.installed)
        || (left.name || left.folderName).localeCompare(right.name || right.folderName)
      ));
    } catch (error) {
      console.warn('[CoderComponentLibrary] failed to load platform libraries:', error);
      this.libraries = [];
      this.message.error(this.translate.instant('CODER_COMPONENT_LIBRARY.LOAD_FAILED'));
    } finally {
      this.loading = false;
    }
  }

  async addToProject(library: CoderComponentLibraryEntry): Promise<void> {
    if (library.installed || library.installing) {
      return;
    }
    const projectRoot = this.projectService.currentProjectPath;
    if (!projectRoot || !isSafeComponentLibraryDirectoryName(library.folderName)) {
      return;
    }

    const fsApi = window['fs'];
    const componentsRoot = this.electronService.pathJoin(projectRoot, 'components');
    const targetPath = this.electronService.pathJoin(componentsRoot, library.folderName);
    const stagingPath = this.electronService.pathJoin(
      componentsRoot,
      `.${library.folderName}.aily-install-${Date.now()}`,
    );
    if (this.electronService.exists(targetPath)) {
      library.installed = true;
      return;
    }

    library.installing = true;
    try {
      fsApi.mkdirSync(componentsRoot);
      fsApi.copySync(library.sourcePath, stagingPath);
      fsApi.renameSync(stagingPath, targetPath);
      library.installed = true;
      this.message.success(
        this.translate.instant('CODER_COMPONENT_LIBRARY.ADDED', {
          name: library.name || library.folderName,
        }),
      );
    } catch (error) {
      try {
        if (this.electronService.exists(stagingPath)) {
          fsApi.rmdirSync(stagingPath, { recursive: true, force: true });
        }
      } catch {
        /* best-effort cleanup of this operation's private staging directory */
      }
      console.error('[CoderComponentLibrary] add failed:', error);
      this.message.error(this.translate.instant('CODER_COMPONENT_LIBRARY.ADD_FAILED'));
    } finally {
      library.installing = false;
    }
  }

  openDocumentation(library: CoderComponentLibraryEntry): void {
    if (/^https?:\/\//iu.test(library.url)) {
      this.electronService.openUrl(library.url);
    }
  }

  private listDirectoryNames(directory: string): string[] {
    try {
      return (window['fs'].readDirSync(directory) as Array<string | { name?: string }>)
        .map(entry => typeof entry === 'string' ? entry : String(entry?.name ?? ''))
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}
