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
    private uiService: UiService
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
    this.uiService.stateSubject.next({ text: '正在创建项目...' });
    const newResult = await window['project'].new(data);
    if (!newResult.success) {
      console.error('new project failed: ', newResult);
      return false;
    }
    this.uiService.stateSubject.next({ text: '项目创建成功' });
    const prjPath = newResult.data;

    // 依赖安装
    this.uiService.stateSubject.next({ text: '依赖安装中...' });
    await this.dependencies_install(`${prjPath}/package.json`);
    this.uiService.stateSubject.next({ text: '依赖安装成功', timeout: 3000 });

    // 发送项目更新
    window['project'].update({ path: prjPath });

    return prjPath;
  }

  // 保存项目
  project_save() {
    // 导出blockly json配置并保存
  }

  // 打开项目
  async project_open(path) {
    this.uiService.stateSubject.next({ text: '正在打开项目...' });
    // 判断路径是否存在
    const pathExist = window['path'].isExists(path);
    if (!pathExist) {
      console.error('path not exist: ', path);
      return false;
    }
    this.uiService.stateSubject.next({ text: '项目加载中...' });

    // 读取package.json文件
    const packageJsonContent = window['file'].readSync(`${path}/package.json`);
    if (!packageJsonContent) {
      console.error('package.json not exist: ', path);
      return false;
    }
    this.projectData = JSON.parse(packageJsonContent);
    this.currentProject = path;

    // 设置项目路径到环境变量
    window["env"].set({key: "AILY_PRJ_PATH", value: path});

    // 判断是否需要安装package.json依赖
    if (!window['path'].isExists(`${path}/node_modules`)) {
      await this.dependencies_install(`${path}/package.json`);
    }
    this.loaded.next(true);

    // TODO 加载blockly组件

    this.uiService.stateSubject.next({ text: '项目加载成功', timeout: 3000 });

    // 后台加载板子依赖
    this.board_dependencies_install(`${path}/package.json`);
  }

  // 另存为项目
  project_save_as() { }

  // 读取package.json文件
  read_package_json(path) {
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

    const packageJsonContent = this.read_package_json(packageJsonPath);
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
      const pkgPackageJsonContent = this.read_package_json(pkgPackageJsonPath);
      if (!pkgPackageJsonContent) {
        console.error('package.json not exist: ', pkgPackageJsonPath);
        continue;
      }
      const boardDependencies = pkgPackageJsonContent.boardDependencies || {};

      console.log('boardDependencies: ', boardDependencies);

      for (const [depName, depVersion] of Object.entries(boardDependencies)) {
        const pkg = `${depName}@${depVersion}`;

        this.uiService.stateSubject.next({ state: 'loading', text: '安装依赖: ' + pkg });
        await this.install_package({
          package: pkg,
          global: true,
        });
      }
    }
    this.uiService.stateSubject.next({ state: 'done', text: '开发板依赖安装成功', timeout: 5000 });
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
}
