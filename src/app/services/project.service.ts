import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';
import { ResponseModel } from '../interfaces/response.interface';
import { API } from '../configs/api.config';
import { UiService } from './ui.service';
import { NewProjectData } from '../windows/project-new/project-new.component';

interface ProjectData {
  name: string;
  version: string;
  author: string;
  description: string;
  path: string;
  board: string;
  type: string;
  framework: string;
}

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  loaded = new BehaviorSubject<boolean>(false);

  projectData: ProjectData = {
    name: 'aily blockly',
    version: '1.0.0',
    path: '',
    author: '',
    description: '',
    board: '',
    type: 'web',
    framework: 'angular',
  };

  currentProject: string;

  constructor(
    private http: HttpClient,
    private uiService: UiService
  ) {
    window['ipcRenderer'].on('project-update', (event, data) => {
      console.log('收到更新的: ', data);
      this.currentProject = data.path;
      this.projectOpen(this.currentProject);
    });
  }

  /**
   * 库列表
   * @param data
   */
  list(data: any) {
    return this.http.get<ResponseModel>(API.projectList, {
      params: data,
    });
  }

  /**
   * 库搜索
   * @param data
   * @param data.text 搜索关键字
   * @param data.size
   * @param data.from
   * @param data.quality
   * @param data.popularity
   * @param data.maintenance
   */
  search(data: any) {
    return this.http.get<ResponseModel>(API.projectSearch, {
      params: data,
    });
  }

  // 新建项目
  async projectNew(newProjectData: NewProjectData) {
    this.uiService.updateState({ state: 'loading', text: '正在创建项目...' });
    // 1. 检查开发板module是否存在, 不存在则安装


    // 2. 创建项目目录，复制开发板module中的template到项目目录
    let path = newProjectData.path + newProjectData.name

    
    this.uiService.updateState({ state: 'done', text: '项目创建成功' });
    // 此后就是打开项目(projectOpen)的逻辑，理论可复用
    this.projectOpen(path)
    // 检查项目


    // 3. 加载开发板module中的board.json到全局


    // 4. 打开blockly编辑器


    // 5. 安装库依赖，加载库依赖(安装一个，加载一个)
    let lib = 'xxxxx';
    this.uiService.updateState({ state: 'loading', text: '正在安装' + lib });


    // 6. 加载项目目录中project.abi（这是blockly格式的json文本必须要先安装库才能加载这个json，因为其中可能会用到一些库）
    this.uiService.updateState({ state: 'done', text: '项目加载成功' });


    // 7. 检查开发板依赖（compiler、sdk、tool）是否安装，安装开发板依赖（开发板依赖要编译时才用到，用户可以先编程，开发板依赖在后台安装）
    let board = 'xxxxx';
    this.uiService.updateState({ state: 'loading', text: '正在安装' + board });


    // 8. 完成
    this.uiService.updateState({ state: 'done', text: board + '安装成功' });



    // const newResult = await window['project'].new(data);
    // if (!newResult.success) {
    //   console.error('new project failed: ', newResult);
    //   return false;
    // }

    // this.uiService.updateState({ state: 'done', text: '项目创建成功' });
    // const prjPath = newResult.data;

    // // 依赖安装
    // this.uiService.updateState({ state: 'loading', text: '依赖安装中...' });
    // await this.dependencies_install(`${prjPath}/package.json`);
    // this.uiService.updateState({ state: 'done', text: '依赖安装成功', timeout: 3000 });

    // // 发送项目更新
    // window['project'].update({ path: prjPath });

    // return prjPath;
  }

  // 保存项目
  projectSave() {
    // 导出blockly json配置并保存
  }

  // 打开项目
  async projectOpen(path) {
    this.uiService.updateState({ state: 'loading', text: '正在打开项目...' });
    // 0. 判断路径是否存在
    const pathExist = window['path'].isExists(path);
    if (!pathExist) {
      console.error('path not exist: ', path);
      return false;
    }

    // 1. 加载package.boardDependencies，检查开发板module是否存在, 不存在则安装


    // 3. 加载项目目录，打开blockly编辑器



    this.uiService.updateState({ state: 'loading', text: '项目加载中...' });

    // 读取package.json文件
    const packageJsonContent = window['file'].readSync(`${path}/package.json`);
    if (!packageJsonContent) {
      console.error('package.json not exist: ', path);
      return false;
    }
    this.projectData = JSON.parse(packageJsonContent);
    this.currentProject = path;

    // 设置项目路径到环境变量
    window["env"].set({ key: "AILY_PRJ_PATH", value: path });

    // 判断是否需要安装package.json依赖
    if (!window['path'].isExists(`${path}/node_modules`)) {
      await this.dependencies_install(`${path}/package.json`);
    }
    this.loaded.next(true);

    // 添加到最近打开的项目
    this.addRecentlyProjects({ name: this.projectData.name, path: path });

    // TODO 加载blockly组件
    this.uiService.updateState({ state: 'done', text: '项目加载成功', timeout: 3000 });

    // 后台加载板子依赖
    this.board_dependencies_install(`${path}/package.json`);
  }

  // 另存为项目
  projectSaveAs() { }

  // 读取package.json文件
  readPackageJson(path) {
    const packageJsonContent = window['file'].readSync(path);
    if (!packageJsonContent) {
      console.error('package.json not exist: ', path);
      return {};
    }

    return JSON.parse(packageJsonContent);
  }

  /**
   * 依赖安装
   * @param packageJsonPath 项目package.json文件路径
   * @returns 
   */
  async dependencies_install(packageJsonPath) {
    // 安装依赖
    await this.install_package({ file: packageJsonPath });
  }


  /**
   * 板子核心依赖安装
   * @param packageJsonPath 项目package.json文件路径
   * @returns 
   */
  async board_dependencies_install(packageJsonPath) {
    // 获取packageJson所在目录
    const path = packageJsonPath.substring(0, packageJsonPath.lastIndexOf('/'));

    const packageJsonContent = this.readPackageJson(packageJsonPath);
    if (!packageJsonContent) {
      console.error('package.json not exist: ', packageJsonPath);
      return false;
    }
    const boardDeps = Object.keys(packageJsonContent.dependencies || {}).filter(dep => dep.startsWith('@aily-project/board-'));
    for (const dep of boardDeps) {
      // 分解依赖项名称
      const depParts = dep.split('/');
      const depParent = depParts[0];
      const depName = depParts[1];

      const depPath = path + '/node_modules/' + depParent + '/' + depName;
      const pkgPackageJsonPath = depPath + '/package.json';

      // 读取板子的package.json文件
      const pkgPackageJsonContent = this.readPackageJson(pkgPackageJsonPath);
      if (!pkgPackageJsonContent) {
        console.error('package.json not exist: ', pkgPackageJsonPath);
        continue;
      }
      const boardDependencies = pkgPackageJsonContent.boardDependencies || {};

      console.log('boardDependencies: ', boardDependencies);

      for (const [depName, depVersion] of Object.entries(boardDependencies)) {
        const pkg = `${depName}@${depVersion}`;

        this.uiService.updateState({ state: 'loading', text: '安装依赖: ' + pkg });
        await this.install_package({
          package: pkg,
          global: true,
        });
      }
    }
    this.uiService.updateState({ state: 'done', text: '开发板依赖安装成功', timeout: 5000 });
  }

  // 安装依赖
  async install_package(data) {
    console.log("install Data: ", data);
    const installResult = await window['dependencies'].install(data);
    if (!installResult.success) {
      console.error('install failed: ', installResult);
      return false;
    }
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

  addRecentlyProjects(data: { name: string, path: string }) {
    let temp: any[] = this.recentlyProjects
    temp.unshift(data);
    temp = temp.filter((item, index) => {
      return temp.findIndex((item2) => item2.path === item.path) === index;
    });
    if (temp.length > 6) {
      temp.pop();
    }
    this.recentlyProjects = temp;
    console.log(temp);
    console.log(this.recentlyProjects);
  }

}
