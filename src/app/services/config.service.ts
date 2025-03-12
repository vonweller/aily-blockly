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
    this.data = await JSON.parse(window['file'].readFileSync(`${configFilePath}/config.json`));
  }

  async save() {
    let configFilePath = window['path'].getElectronPath();
    window['file'].writeFileSync(`${configFilePath}/config.json`, JSON.stringify(this.data, null, 2));
  }

  boardList;
  async loadBoardList() {
    this.boardList = await lastValueFrom(
      this.http.get('https://blockly.openjumper.cn/boards.json', {
        responseType: 'json',
      }),
    );
    return this.boardList;
  }

  libraryList;
  async loadLibraryList() {
    this.libraryList = await lastValueFrom(
      this.http.get('https://blockly.openjumper.cn/libraries.json', {
        responseType: 'json',
      }),
    );
    return this.libraryList;
  }
}

interface AppConfig {
  "lang": "zh_CN" | "en_US",
  "theme": "default" | "dark" | "light",
  // "font": "default",
  "project_path": "%HOMEPATH%\\Documents\\aily-project",
  "npm_registry": string[],
  "board_list": string[],
  "lib_list": string[],
  "compile": {
    "verbose": boolean,
    "warnings": "error" | "warning" | "none"
  },
  "upload": {
    "verbose": true,
    "warnings": "error" | "warning" | "none"
  }
}