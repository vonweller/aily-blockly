import { Component, EventEmitter, Output } from '@angular/core';
import { NpmService } from '../../../../services/npm.service';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ConfigService } from '../../../../services/config.service';
import { ProjectService } from '../../../../services/project.service';

@Component({
  selector: 'app-lib-manager',
  imports: [
    FormsModule,
    CommonModule,
    NzInputModule,
    NzButtonModule,
    NzToolTipModule,
    NzSelectModule
  ],
  templateUrl: './lib-manager.component.html',
  styleUrl: './lib-manager.component.scss'
})
export class LibManagerComponent {

  @Output() close = new EventEmitter();

  LibraryList: PackageInfo[] = [];

  constructor(
    private npmService: NpmService,
    private configService: ConfigService,
    private projectService: ProjectService
  ) { }

  ngOnInit() {
    this.configService.loadLibraryList().then((data: any) => {
      this.checkInstalled();
      this.LibraryList = this.process(data);
      console.log(this.LibraryList);
    });
  }

  // 处理库列表数据，为显示做准备
  process(array) {
    for (let index = 0; index < array.length; index++) {
      const item = array[index];
      // 为全文搜索做准备
      item['fulltext'] = `${item.nickname} ${item.description} ${item.keywords} ${item.brand} ${item.author}`;
      // 为版本选择做准备
      item['versionList'] = [item.version];
    }
    return array;
  }

  keyword: string;
  search(keyword) {
    if (keyword) {
      this.LibraryList = this.LibraryList.filter((item) => {
        return item.fulltext.includes(keyword);
      });
    } else {
      this.configService.loadLibraryList().then((data: any) => {
        this.LibraryList = this.process(data);
      });
    }
  }

  back() {
    this.close.emit();
  }

  // 获取已经安装的包，用于在界面上显示"移除"按钮
  installedPackages = [];
  checkInstalled() {
    window['npm'].run({ cmd: `npm list --depth=0 --json --prefix ${this.projectService.currentProjectPath}` }).then((data) => {
      // console.log(data.dependencies);
      for (let key in data.dependencies) {
        const item = data.dependencies[key];
        this.installedPackages.push(key + '@' + item.version);
      }
    });
  }

  isInstalled(lib) {
    return this.installedPackages.indexOf(lib.name + '@' + lib.version) > -1;
  }

  installLib(lib) {
    window['npm'].run({ cmd: `npm install ${lib.name}@${lib.version} --registry https://registry.openjumper.cn` }).then(() => {

    });
  }

  removeLib(lib) {
    // 移除库前，应先检查项目代码是否使用了该库，如果使用了，应提示用户
    // 这个比较复杂没想好怎么写（陈吕洲 2025.3.6）

    window['npm'].run({ cmd: `npm uninstall ${lib.name}@${lib.version} --registry https://registry.openjumper.cn` }).then(() => {

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
  "fulltext"?: string
}
