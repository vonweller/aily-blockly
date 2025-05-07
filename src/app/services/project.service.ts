import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { UiService } from './ui.service';
import { NewProjectData } from '../windows/project-new/project-new.component';
import { TerminalService } from '../tools/terminal/terminal.service';
import { BlocklyService } from '../blockly/blockly.service';
import { ElectronService } from './electron.service';
import { NzMessageService } from 'ng-zorro-antd/message';
import { pinyin } from "pinyin-pro";
import { Router } from '@angular/router';

const { isMacOS } = (window as any)['electronAPI'].platform;

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

  currentProjectPath: string;
  currentBoardConfig: any;

  isMainWindow = false;
  isInstalling = false;

  constructor(
    private uiService: UiService,
    private terminalService: TerminalService,
    private blocklyService: BlocklyService,
    private electronService: ElectronService,
    private message: NzMessageService,
    private router: Router
  ) {
    // window['ipcRenderer'].on('project-update', (event, data) => {
    //   console.log('收到更新的: ', data);
    //   this.currentProject = data.path;
    //   this.projectOpen(this.currentProject);
    // });
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
      this.currentProjectPath = (await window['env'].get("AILY_PROJECT_PATH")).replace('%HOMEPATH%\\Documents', window['path'].getUserDocuments());
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
              this.uiService.updateState({ state: 'error', text: '无法找到项目文件: ' + filePath });
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

    this.uiService.updateState({ state: 'doing', text: '正在创建项目...' });
    // 1. 检查开发板module是否存在, 不存在则安装
    await this.uiService.openTerminal();
    await this.terminalService.sendCmd(`npm install ${boardPackage} --prefix "${appDataPath}"`);
    // 2. 创建项目目录，复制开发板module中的template到项目目录
    const templatePath = `${appDataPath}/node_modules/${newProjectData.board.name}/template`;
    // powsershell命令创建目录并复制文件（好处是可以在终端显示出过程，以后需要匹配mac os和linux的命令（陈吕洲 2025.3.4））
    if (isMacOS) {
      // TODO 此命令应该是各系统通用的，可进行验证无问题均换成此命令 @downey @coloz
      await this.terminalService.sendCmd(`mkdir -p "${projectPath}"`);
      await this.terminalService.sendCmd(`cp -r "${templatePath}/" "${projectPath}"`);
    } else {
      await this.terminalService.sendCmd(`New-Item -Path "${projectPath}" -ItemType Directory -Force`);
      await this.terminalService.sendCmd(`Copy-Item -Path "${templatePath}\\*" -Destination "${projectPath}" -Recurse -Force`);
    }
    // node命令创建目录并复制文件
    // window['fs'].mkdirSync(projectPath);
    // window['fs'].copySync(templatePath, projectPath);

    // 判断复制是否成功
    const packageJsonPath = window['path'].join(projectPath, 'package.json');
    if (!await this.checkIsExisits(packageJsonPath)) {
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

    this.uiService.updateState({ state: 'done', text: '项目创建成功' });
    // 此后就是打开项目(projectOpen)的逻辑，理论可复用，由于此时在新建项目窗口，因此要告知主窗口，进行打开项目操作
    await window['iWindow'].send({ to: 'main', data: { action: 'open-project', path: projectPath } });
    this.uiService.closeWindow();
  }

  // 打开项目
  async projectOpen(projectPath = this.currentProjectPath) {
    await this.close();
    await new Promise(resolve => setTimeout(resolve, 100));
    // this.uiService.updateState({ state: 'doing', text: '正在打开项目...' });
    this.stateSubject.next('loading');
    // this.uiService.
    // 0. 判断路径是否存在
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
    // 延迟50ms，为了等待blockly实例初始化完成
    // await new Promise(resolve => setTimeout(resolve, 120));
    // // 加载项目package.json
    // const packageJson = JSON.parse(window['fs'].readFileSync(`${projectPath}/package.json`));
    // // 添加到最近打开的项目
    // this.addRecentlyProject({ name: packageJson.name, path: projectPath });
    // this.currentPackageData = packageJson;

    // // 1. 终端进入项目目录
    // // 2. 安装项目依赖。检查是否有node_modules目录，没有则安装依赖，有则跳过
    // const nodeModulesExist = window['path'].isExists(projectPath + '/node_modules');
    // if (!nodeModulesExist) {
    //   this.uiService.updateState({ state: 'doing', text: '正在安装依赖' });
    //   await this.uiService.openTerminal();
    //   await this.terminalService.sendCmd(`cd "${projectPath}"`);
    //   await this.terminalService.sendCmd(`npm install`);
    // }
    // // 3. 加载开发板module中的board.json
    // this.uiService.updateState({ state: 'doing', text: '正在加载开发板配置' });
    // const boardModule = Object.keys(packageJson.dependencies).find(dep => dep.startsWith('@aily-project/board-'));
    // console.log('boardModule: ', boardModule);
    // // let boardJsonPath = projectPath + '\\node_modules\\' + boardModule + '\\board.json';
    // // TODO 兼容mac arm改为了单杠，按理win也是可以的，如果不行则还原或者使用环境变量判断使用路径 @coloz
    // let boardJsonPath = projectPath + '/node_modules/' + boardModule + '/board.json';
    // console.log('boardJsonPath: ', boardJsonPath);

    // // 判断board.json是否存在
    // if (!await this.checkIsExisits(boardJsonPath)) {
    //   return;
    // }

    // const boardJson = JSON.parse(window['fs'].readFileSync(boardJsonPath));
    // this.blocklyService.loadBoardConfig(boardJson);
    // // 4. 加载blockly library
    // const libraryModuleList = Object.keys(packageJson.dependencies).filter(dep => dep.startsWith('@aily-project/lib-'));
    // // console.log('libraryModuleList: ', libraryModuleList);
    // for (let index = 0; index < libraryModuleList.length; index++) {
    //   const libPackageName = libraryModuleList[index];
    //   this.uiService.updateState({ state: 'doing', text: '正在加载' + libPackageName });
    //   await this.blocklyService.loadLibrary(libPackageName, projectPath);
    // }
    // // 5. 加载project.abi数据
    // this.uiService.updateState({ state: 'doing', text: '正在加载blockly程序' });
    // let jsonData = JSON.parse(window['fs'].readFileSync(`${projectPath}/project.abi`));
    // this.blocklyService.loadAbiJson(jsonData);

    // // 6. 加载项目目录中project.abi（这是blockly格式的json文本必须要先安装库才能加载这个json，因为其中可能会用到一些库）
    // this.uiService.updateState({ state: 'done', text: '项目加载成功' });
    // this.stateSubject.next('loaded');

    // // 7. 后台安装开发板依赖
    // // this.installBoardDependencies();

    // await window['iWindow'].send({
    //   to: "main",
    //   timeout: 1000 * 60 * 5,
    //   data: {
    //     action: 'npm-exec',
    //     detail: {
    //       action: 'install-board-dependencies',
    //       data: `${this.currentProjectPath}/package.json`
    //     }
    //   }
    // })
  }

  // async installBoardDependencies() {
  //   if (this.isInstalling) {
  //     console.log('依赖安装已在进行中，跳过');
  //     return;
  //   }

  //   this.isInstalling = true;

  //   try {
  //     const appDataPath = await window['env'].get("AILY_APPDATA_PATH");
  //     console.log('appDataPath: ', appDataPath);

  //     if (!appDataPath) {
  //       console.error('无法获取应用数据路径');
  //       return;
  //     }

  //     await new Promise(resolve => setTimeout(resolve, 2000));

  //     try {
  //       const packageJsonPath = `${this.currentProjectPath}/package.json`;
  //       if (!window['path'].isExists(packageJsonPath)) {
  //         console.error('项目配置文件不存在:', packageJsonPath);
  //         return;
  //       }

  //       const packageJson = JSON.parse(window['fs'].readFileSync(packageJsonPath));
  //       const boardDependencies = packageJson.boardDependencies || {};

  //       for (const [key, version] of Object.entries(boardDependencies)) {
  //         const depPath = `${appDataPath}/node_modules/${key}`;

  //         if (window['path'].isExists(depPath)) {
  //           console.log(`依赖 ${key} 已安装`);
  //           continue;
  //         }

  //         this.uiService.updateState({ state: 'loading', text: `正在安装${key}依赖...`, timeout: 300000 });

  //         try {
  //           // 安装成功的条件是需要安装目录指私有源或者全局已经设置私有源
  //           const npmCmd = `npm install ${key}@${version} --prefix "${appDataPath}"`;
  //           console.log(`执行命令: ${npmCmd}, 时间: ${new Date().toISOString()}`);

  //           // 添加超时保护和正确的参数名
  //           await Promise.race([
  //             window['npm'].run({ cmd: npmCmd }),
  //             new Promise((_, reject) =>
  //               setTimeout(() => reject(new Error('安装超时')), 300000) // 5分钟超时
  //             )
  //           ]);

  //           console.log(`依赖 ${key} 安装成功, 时间: ${new Date().toISOString()}`);
  //         } catch (error) {
  //           console.error(`依赖 ${key} 安装失败:`, error);
  //         }
  //       }

  //       this.uiService.updateState({ state: 'done', text: '开发板依赖安装完成' });
  //     } catch (error) {
  //       console.error('安装开发板依赖时出错:', error);
  //       this.uiService.updateState({ state: 'error', text: '开发板依赖安装失败' });
  //     }
  //   } finally {
  //     this.isInstalling = false;
  //   }
  // }

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

  // 通过localStorage存储最近打开的项目
  get recentlyProjects(): any[] {
    let data;
    let dataStr = localStorage.getItem('recentlyProjects')
    if (dataStr) {
      data = JSON.parse(dataStr);
    } else {
      data = [];
    }
    return data
  }

  set recentlyProjects(data) {
    localStorage.setItem('recentlyProjects', JSON.stringify(data));
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
