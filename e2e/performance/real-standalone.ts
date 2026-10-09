import * as Blockly from 'blockly';
import 'blockly/blocks';
import * as pinyinPro from 'pinyin-pro';
import '../../src/app/editors/blockly-editor/components/blockly/blockly-native-registrations';
import '../../src/app/editors/blockly-editor/components/blockly/renderer/aily-thrasos/renderer';
import {DarkTheme} from '../../src/app/editors/blockly-editor/components/blockly/theme.config';
import {createProjectGenerator} from '../../src/app/editors/blockly-editor/services/blockly-generator-factory';
import {adaptArduinoTextLiterals} from '../../src/app/editors/blockly-editor/services/blockly-arduino-text-literals';
import {adaptBundledArduinoProcedureCalls} from '../../src/app/editors/blockly-editor/services/blockly-bundled-procedure-generator';
declare const AILY_RENDERER: boolean;
async function start() {
 const data=await (await fetch('capture.json')).json();
 const ws=Blockly.inject('workspace',{renderer:AILY_RENDERER?'aily-thrasos':'thrasos',theme:DarkTheme,
  media:'/media/',trashcan:true,sounds:false,zoom:{startScale:1,maxScale:1.5,minScale:0.5,scaleSpeed:1.05,wheel:true},
  grid:{spacing:20,length:2,colour:'#393939',snap:true},move:{scrollbars:true,drag:true,wheel:false}});
 const w=window as any;
 // Keep the independent engine on the native load path. Host-specific loading
 // optimizations are measured through the real host service by the runner.
 w.loadForBenchmark=(state: object)=>{
  Blockly.utils.dom.startTextWidthCache();
  try{Blockly.serialization.workspaces.load(state,ws);Blockly.renderManagement.triggerQueuedRenders(ws);}
  finally{Blockly.utils.dom.stopTextWidthCache();}
 };
 const B=Object.assign({},Blockly,{getMainWorkspace:()=>ws});
 Object.assign(w,{Blockly:B,blocklyWorkspace:ws,pinyinPro,global:window,__BLOCKLY_LIB_I18N__:{},__ailyBlockDefinitionsMap:new Map()});
 let generator:any;
 for(const step of data.steps){
  if(step.kind==='context'){
   if(!generator){generator=createProjectGenerator(step.mode);w.Arduino=generator;}
   Object.assign(Blockly.Msg,step.messages);w.boardConfig=step.boardConfig;w.packageJson=step.packageJson;
  }else if(step.kind==='messages')Object.assign(Blockly.Msg,step.value);
  else if(step.kind==='i18n')w.__BLOCKLY_LIB_I18N__[step.packageName]=step.value;
  else if(step.kind==='definitions'){
   for(const def of step.definitions){w.__ailyBlockDefinitionsMap.set(def.type,def.icon);delete Blockly.Blocks[def.type];}
   Blockly.defineBlocksWithJsonArray(step.definitions);
  }else if(step.kind==='script'){
   const s=document.createElement('script');s.textContent=step.source;document.head.appendChild(s);
   adaptArduinoTextLiterals(generator);adaptBundledArduinoProcedureCalls(generator);
  }else throw new Error(`Unknown replay step ${step.kind}`);
 }
 await new Promise(r=>setTimeout(r,100));
 const state=new URLSearchParams(location.search).get('topology')==='expanded'?await(await fetch('expanded.json')).json():data.state;
 const start=performance.now();Blockly.Events.disable();
 try{w.loadForBenchmark(state);}finally{Blockly.Events.enable();}
 const synchronousMs=performance.now()-start;
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 w.benchmarkLoaded={synchronousMs,paintedMs:performance.now()-start,count:ws.getAllBlocks(false).length};
 w.realCode=()=>generator.workspaceToCode(ws);
 document.querySelector('#status')!.textContent=`${ws.getAllBlocks(false).length} 个真实项目块 · ${Math.round(w.benchmarkLoaded.paintedMs)} ms`;
}
void start().catch(e=>{document.querySelector('#status')!.textContent=String(e);throw e;});
