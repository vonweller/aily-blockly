# AilyBlockly
灵感来自Github copilot  
## 关于本软件
aily Project是一个硬件开发集成环境，计划集成诸多AI能力，帮助硬件开发者更畅快的进行开发。  
aily Blockly是aily Project下的blockly IDE，前期面向非专业用户提供AI辅助编程能力，长远目标是打破专业开发和非专业开发的界限，最终实现自然语言编程。  

## 相关仓库
[开发板](https://github.com/ailyProject/aily-blockly-boards)  
[block库](https://github.com/ailyProject/aily-blockly-libraries)  
[编译器](https://github.com/ailyProject/aily-blockly-compilers)  
[相关工具](https://github.com/ailyProject/aily-project-tools)  

## 测试&&打包  

**库安装**
```
npm i
cd electron
npm i
```  

**浏览器运行**
```
npm run start
```
**浏览器打包**
```
npm run build
```
打包后生成路径为dist\aily-blockly\browser

**electron运行**
```
npm run electron
```

**electron打包(github action用)**
```
npm run electron:build
```
打包后生成路径为dist\aily-blockly\win-unpacked

**electron打包(本地用，设置了代理，避免资源拉取失败)**
```
npm run electron:build-local
```












## 项目赞助
本项目由以下企业和个人赞助

企业赞助
---
<div>
<a target="_blank" href="https://www.seekfree.cn/" style="height:80px; display: flex; align-items: center;">
    <img src=".\brand\seekfree\logo.png" alt="seekfree Logo" width=200 />
</a>
<a target="_blank" href="https://www.seeedstudio.com/" style="height:80px; display: flex; align-items: center;">
    <img src=".\brand\seeedstudio\logo.png" alt="seeedstudio Logo" width=200 />
</a>
<a target="_blank" href="https://www.diandeng.tech/" style="height:80px; display: flex; align-items: center;">
    <img src=".\brand\diandeng\logo.png" alt="diandeng Logo" width=200 />
</a>
<a target="_blank" href="https://www.openjumper.com/" style="height:80px; display: flex; align-items: center;">
    <img src=".\brand\openjumper\logo.png" alt="openjumper Logo" width=200 />
</a>
<a target="_blank" href="https://www.titlab.cn/" style="height:80px; display: flex; align-items: center;">
    <img src=".\brand\titlab\logo.png" alt="titlab Logo" width=200 />
</a>
<a target="_blank" href="" style="height:80px; display: flex; align-items: center;">
    <img src=".\brand\keyesrobot\logo.png" alt="keyesrobot Logo" width=200 />
</a>
<a target="_blank" href="" style="height:80px; display: flex; align-items: center;">
    <img src=".\brand\nulllab\logo.png" alt="nulllab Logo" width=200 />
</a>
</div>
个人赞助
---

