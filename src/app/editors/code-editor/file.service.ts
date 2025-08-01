import { Injectable } from '@angular/core';
import { NzTreeNodeOptions } from 'ng-zorro-antd/tree';

@Injectable({
  providedIn: 'root'
})
export class FileService {

  currentPath;

  constructor() { }


  readDir(path: string): NzTreeNodeOptions[] {
    let entries = window['fs'].readDirSync(path);
    let result = [];
    let dirs = [];
    let files = [];
    for (const entry of entries) {
      let path = entry.path + '\\' + entry.name;
      let isDir = window['path'].isDir(path)
      let item: NzTreeNodeOptions = {
        title: entry.name,
        key: path,
        path,
        isLeaf: !isDir,
        expanded: false,
        selectable: true
      }
      if (isDir) {
        dirs.push(item);
      } else {
        files.push(item);
      }
    }
    result = dirs.concat(files);
    return result;
  }

  readFile(path: string): string {
    this.currentPath = path;
    // 读取文件内容
    return '';

  }
}