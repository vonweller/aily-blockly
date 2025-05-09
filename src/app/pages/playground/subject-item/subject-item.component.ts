import { Component } from '@angular/core';
import { ITEM_LIST } from '../data';
import { SimplebarAngularModule } from 'simplebar-angular';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzMessageService } from 'ng-zorro-antd/message';
import { UiService } from '../../../services/ui.service';
import { TerminalService } from '../../../tools/terminal/terminal.service';
import { ProjectService } from '../../../services/project.service';
import { ConfigService } from '../../../services/config.service';
import { ElectronService } from '../../../services/electron.service';

@Component({
  selector: 'app-subject-item',
  imports: [SimplebarAngularModule, NzButtonModule, TranslateModule],
  templateUrl: './subject-item.component.html',
  styleUrl: './subject-item.component.scss'
})
export class SubjectItemComponent {

  exampleItem;

  // example存放路径
  examplesRoot;
  
  get examplesList() {
    return this.configService.examplesList;
  }

  options = {
    autoHide: true,
    clickOnTrack: true,
    scrollbarMinSize: 50,
  };

  constructor(
    private route: ActivatedRoute, 
    private configService: ConfigService,
    private uiService: UiService,
    private terminalService: TerminalService,
    private projectService: ProjectService,
    private translate: TranslateService,
    private message: NzMessageService,
    private electronService: ElectronService,
  ) { }

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const name = params.get('name');
      if (name) {
        this.exampleItem = this.examplesList.find(item => item.nickname === name);
      }
    });
  }

  async installLib(lib, prefix) {
    const cmd = `npm install ${lib.name} --prefix "${prefix}"`;
    await this.terminalService.sendCmd(cmd);
  }


  async loadExample(path) {
    const appDataPath = this.configService.data.appdata_path[this.configService.data.platform].replace('%HOMEPATH%', window['path'].getUserHome());
    const examplePath = `${appDataPath}/node_modules/${this.exampleItem.name}/${path}`;
    const abiFilePath = `${examplePath}/project.abi`;

    await this.uiService.openTerminal();
    await this.terminalService.sendCmd(`cd "${this.projectService.projectRootPath}"`);
    if (!this.electronService.exists(examplePath) || !this.electronService.exists(abiFilePath)) {
      await this.installLib(this.exampleItem, appDataPath);
    }

    const targetPath = `${this.projectService.projectRootPath}/${path}`;
    await this.terminalService.sendCmd(`Copy-Item -Path "${examplePath}" -Destination "${targetPath}" -Recurse -Force`);

    this.projectService.projectOpen(targetPath);
  }

  openUrl(url='https://arduino.me') {
    if (url) {
      this.electronService.openUrl(url);
    } else {
      this.message.error("invalid url");
    }
  }
}
