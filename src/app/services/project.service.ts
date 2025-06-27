import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { UiService } from './ui.service';
import { NewProjectData } from '../windows/project-new/project-new.component';
import { BlocklyService } from '../blockly/blockly.service';
import { ElectronService } from './electron.service';
import { NzMessageService } from 'ng-zorro-antd/message';
import { pinyin } from "pinyin-pro";
import { Router } from '@angular/router';
import { CmdService } from './cmd.service';
import { ConfigService } from './config.service';

interface ProjectPackageData {
  name: string;
  version?: string;
  author?: string;
  description?: string;
  path?: string;
  board?: string;
  type?: string;
  framework?: string;
}

@Injectable({
  providedIn: 'root',
})
export class ProjectService {

  stateSubject = new BehaviorSubject<'default' | 'loading' | 'loaded' | 'saving' | 'saved' | 'error'>('default');
  currentPackageData: ProjectPackageData = {
    name: 'aily blockly',
  };

  projectRootPath: string;
  currentProjectPath: string;
  currentBoardConfig: any;

  isMainWindow = false;
  isInstalling = false;

  constructor(
    private uiService: UiService,
    private blocklyService: BlocklyService,
    private electronService: ElectronService,
    private message: NzMessageService,
    private router: Router,
    private cmdService: CmdService,
    private configService: ConfigService
  ) {
  }

  // 初始化UI服务，这个init函数仅供main-window使用
  async init() {
    if (this.electronService.isElectron) {
      this.isMainWindow = true;
      window['ipcRenderer'].on('window-receive', async (event, message) => {
        console.log('window-receive', message);
        if (message.data.action == 'open-project') {
          this.projectOpen(message.data.path);
        } else {
          return;
        }
        // 反馈完成结果
        if (message.messageId) {
          window['ipcRenderer'].send('main-window-response', {
            messageId: message.messageId,
            result: "success"
          });
        }
      });

      // 监听来自文件关联的打开请求
      window['ipcRenderer'].on('open-project-from-file', async (event, projectPath) => {
        console.log('Received open-project-from-file event:', projectPath);
        try {
          await this.projectOpen(projectPath);
          console.log('Successfully opened project from file association');
        } catch (error) {
          console.error('Error opening project from file association:', error);
          this.message.error('无法打开项目: ' + error.message);
        }
      });

      this.projectRootPath = (await window['env'].get("AILY_PROJECT_PATH")).replace('%HOMEPATH%\\Documents', window['path'].getUserDocuments());
      this.currentProjectPath = this.projectRootPath;
    }
  }

  // 检测复制是否成功
  async checkIsExisits(filePath) {
    if (!window['path'].isExists(filePath)) {
      let checkCount = 0;
      const maxChecks = 10; // 5秒 / 500ms = 10次

      const checkFileExistence = () => {
        return new Promise((resolve, reject) => {
          const timer = setInterval(() => {
            checkCount++;
            if (window['path'].isExists(filePath)) {
              clearInterval(timer);
              resolve(true);
            } else if (checkCount >= maxChecks) {
              clearInterval(timer);
              this.message.error('无法找到项目文件: ' + filePath);
              this.uiService.updateFooterState({ state: 'error', text: '无法找到项目文件: ' + filePath });
              reject(new Error('无法找到项目文件: ' + filePath));
            }
          }, 500);
        });
      };

      try {
        await checkFileExistence();
        return true;
      } catch (error) {
        console.error('文件不存在:', error);
        return false;
      }
    }
    return true;
  }

  // 检测字符串是否包含中文字符
  containsChineseCharacters(str: string): boolean {
    const chineseRegex = /[\u4e00-\u9fa5]/;
    return chineseRegex.test(str);
  }

  // 新建项目
  async projectNew(newProjectData: NewProjectData) {
    console.log('newProjectData: ', newProjectData);
    const appDataPath = window['path'].getAppData();
    // const projectPath = (newProjectData.path + newProjectData.name).replace(/\s/g, '_');
    const projectPath = window['path'].join(newProjectData.path, newProjectData.name.replace(/\s/g, '_'));
    const boardPackage = newProjectData.board.name + '@' + newProjectData.board.version;

    this.uiService.updateFooterState({ state: 'doing', text: '正在创建项目...' });
    await this.cmdService.runAsync(`npm install ${boardPackage} --prefix "${appDataPath}"`);
    const templatePath = `${appDataPath}\\node_modules\\${newProjectData.board.name}\\template`;
    // 创建项目目录
    await this.cmdService.runAsync(`mkdir -p "${projectPath}"`);
    // 复制模板文件到项目目录
    await this.cmdService.runAsync(`cp -r "${templatePath}\\*" "${projectPath}"`);
    // 判断复制是否成功
    if (!await this.checkIsExisits(projectPath + '/project.abi')) {
      return;
    }

    // 3. 修改package.json文件
    const packageJson = JSON.parse(window['fs'].readFileSync(`${projectPath}/package.json`));
    if (this.containsChineseCharacters(newProjectData.name)) {
      packageJson.name = pinyin(newProjectData.name, {
        toneType: "none",
        separator: ""
      }).replace(/\s/g, '_');
    } else {
      packageJson.name = newProjectData.name;
    }

    window['fs'].writeFileSync(`${projectPath}/package.json`, JSON.stringify(packageJson, null, 2));

    this.uiService.updateFooterState({ state: 'done', text: '项目创建成功' });
    // 此后就是打开项目(projectOpen)的逻辑，理论可复用，由于此时在新建项目窗口，因此要告知主窗口，进行打开项目操作
    await window['iWindow'].send({ to: 'main', data: { action: 'open-project', path: projectPath } });
    this.uiService.closeWindow();
  }

  // 打开项目
  async projectOpen(projectPath = this.currentProjectPath) {
    await this.close();
    await new Promise(resolve => setTimeout(resolve, 100));
    // 判断路径是否存在
    if (!this.electronService.exists(projectPath)) {
      this.removeRecentlyProject({ path: projectPath })
      return this.message.error('项目路径不存在，请重新选择项目');
    }
    this.stateSubject.next('loading');

    // 更新当前项目路径和包数据
    this.currentProjectPath = projectPath;

    const abiIsExist = window['path'].isExists(projectPath + '/project.abi');
    if (abiIsExist) {
      // 打开blockly编辑器
      this.router.navigate(['/main/blockly-editor'], {
        queryParams: {
          path: projectPath
        },
        replaceUrl: true
      });
    } else {
      // 打开代码编辑器
      this.router.navigate(['/main/code-editor'], {
        queryParams: {
          path: projectPath
        },
        replaceUrl: true
      });
    }
  }

  // 保存项目
  save(path = this.currentProjectPath) {
    // 导出blockly json配置并保存
    // console.log('save path: ', path);
    const jsonData = this.blocklyService.getWorkspaceJson();
    window['fs'].writeFileSync(`${path}/project.abi`, JSON.stringify(jsonData, null, 2));
    this.stateSubject.next('saved');
  }

  saveAs(path) {
    //在当前路径下创建一个新的目录
    window['fs'].mkdirSync(path);
    // 复制项目目录到新路径
    window['fs'].copySync(this.currentProjectPath, path);
    // 修改package.json文件
    this.save(path);
    // 修改package.json文件
    const packageJson = JSON.parse(window['fs'].readFileSync(`${path}/package.json`));
    // 获取新的项目名称
    let name = path.split('\\').pop();
    packageJson.name = name;
    window['fs'].writeFileSync(`${path}/package.json`, JSON.stringify(packageJson, null, 2));
    // 修改当前项目路径
    this.currentProjectPath = path;
    this.currentPackageData = packageJson;
    this.addRecentlyProject({ name: this.currentPackageData.name, path: path });
  }

  async close() {
    this.currentProjectPath = '';
    this.currentPackageData = {
      name: 'aily blockly',
    };
    this.stateSubject.next('default');
    this.uiService.closeTerminal();
    this.currentProjectPath = (await window['env'].get("AILY_PROJECT_PATH")).replace('%HOMEPATH%\\Documents', window['path'].getUserDocuments());
    this.router.navigate(['/main/guide'], { replaceUrl: true });
  }

  // 通过ConfigService存储最近打开的项目
  get recentlyProjects(): any[] {
    return this.configService.data?.recentlyProjects || [];
  }

  set recentlyProjects(data) {
    this.configService.data.recentlyProjects = data;
    this.configService.save();
  }

  addRecentlyProject(data: { name: string, path: string }) {
    let temp: any[] = this.recentlyProjects
    temp.unshift(data);
    temp = temp.filter((item, index) => {
      return temp.findIndex((item2) => item2.path === item.path) === index;
    });
    if (temp.length > 6) {
      temp.pop();
    }
    this.recentlyProjects = temp;
  }

  removeRecentlyProject(data: { path: string }) {
    let temp: any[] = this.recentlyProjects
    temp = temp.filter((item) => {
      return item.path !== data.path;
    });
    this.recentlyProjects = temp;
  }

  // 检查项目是否未保存
  async hasUnsavedChanges(): Promise<boolean> {
    // 如果项目尚未加载，则没有未保存的更改
    if (this.stateSubject.value === 'default' || !this.currentProjectPath) {
      return false;
    }

    try {
      // 获取当前工作区的 JSON 数据
      const currentWorkspaceJson = this.blocklyService.getWorkspaceJson();

      // 读取并解析已保存的 JSON 数据
      const savedJsonStr = window['fs'].readFileSync(`${this.currentProjectPath}/project.abi`, 'utf8');
      const savedJson = JSON.parse(savedJsonStr);

      // 将当前工作区 JSON 和保存的 JSON 转为字符串进行比较
      const currentJsonStr = JSON.stringify(currentWorkspaceJson);
      const normalizedSavedJsonStr = JSON.stringify(savedJson);

      // 比较两个 JSON 字符串是否相同
      return currentJsonStr !== normalizedSavedJsonStr;
    } catch (error) {
      console.error('检查未保存更改时出错:', error);
      // 出错时，保守地返回 true，表示可能有未保存的更改
      return true;
    }
  }


}
