import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { lastValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ConfigService {

  data: AppConfig;

  constructor(private http: HttpClient) { }

  init() {
    this.load();
  }

  async load() {
    let configFilePath = window['path'].getElectronPath();
    this.data = await JSON.parse(window['fs'].readFileSync(`${configFilePath}/config.json`));
    // 添加当前系统类型到data中
    this.data["platform"] = window['platform'].type;
  }

  async save() {
    let configFilePath = window['path'].getElectronPath();
    window['fs'].writeFileSync(`${configFilePath}/config.json`, JSON.stringify(this.data, null, 2));
  }

  boardList;
  async loadBoardList() {
    this.boardList = await lastValueFrom(
      this.http.get(this.data.resource[0] + '/boards.json', {
        responseType: 'json',
      }),
    );
    return this.boardList;
  }

  libraryList;
  async loadLibraryList() {
    this.libraryList = await lastValueFrom(
      this.http.get(this.data.resource[0] + '/libraries.json', {
        responseType: 'json',
      }),
    );
    return this.libraryList;
  }
}

interface AppConfig {
  /** 语言设置，例如 "zh_CN" */
  lang: string;

  /** UI主题 */
  theme: string;

  /** 字体设置 */
  font: string;

  /** 系统类型 */
  platform: string;

  /** 项目数据默认路径 */
  appdata_path: {
    win32: string;
    darwin: string;
    linux: string;
  }

  /** 项目默认路径 */
  project_path: string;

  /** NPM 镜像源列表 */
  npm_registry: string[];

  /** 资源文件服务器列表 */
  resource: string[];

  /** 更新服务器列表 */
  updater: string[];

  /** 编译选项 */
  compile: {
    /** 是否显示详细日志 */
    verbose: boolean;
    /** 警告处理方式，如 "error" 表示将警告视为错误 */
    warnings: string;
  };

  /** 上传选项 */
  upload: {
    /** 是否显示详细日志 */
    verbose: boolean;
    /** 警告处理方式 */
    warnings: string;
  };

  devmode: boolean;
}