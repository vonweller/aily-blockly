import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';
import { ResponseModel } from '../interfaces/response.interface';
import { API } from '../configs/api.config';

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

  appDataPath = window['path'].getAppDataPath();
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

  constructor(private http: HttpClient) {
    window['ipcRenderer'].on(
      'project-update',
      (event, newData: ProjectData) => {
        console.log('收到更新的 projectData: ', newData);
        this.projectData = newData;
        this.currentProject =
          this.projectData.path + '/' + this.projectData.name;
      },
    );
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
    const newResult = await window['project'].new(data);
    if (!newResult.success) {
      console.error('new project failed: ', newResult);
      return false;
    }
    console.log('new project success: ', newResult.data);

    window['project'].update({ data });
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
    const pathExist = window['path'].isExists(path);
    if (!pathExist) {
      console.error('path not exist: ', path);
      return false;
    }

    // 读取项目下得package.json
    const packageJsonPath = path + '/package.json';
    const packageJsonContent = window['file'].readSync(packageJsonPath);
    if (!packageJsonContent) {
      console.error('package.json not exist: ', packageJsonPath);
      return false;
    }

    this.projectData = JSON.parse(packageJsonContent);
    this.currentProject = path;

    // 判断项目目录下是否有node_modules
    const nodeModulesPath = this.currentProject + '/node_modules';
    const nodeModulesExist = window['path'].isExists(nodeModulesPath);
    if (!nodeModulesExist) {
      console.log('node_modules not exist, install dependencies');
      await this.project_install(this.currentProject, this.projectData.board);
    }
    this.loaded.next(true);
    return true;
  }

  // 另存为项目
  project_save_as() {}

  // 安装依赖
  async project_install(prjPath, board) {
    if (!board) {
      console.error('board is empty');
      return false;
    }

    // TODO 状态反馈
    const installResult = await window['package'].install({
      prjPath,
      package: board,
    });
    if (!installResult.success) {
      console.error('install failed: ', installResult);
      return false;
    }
  }
}
