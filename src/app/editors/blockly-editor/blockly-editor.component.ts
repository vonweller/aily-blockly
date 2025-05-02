import { ChangeDetectorRef, Component } from '@angular/core';
import { BlocklyComponent } from '../../blockly/blockly.component';
import { LibManagerComponent } from '../../pages/lib-manager/lib-manager.component';
import { NotificationComponent } from '../../components/notification/notification.component';
import { ProjectService } from '../../services/project.service';
import { UiService } from '../../services/ui.service';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { TerminalService } from '../../tools/terminal/terminal.service';
import { BlocklyService } from '../../blockly/blockly.service';
import { ElectronService } from '../../services/electron.service';

@Component({
  selector: 'app-blockly-editor',
  imports: [
    BlocklyComponent,
    LibManagerComponent,
    NotificationComponent,
    TranslateModule
  ],
  templateUrl: './blockly-editor.component.html',
  styleUrl: './blockly-editor.component.scss'
})
export class BlocklyEditorComponent {
  showProjectManager = false;

  constructor(
    private cd: ChangeDetectorRef,
    private projectService: ProjectService,
    private uiService: UiService,
    private activatedRoute: ActivatedRoute,
    private terminalService: TerminalService,
    private blocklyService: BlocklyService,
    private electronService: ElectronService
  ) { }

  ngOnInit(): void {
    this.activatedRoute.queryParams.subscribe(params => {
      if (params['path']) {
        console.log('project path', params['path']);
        this.loadProject(params['path']);
      }
    });
  }

  ngOnDestroy(): void {
    this.blocklyService.reset();
  }

  async loadProject(projectPath) {
    await new Promise(resolve => setTimeout(resolve, 100));
    // 加载项目package.json
    const packageJson = JSON.parse(this.electronService.readFile(`${projectPath}/package.json`));
    // 添加到最近打开的项目
    this.projectService.addRecentlyProject({ name: packageJson.name, path: projectPath });
    this.projectService.currentPackageData = packageJson;
    // 1. 终端进入项目目录
    // 2. 安装项目依赖。检查是否有node_modules目录，没有则安装依赖，有则跳过
    const nodeModulesExist = this.electronService.exists(projectPath + '/node_modules');
    if (!nodeModulesExist) {
      this.uiService.updateState({ state: 'doing', text: '正在安装依赖' });
      await this.uiService.openTerminal();
      await this.terminalService.sendCmd(`cd "${projectPath}"`);
      await this.terminalService.sendCmd(`npm install`);
    }
    // 3. 加载开发板module中的board.json
    this.uiService.updateState({ state: 'doing', text: '正在加载开发板配置' });
    const boardModule = Object.keys(packageJson.dependencies).find(dep => dep.startsWith('@aily-project/board-'));
    console.log('boardModule: ', boardModule);
    // let boardJsonPath = projectPath + '\\node_modules\\' + boardModule + '\\board.json';
    // TODO 兼容mac arm改为了单杠，按理win也是可以的，如果不行则还原或者使用环境变量判断使用路径 @coloz
    let boardJsonPath = projectPath + '/node_modules/' + boardModule + '/board.json';
    const boardJson = JSON.parse(this.electronService.readFile(boardJsonPath));
    this.blocklyService.loadBoardConfig(boardJson);
    // 4. 加载blockly library
    const libraryModuleList = Object.keys(packageJson.dependencies).filter(dep => dep.startsWith('@aily-project/lib-'));
    // console.log('libraryModuleList: ', libraryModuleList);
    for (let index = 0; index < libraryModuleList.length; index++) {
      const libPackageName = libraryModuleList[index];
      this.uiService.updateState({ state: 'doing', text: '正在加载' + libPackageName });
      await this.blocklyService.loadLibrary(libPackageName, projectPath);
    }
    // 5. 加载project.abi数据
    this.uiService.updateState({ state: 'doing', text: '正在加载blockly程序' });
    let jsonData = JSON.parse(this.electronService.readFile(`${projectPath}/project.abi`));
    this.blocklyService.loadAbiJson(jsonData);

    // 6. 加载项目目录中project.abi（这是blockly格式的json文本必须要先安装库才能加载这个json，因为其中可能会用到一些库）
    this.uiService.updateState({ state: 'done', text: '项目加载成功' });
    this.projectService.stateSubject.next('loaded');

    // 7. 后台安装开发板依赖
    // this.installBoardDependencies();

    await window['iWindow'].send({
      to: "main",
      timeout: 1000 * 60 * 5,
      data: {
        action: 'npm-exec',
        detail: {
          action: 'install-board-dependencies',
          data: `${projectPath}/package.json`
        }
      }
    })
  }

  openProjectManager() {
    this.uiService.closeToolAll();
    this.showProjectManager = !this.showProjectManager;
    this.cd.detectChanges();
  }

  // 测试用
  reload() {
    this.projectService.projectOpen(this.projectService.currentProjectPath);
  }
}
