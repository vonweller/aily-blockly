import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, lastValueFrom, Subject } from 'rxjs';
import * as Blockly from 'blockly';
import { processJsonVar } from './abf';

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

  codeSubject = new BehaviorSubject<string>('');

  // get boardConfig() {
  //   return 
  // }

  boardConfig;

  constructor(
    private http: HttpClient
  ) { }

  async init() {
    this.boardConfig = await lastValueFrom(this.http.get<any[]>('/board/arduino_uno/arduino_uno.json', { responseType: 'json' }))
  }

  async loadLibraries() {
    let coreLibraries = await lastValueFrom(this.http.get<any[]>('/arduino/core/core.json', { responseType: 'json' }))
    let otherLibraries = await lastValueFrom(this.http.get<any[]>('/arduino/libraries/libraries.json', { responseType: 'json' }))
    for (let index = 0; index < coreLibraries.length; index++) {
      const libName = coreLibraries[index];
      await this.loadLibrary(libName, 'core')
    }
    // core和第三方库之间加一个分割线
    // this.addToolboxSep();
    for (let index = 0; index < otherLibraries.length; index++) {
      const libName = otherLibraries[index];
      await this.loadLibrary(libName)
    }
  }

  async loadLibrary(libName: String, path: String = 'libraries') {
    let blocks = await lastValueFrom(this.http.get<LibData>(`/arduino/${path}/${libName}/block.json`, { responseType: 'json' }))
    if (blocks) this.loadLibBlocks(blocks)
    let toolbox = await lastValueFrom(this.http.get<Blockly.utils.toolbox.ToolboxDefinition>(`/arduino/${path}/${libName}/toolbox.json`, { responseType: 'json' }))
    if (toolbox) this.loadLibToolbox(toolbox)
    this.loadLibGenerator(`/arduino/${path}/${libName}/generator.js`)
  }

  loadLibBlocks(blocks) {
    for (let index = 0; index < blocks.length; index++) {
      let block = blocks[index];
      block = processJsonVar(block, this.boardConfig)
      Blockly.defineBlocksWithJsonArray([block])
      // processingJsonGenerator(block)
    }
  }

  addToolboxSep() {
    this.toolbox.contents.push({
      "kind": "sep",
      "cssConfig": {
        "container": "sepLine"
      }
    })
    this.workspace.updateToolbox(this.toolbox)
  }

  loadLibToolbox(toolboxItem) {
    this.toolbox.contents.push(toolboxItem)
    this.workspace.updateToolbox(this.toolbox)
  }

  loadLibGenerator(filePath) {
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

}

export interface LibData {
  name: string,
  blocks?: string
  generator?: string
  toolbox?: string,
  json?: any,
  show?: boolean
}

export interface LibDataBlock {
  inputsInline: boolean,
  message0?: string
  type?: string
  args0?: any,
  previousStatement?: any,
  nextStatement?: any,
  colour?: number,
  tooltip?: string,
  helpUrl?: string,
  generator: string
}

export interface LibDataGenerator {
  code: string,
  macros?: string
  libraries?: string
  variables?: string,
  objects?: string,
  functions?: string,
  setups?: string,
  userSetups?: string,
  loop?: string,
  userLoop?: string,
}


