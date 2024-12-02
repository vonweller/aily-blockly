import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { APP } from '../configs/app.config';
import { lastValueFrom } from 'rxjs';
import * as Blockly from 'blockly';
import { processingJsonGenerator, processJsonVar } from './abf';

@Injectable({
  providedIn: 'root'
})
export class BlocklyService {

  workspace: Blockly.WorkspaceSvg;

  toolbox = {
    "kind": "categoryToolbox",
    "contents": [
    ]
  }

  constructor(
    private http: HttpClient
  ) { }

  async loadLibraries() {
    let coreLibraries = await lastValueFrom(this.http.get<any[]>('/arduino/core/core.json', { responseType: 'json' }))
    let otherLibraries = await lastValueFrom(this.http.get<any[]>('/arduino/libraries/libraries.json', { responseType: 'json' }))
    for (let index = 0; index < coreLibraries.length; index++) {
      const libName = coreLibraries[index];
      this.loadLibrary(libName, 'core')
    }
    for (let index = 0; index < otherLibraries.length; index++) {
      const libName = otherLibraries[index];
      this.loadLibrary(libName)
    }
  }

  loadLibrary(libName: String, path: String = 'libraries') {
    return new Promise(async (resolve, reject) => {
      try {
        let libData = await lastValueFrom(this.http.get<LibData>(`/arduino/${path}/${libName}/index.json`, { responseType: 'json' }))
        console.log(libData);

        // lib分三部分加载，json, generator, toolbox
        if (libData.block) await this.loadLibBlock(libData)
        if (libData.generator) await this.loadLibScript(libData.generator)
        if (libData.toolbox && libData.show) await this.loadLibToolbox(libData.toolbox)
        // resolve(true)

      } catch (error) {
        resolve(false)
      }
    })
  }

  async loadLibBlock(libData: LibData) {
    return new Promise(async (resolve, reject) => {
      let libJson = processJsonVar(libData)
      console.log(libJson);
      
      processingJsonGenerator(libJson, libData.name)
      resolve(true)
    })
  }

  loadLibScript(filePath) {
    return new Promise((resolve, reject) => {
      let script = document.createElement('script');
      script.type = 'text/javascript';
      script.src = filePath;
      script.onload = () => {
        resolve(true);
      };
      script.onerror = (error: any) => resolve(false);
      document.getElementsByTagName('head')[0].appendChild(script);
    })
  }

  async loadLibToolbox(libData) {
    return new Promise(async (resolve, reject) => {
      // this.loadUrl(path).subscribe(
      //   (config: any) => {
      //     // console.log(config);
      //     this.toolbox['contents'].push(config)
      //     resolve(true)
      //   },
      //   error => {
      //     resolve(false)
      //   })
    })
  }





}

export interface LibData {
  name: string,
  block?: string
  generator?: string
  toolbox?: string,
  json?: any,
  show?: boolean
}

