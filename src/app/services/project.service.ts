import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';
import { ResponseModel } from '../interfaces/response.interface';
import { API } from '../configs/api.config';
import { UiService } from './ui.service';

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
    private uiService: UiService,
  ) {
    window['ipcRenderer'].on('project-update', (event, data) => {
      console.log('收到更新的: ', data);
      this.currentProject = data.path;
      this.project_open(this.currentProject);
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

  async project_exist(data) {
    const prjPath = data.path + '/' + data.name;
    return window['path'].isExists(prjPath);
  }

  // 新建项目
  async project_new(data) {
    this.uiService.stateSubject.next({text: '正在创建项目...'});
    const newResult = await window['project'].new(data);
    if (!newResult.success) {
      console.error('new project failed: ', newResult);
      return false;
    }
    console.log('new project success: ', newResult.data);
    this.uiService.stateSubject.next({text: '项目创建成功', timeout: 3000});
    return true;
  }

  // project_new() {

  //   //  调用cli创建项目

  //   //  加载项目package.json文件
  //   this.projectData = {
  //     name: '新的项目',
  //     version: '1.0.0',
  //     author: 'coloz',
  //     description: 'aily project',
  //   };

  //   // 安装依赖

  //   // 加载blockly组件
  // }

  // 保存项目
  project_save() {
    // 导出blockly json配置并保存
  }

  // 打开项目
  async project_open(path) {
    this.uiService.stateSubject.next({text: '正在打开项目...'});
    // 判断路径是否存在
    const pathExist = window['path'].isExists(path);
    if (!pathExist) {
      console.error('path not exist: ', path);
      return false;
    }

    this.uiService.stateSubject.next({text: '依赖安装中...'});
    // 读取项目下得package.json
    const packageJsonPath = path + '/package.json';

    const packageJsonContent = window['file'].readSync(packageJsonPath);
    if (!packageJsonContent) {
      console.error('package.json not exist: ', packageJsonPath);
      return false;
    }

    this.projectData = JSON.parse(packageJsonContent);
    this.currentProject = path;

    console.log("prjData: ", this.projectData);

    // 安装依赖
    await this.dependencies_install({ file: packageJsonPath });

    // 安装子依赖项
    const pkgData = JSON.parse(packageJsonContent);
    const boardDeps = Object.keys(pkgData.dependencies || {}).filter(dep => dep.startsWith('@aily-project/board-'));
    for (const dep of boardDeps) {
      // 分解依赖项名称
      const depParts = dep.split('/');
      const depParent = depParts[0];
      const depName = depParts[1];

      this.uiService.stateSubject.next({text: '安装依赖: ' + dep});

      const depPath = path + '/node_modules/' + depParent + '/' + depName;
      const pkgPackageJsonPath = depPath + '/package.json';

      // 读取板子的package.json文件
      const pkgPackageJson = window['file'].readSync(pkgPackageJsonPath);
      if (!pkgPackageJson) {
        console.error('package.json not exist: ', pkgPackageJsonPath);
        return false;
      }

      const pkgPackageJsonContent = JSON.parse(pkgPackageJson);
      const boardDependencies = pkgPackageJsonContent.boardDependencies || {};

      console.log('boardDependencies: ', boardDependencies);

      for (const [depName, depVersion] of Object.entries(boardDependencies)) {
        const pkg = `${depName}@${depVersion}`;
        await this.dependencies_install({
          package: pkg,
          global: true,
        });
      }
    }

    this.uiService.stateSubject.next({text: '项目加载中...'});
    // TODO 加载blockly组件
    setTimeout(() => {
      this.uiService.stateSubject.next({text: '项目加载成功', timeout: 3000});
      this.loaded.next(true);
    }, 1000);
    return true;
  }

  // 另存为项目
  project_save_as() {}

  // 安装依赖
  async dependencies_install(data) {
    // TODO 状态反馈
    console.log("install Data: ", data);
    const installResult = await window['dependencies'].install(data);
    if (!installResult.success) {
      console.error('install failed: ', installResult);
      return false;
    }
  }
}
