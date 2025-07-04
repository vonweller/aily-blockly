import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {

  boardList: any[] = [];
  toolList: any[] = [];
  sdkList: any[] = [];
  compilerList: any[] = [];

  constructor() { }

  async getToolList(prefix: string, registry: string) {
    const cmd = `npm search @aily-project/tool- --json=true --registry=${registry}`;
    const result = await window['npm'].run({ cmd });
    const allToolList = JSON.parse(result);

    const installedDict = await this.getInstalledDependencies(prefix);
    allToolList.forEach((tool) => {
      // 判断名称与版本是否对应
      if (installedDict[tool.name] && installedDict[tool.name].version === tool.version) {
        tool.installed = true;
      } else {
        tool.installed = false;
      }
    });

    console.log('allToolList: ', allToolList);
    this.toolList = allToolList;
  }

  async getSdkList(prefix: string, registry: string) {
    const cmd = `npm search @aily-project/sdk- --json=true --registry=${registry}`;
    const result = await window['npm'].run({ cmd });
    const allSdkList = JSON.parse(result);

    const installedDict = await this.getInstalledDependencies(prefix);
    allSdkList.forEach((sdk) => {
      // 判断名称与版本是否对应
      if (installedDict[sdk.name] && installedDict[sdk.name].version === sdk.version) {
        sdk.installed = true;
      } else {
        sdk.installed = false;
      }
    });
    this.sdkList = allSdkList;

    // console.log('sdkList: ', this.sdkList);
  }

  async getCompilerList(prefix: string, registry: string) {
    const cmd = `npm search @aily-project/compiler- --json=true --registry=${registry}`;
    const result = await window['npm'].run({ cmd });
    const allCompilerList = JSON.parse(result);

    const installedDict = await this.getInstalledDependencies(prefix);
    allCompilerList.forEach((compiler) => {
      // 判断名称与版本是否对应
      if (installedDict[compiler.name] && installedDict[compiler.name].version === compiler.version) {
        compiler.installed = true;
      } else {
        compiler.installed = false;
      }
    });
    this.compilerList = allCompilerList;

    // console.log('compilerList: ', this.compilerList);
  }

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

  async install(lib) {
    // 根据board对象的name来判断是工具还是sdk还是compiler-
    let action = '';
    if (lib.name.startsWith('@aily-project/tool-')) {
      action = 'install-tool';
    } else if (lib.name.startsWith('@aily-project/sdk-')) {
      action = 'install-sdk';
    } else if (lib.name.startsWith('@aily-project/compiler-')) {
      action = 'install-compiler';
    }
    const result = await window['iWindow'].send({
      to: "main",
      timeout: 1000 * 60 * 5,
      data: {
        action: 'npm-exec',
        detail: {
          action: action,
          data: JSON.stringify(lib)
        }
      }
    })

    console.log("install result: ", result);
    return result;
  }

  async uninstall(lib) {
    // 根据board对象的name来判断是工具还是sdk还是compiler-
    let action = '';
    if (lib.name.startsWith('@aily-project/tool-')) {
      action = 'uninstall-tool';
    } else if (lib.name.startsWith('@aily-project/sdk-')) {
      action = 'uninstall-sdk';
    } else if (lib.name.startsWith('@aily-project/compiler-')) {
      action = 'uninstall-compiler';
    }

    const result = await window['iWindow'].send({
      to: "main",
      timeout: 1000 * 60 * 5,
      data: {
        action: 'npm-exec',
        detail: {
          action: action,
          data: JSON.stringify(lib)
        }
      }
    })

    console.log("uninstall result: ", result);
    return result;
  }
}
