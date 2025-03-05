import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class NpmService {
  constructor() { }


  // 指定获取packageName的可用版本列表
  async getPackageVersionList(packageName: string):Promise<any[]> {
    let PackageVersionList = await window['npm'].run({ cmd: `npm view ${packageName} versions --registry https://registry.openjumper.cn --json` })
    return PackageVersionList;
  }
}
