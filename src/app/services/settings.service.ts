import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {

  boardList: any[] = [];

  constructor() { }

  async getBoardList(prefix: string, registry: string) {
    const allBoardList = await this.getAllBoardList(registry);
    const installedDict = await this.getInstalledDependencies(prefix);
    allBoardList.forEach((board) => {
      // 判断名称与版本是否对应
      if (installedDict[board.name] && installedDict[board.name].version === board.version) {
        board.installed = true;
      } else {
        board.installed = false;
      }
    });
    this.boardList = allBoardList;

    // console.log('boardList: ', this.boardList);
  }

  async getAllBoardList(registry) {
    // 执行搜索时，配置的scope registry使用不到，需要在命令行中指定registry
    const cmd = `npm search @aily-project/board- --json=true --registry=${registry}`
    const result = await window['npm'].run({ cmd });
    const allBoardList = JSON.parse(result);
    // const allBoardList = await window['dependencies'].boardList();
    // console.log('allBoardList: ', allBoardList);
    return allBoardList;
  }

  // installed dependencies
  async getInstalledDependencies(prefix: string) {
    try {
      const cmd = `npm ls --json=true --depth=0 --prefix ${prefix}`;
      const result = await window['npm'].run({ cmd });
      const installedDict = JSON.parse(result);
      // console.log('allDependencies: ', installedDict);
      return installedDict["dependencies"] || {};
    } catch (error) {
      console.debug('getInstalledDependencies error: ', error);
      return {};
    }
  }

  async install(board) {
    const result = await window['iWindow'].send({
      to: "main",
      data: {
        action: 'npm-exec',
        detail: {
          action: 'install-board',
          data: JSON.stringify(board)
        }
      }
    })

    console.log("install result: ", result);
    return result;
  }

  async uninstall(board) {
    const result = await window['iWindow'].send({
      to: "main",
      data: {
        action: 'npm-exec',
        detail: {
          action: 'uninstall-board',
          data: JSON.stringify(board)
        }
      }
    })

    console.log("uninstall result: ", result);
    return result;
  }
}
