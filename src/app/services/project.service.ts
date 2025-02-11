import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ResponseModel } from '../interfaces/response.interface';
import { API } from '../configs/api.config';

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  constructor(private http: HttpClient) {}

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
  project_new() {
    
  }

  // 保存项目
  project_save() {
    
  }

  // 打开项目
  project_open() {
    
  }

  // 另存为项目
  project_save_as() {
    
  }
}
