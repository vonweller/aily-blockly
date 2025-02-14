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
  appDataPath = window['path'].getAppDataPath();
  projectData: ProjectData = {
    name: 'new project',
    path: '',
    author: '',
    description: '',
    board: '',
    type: 'web',
    framework: 'angular',
    version: '1.0.0',
  };

  currentProject: string;

  constructor(private http: HttpClient) {
    window['ipcRenderer'].on('project-update', (event, newData: ProjectData) => {
      console.log('收到更新的 projectData: ', newData);
      this.projectData = newData;
      this.currentProject = this.projectData.path + '/' + this.projectData.name;
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
    return window["path"].isExists(prjPath);
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

  // 保存项目
  project_save() {}

  // 打开项目
  project_open() {}

  // 另存为项目
  project_save_as() {}

  // 安装依赖
  async project_install(prjPath, board) {
    if (!board) {
      console.error('board is empty');
      return false;
    }

    // TODO 状态反馈
    const installResult = await window['package'].install({ prjPath, package: board });
    if (!installResult.success) {
      console.error('install failed: ', installResult);
      return false;
    }
  }
}
