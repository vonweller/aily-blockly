import { Component } from '@angular/core';
import { SimplebarAngularModule } from 'simplebar-angular';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { NzMessageService } from 'ng-zorro-antd/message';
import { ProjectService } from '../../../services/project.service';
import { ConfigService } from '../../../services/config.service';
import { ElectronService } from '../../../services/electron.service';
import { CmdService } from '../../../services/cmd.service';

@Component({
  selector: 'app-subject-item',
  imports: [SimplebarAngularModule, NzButtonModule, TranslateModule,
  ],
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
    private projectService: ProjectService,
    private message: NzMessageService,
    private electronService: ElectronService,
    private cmdService: CmdService
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
    this.cmdService.runAsync(`npm install ${lib.name} --prefix "${prefix}"`)
  }


  async loadExample(path) {
    const appDataPath = this.configService.data.appdata_path[this.configService.data.platform].replace('%HOMEPATH%', window['path'].getUserHome());
    const examplePath = `${appDataPath}/node_modules/${this.exampleItem.name}/${path}`;
    const abiFilePath = `${examplePath}/project.abi`;

    if (!this.electronService.exists(examplePath) || !this.electronService.exists(abiFilePath)) {
      await this.cmdService.runAsync(`npm install ${this.exampleItem.name} --prefix "${appDataPath}"`)
    }

    const targetPath = `${this.projectService.projectRootPath}\\${path}`;
    await this.cmdService.runAsync(`cp -r "${examplePath}" "${targetPath}"`);
    this.projectService.projectOpen(targetPath);
  }

  openUrl(url = 'https://arduino.me') {
    if (url) {
      this.electronService.openUrl(url);
    } else {
      this.message.error("invalid url");
    }
  }
}
