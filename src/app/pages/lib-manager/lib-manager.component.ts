import { ChangeDetectorRef, Component, EventEmitter, Output } from '@angular/core';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NpmService } from '../../services/npm.service';
import { ConfigService } from '../../services/config.service';
import { ProjectService } from '../../services/project.service';
import { BlocklyService } from '../../blockly/blockly.service';
import { NzModalService } from 'ng-zorro-antd/modal';
import { CompatibleDialogComponent } from './components/compatible-dialog/compatible-dialog.component';
import { CmdOutput, CmdService } from '../../services/cmd.service';
import { ElectronService } from '../../services/electron.service';

@Component({
  selector: 'app-lib-manager',
  imports: [
    FormsModule,
    CommonModule,
    NzInputModule,
    NzButtonModule,
    NzToolTipModule,
    NzSelectModule,
    NzTagModule,
    TranslateModule
  ],
  templateUrl: './lib-manager.component.html',
  styleUrl: './lib-manager.component.scss'
})
export class LibManagerComponent {

  @Output() close = new EventEmitter();

  keyword: string = '';
  tagList: string[] = [];
  libraryList: PackageInfo[] = [];
  _libraryList: PackageInfo[] = [];
  installedPackageList: string[] = [];
  tagListRandom;

  loading = false;

  constructor(
    private npmService: NpmService,
    private configService: ConfigService,
    private projectService: ProjectService,
    private blocklyService: BlocklyService,
    private message: NzMessageService,
    private cd: ChangeDetectorRef,
    private translate: TranslateService,
    private modal: NzModalService,
    private cmdService: CmdService,
    private electronService: ElectronService
  ) { }

  ngOnInit() {
    // 使用翻译初始化标签列表
    this.tagList = [
      this.translate.instant('LIB_MANAGER.SENSORS'),
      this.translate.instant('LIB_MANAGER.ACTUATORS'),
      this.translate.instant('LIB_MANAGER.COMMUNICATION'),
      this.translate.instant('LIB_MANAGER.DISPLAY'),
      this.translate.instant('LIB_MANAGER.SOUND'),
      this.translate.instant('LIB_MANAGER.STORAGE'),
      this.translate.instant('LIB_MANAGER.ROBOT'),
      this.translate.instant('LIB_MANAGER.AI'),
      this.translate.instant('LIB_MANAGER.IOT'),
      this.translate.instant('LIB_MANAGER.OTHERS')
    ];

    this.configService.loadLibraryList().then(async (data: any) => {
      this._libraryList = this.process(data);
      this.libraryList = JSON.parse(JSON.stringify(this._libraryList));
      this.checkInstalled();
    });
  }

  async checkInstalled() {
    // 获取已经安装的包，用于在界面上显示"移除"按钮
    this.installedPackageList = (await this.npmService.getAllInstalledLibraries(this.projectService.currentProjectPath)).map(item => item.name + '@' + item.version);
    for (let index = 0; index < this._libraryList.length; index++) {
      const item = this._libraryList[index];
      if (this.isInstalled(item)) {
        setTimeout(() => {
          item['state'] = 'installed';
          item['fulltext'] = `已安装${item.name.includes('lib-core-') ? '核心库' : ''}${item.nickname}${item.keywords}${item.description}${item.brand}`.replace(/\s/g, '').toLowerCase();
        }, 0);
      } else {
        item['state'] = 'default';
        item['fulltext'] = item.fulltext.replace('已安装', '');
      }
    }
    this.cd.detectChanges();
  }

  isInstalled(lib) {
    return this.installedPackageList.indexOf(lib.name + '@' + lib.version) > -1
  }

  // 处理库列表数据，为显示做准备
  process(array) {
    for (let index = 0; index < array.length; index++) {
      const item = array[index];
      // 为版本选择做准备
      item['versionList'] = [item.version];
      // 为状态做准备
      item['state'] = 'default'; // default, installed, installing, uninstalling
      // 为全文搜索做准备
      item['fulltext'] = `${item.name.includes('lib-core-') ? '核心库' : ''}${item.nickname}${item.keywords}${item.description}${item.brand}`.replace(/\s/g, '').toLowerCase();
    }
    return array;
  }

  search(keyword = this.keyword) {
    if (keyword) {
      keyword = keyword.replace(/\s/g, '').toLowerCase();

      // 处理翻译后的特殊关键词
      const installedKey = this.translate.instant('LIB_MANAGER.INSTALLED').toLowerCase();
      const coreLibKey = this.translate.instant('LIB_MANAGER.CORE_LIBRARY').toLowerCase();

      if (keyword === installedKey) {
        keyword = '已安装';
      } else if (keyword === coreLibKey) {
        keyword = '核心库';
      }

      // 使用indexOf过滤并记录关键词位置，然后按位置排序
      const matchedItems = this._libraryList
        .map(item => {
          const index = item.fulltext.indexOf(keyword);
          return { item, index };
        })
        .filter(({ index }) => index !== -1)
        .sort((a, b) => a.index - b.index)
        .map(({ item }) => item);

      this.libraryList = matchedItems;
    } else {
      this.libraryList = JSON.parse(JSON.stringify(this._libraryList));
    }
  }

  back() {
    this.close.emit();
  }

  async getVerisons(lib) {
    this.loading = true;
    lib.versionList = this.npmService.getPackageVersionList(lib.name);
    this.loading = false;
  }

  currentStreamId;
  output = '';
  async installLib(lib) {
    // 检查库兼容性
    // console.log('当前开发板内核：', this.projectService.currentBoardConfig.core.replace('aily:', ''));
    // console.log('当前库兼容内核：', JSON.stringify(lib.compatibility.core));
    if (!await this.checkCompatibility(lib.compatibility.core, this.projectService.currentBoardConfig.core.replace('aily:', ''))) {
      return;
    }
    // console.log('当前项目路径：', this.projectService.currentProjectPath);

    lib.state = 'installing';
    this.message.loading(`${lib.nickname} ${this.translate.instant('LIB_MANAGER.INSTALLING')}...`);
    this.output = '';
    await this.cmdService.runAsync(`npm install ${lib.name}@${lib.version}`, this.projectService.currentProjectPath)
    await this.checkInstalled();
    lib.state = 'default';
    this.message.success(`${lib.nickname} ${this.translate.instant('LIB_MANAGER.INSTALLED')}`);
    this.blocklyService.loadLibrary(lib.name, this.projectService.currentProjectPath);
  }

  async removeLib(lib) {
    // 移除库前，应先检查项目代码是否使用了该库，如果使用了，应提示用户
    lib.state = 'uninstalling';
    this.message.loading(`${lib.nickname} ${this.translate.instant('LIB_MANAGER.UNINSTALLING')}...`);
    const libPackagePath = this.projectService.currentProjectPath + '\\node_modules\\' + lib.name;
    this.blocklyService.removeLibrary(libPackagePath);
    this.output = '';
    await this.cmdService.runAsync(`npm uninstall ${lib.name}`, this.projectService.currentProjectPath);
    await this.checkInstalled();
    lib.state = 'default';
    this.message.success(`${lib.nickname} ${this.translate.instant('LIB_MANAGER.UNINSTALLED')}`);
  }

  async checkCompatibility(libCompatibility, boardCore): Promise<boolean> {
    // 检查项目是否有未保存的更改
    if (!libCompatibility || libCompatibility.length == 0 || libCompatibility.includes(boardCore)) {
      return true;
    }
    // 遍历libCompatibility，判断每个元素是否包含boardCore
    for (let i = 0; i < libCompatibility.length; i++) {
      const element = libCompatibility[i];
      if (element.includes(boardCore)) {
        return true;
      }
    }

    return new Promise<boolean>((resolve) => {
      const modalRef = this.modal.create({
        nzTitle: null,
        nzFooter: null,
        nzClosable: false,
        nzBodyStyle: {
          padding: '0',
        },
        nzWidth: '360px',
        nzContent: CompatibleDialogComponent,
        nzData: { libCompatibility, boardCore },
        // nzDraggable: true,
      });

      modalRef.afterClose.subscribe(async result => {
        if (!result) {
          // 用户直接关闭对话框，视为取消操作
          resolve(false);
          return;
        }
        switch (result.result) {
          case 'continue':
            resolve(true);
            break;
          case 'cancel':
            resolve(false);
            break;
          default:
            resolve(false);
            break;
        }
      });
    });
  }

  openExample(packageName) {
    this.electronService.openNewInStance('/main/playground/s/' + packageName.replace('@aily-project/', ''))
  }
}

interface PackageInfo {
  "name": string,
  "nickname": string,
  "scope"?: string,
  "description"?: string,
  "version"?: string,
  "versionList"?: string[],
  "keywords"?: string[],
  "date"?: string,
  "author"?: {
    "name"?: string
  },
  icon?: string,
  "publisher"?: any,
  "maintainers"?: any[],
  "links"?: any,
  "brand"?: string,
  "fulltext"?: string,
  tested: boolean,
  state: 'default' | 'installed' | 'installing' | 'uninstalling',
  example?: string
}
