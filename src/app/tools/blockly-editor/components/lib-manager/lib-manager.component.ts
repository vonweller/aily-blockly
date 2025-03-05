import { Component, EventEmitter, Output } from '@angular/core';
import { NpmService } from '../../../../services/npm.service';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ConfigService } from '../../../../services/config.service';

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

  version;
  versionList = []

  constructor(
    private npmService: NpmService,
    private configService: ConfigService
  ) { }

  ngOnInit() {
    this.configService.loadLibraryList().then((data: any) => {
      this.LibraryList = data;
      this.processForSearch(this.LibraryList);
      this.checkInstalled();
    });
  }

  // 为全文搜索做准备
  processForSearch(array) {
    for (let index = 0; index < array.length; index++) {
      const item = array[index];
      // ${item.keywords.join(' ')}
      item['fulltext'] = `${item.nickname} ${item.description} ${item.brand} ${item.author.name}`;
    }
  }

  back() {
    this.close.emit();
  }

  // 获取已经安装的包，用于在界面上显示"移除"按钮
  checkInstalled() {
    window['npm'].run({ cmd: `npm list --depth=0 --json` }).then((data) => {
      console.log(data);
    });
  }

  installLib(lib) {
    window['npm'].run({ cmd: `npm install ${lib.name}@${this.version} --registry https://registry.openjumper.cn` }).then(() => {

    });
  }

  removeLib(lib) {
    window['npm'].run({ cmd: `npm install ${lib.name}@${this.version} --registry https://registry.openjumper.cn` }).then(() => {

    });
  }
}

interface PackageInfo {
  "name": string,
  "nickname": string,
  "scope"?: string,
  "description"?: string,
  "version"?: string,
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
