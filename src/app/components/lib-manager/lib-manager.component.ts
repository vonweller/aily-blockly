import { ChangeDetectorRef, Component, EventEmitter, Output } from '@angular/core';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NpmService } from '../../services/npm.service';
import { ConfigService } from '../../services/config.service';
import { ProjectService } from '../../services/project.service';
import { BlocklyService } from '../../blockly/blockly.service';
import { TerminalService } from '../../tools/terminal/terminal.service';
import { UiService } from '../../services/ui.service';

@Component({
  selector: 'app-lib-manager',
  imports: [
    FormsModule,
    CommonModule,
    NzInputModule,
    NzButtonModule,
    NzToolTipModule,
    NzSelectModule,
    NzTagModule
  ],
  templateUrl: './lib-manager.component.html',
  styleUrl: './lib-manager.component.scss'
})
export class LibManagerComponent {

  @Output() close = new EventEmitter();


  keyword: string = '';
  tagList = ['传感器', '执行器', '通信', '显示', '声音', '存储', '机器人', 'AI', '物联网', '其他'];
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
    private terminalService: TerminalService,
    private uiService: UiService,
    private message: NzMessageService,
    private cd: ChangeDetectorRef
  ) { }

  ngOnInit() {
    this.configService.loadLibraryList().then(async (data: any) => {
      this._libraryList = this.process(data);
      this.libraryList = JSON.parse(JSON.stringify(this._libraryList));
      this.checkInstalled();
    });
  }

  async checkInstalled() {
    // 获取已经安装的包，用于在界面上显示"移除"按钮
    this.installedPackageList = await this.npmService.getInstalledPackageList(this.projectService.currentProjectPath);
    for (let index = 0; index < this._libraryList.length; index++) {
      const item = this._libraryList[index];
      if (this.isInstalled(item)) {
        item['state'] = 'installed';
        item['fulltext'] = `已安装${item.name.includes('lib-core-') ? '核心库' : ''}${item.nickname}${item.description}${item.keywords}${item.brand}${item.author}`.replace(/\s/g, '').toLowerCase();
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
      item['fulltext'] = `${item.name.includes('lib-core-') ? '核心库' : ''}${item.nickname}${item.description}${item.keywords}${item.brand}${item.author}`.replace(/\s/g, '').toLowerCase();
    }
    return array;
  }

  search(keyword = this.keyword) {
    if (keyword) {
      keyword = keyword.replace(/\s/g, '').toLowerCase();
      this.libraryList = this._libraryList.filter((item) => item.fulltext.includes(keyword));
    } else {
      this.libraryList = JSON.parse(JSON.stringify(this._libraryList));
    }
  }

  back() {
    this.close.emit();
  }

  getVerisons(lib) {
    this.loading = true;
    this.npmService.getPackageVersionList(lib.name).then((data) => {
      lib.versionList = data;
      this.loading = false;
    })
  }

  async installLib(lib) {
    lib.state = 'installing';
    this.message.loading(`${lib.nickname} Installing...`);
    await this.uiService.openTerminal();
    await this.terminalService.sendCmd(`cd ${this.projectService.currentProjectPath}`);
    this.terminalService.sendCmd(`npm install ${lib.name}@${lib.version}`).then(async () => {
      await this.checkInstalled();
      lib.state = 'default';
      this.message.success(`${lib.nickname} Installed`);
      // 通知blockly加载新库
      // const libPackagePath = this.projectService.currentProjectPath + '\\node_modules\\' + lib.name;
      this.blocklyService.loadLibrary(lib.name, this.projectService.currentProjectPath);
    });
  }

  async removeLib(lib) {
    // 移除库前，应先检查项目代码是否使用了该库，如果使用了，应提示用户
    // 这个比较复杂没想好怎么写（陈吕洲 2025.3.6）
    lib.state = 'uninstalling';
    this.message.loading(`${lib.nickname} Uninstalling...`);
    // 通知blockly移除库
    const libPackagePath = this.projectService.currentProjectPath + '\\node_modules\\' + lib.name;
    this.blocklyService.removeLibrary(libPackagePath);
    await this.uiService.openTerminal();
    this.terminalService.sendCmd(`npm uninstall ${lib.name}`).then(async () => {
      this.checkInstalled();
      lib.state = 'default';
      this.message.success(`${lib.nickname} Uninstalled`);
    });
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
  "publisher"?: any,
  "maintainers"?: any[],
  "links"?: any,
  "brand"?: string,
  "fulltext"?: string,
  state: 'default' | 'installed' | 'installing' | 'uninstalling'
}
