# AilyBlockly
灵感来自Github copilot  
## 关于本软件
aily Project是一个硬件开发集成环境，计划集成诸多AI能力，帮助硬件开发者更畅快的进行开发。  
aily Blockly是aily Project下的blockly IDE，前期面向非专业用户提供AI辅助编程能力，长远目标是打破专业开发和非专业开发的界限，最终实现自然语言编程。  

![Aily Blockly](./doc/img/sf.webp)

## 当前版本亮点  
1. 工程化项目管理（基本完成）
使用npm进行项目管理，做到以项目为单位进行开发板和库的管理。解决了诸多传统嵌入式开发环境的工程化不足的问题。如，使用Arduino IDE可能出现board package、库和当前项目不匹配，造成编译失败，运行错误的问题。在本软件上，各项目中的开发板版本和库版本是独立的，项目间互不影响。
2. 库管理器（基本完成）
虽然我们已经准备了很多库（几乎涵盖了常用模组），但实际上这些库都是AI生成的，我们没有经过详细验证。需要内测参与者和我们一道进行验证和完善。
3. 全能且小巧的串口调试工具（基本完成）
试图打造一个全能的串口工具，欢迎大家测试、反馈、提出新的想法。
4. AI开发板配置生成（完善中，预计4月下旬提供）
基于大模型的配置生成，添加开发板时不用再纯手写新配置，只用提供开发板文档（md格式），AI自动分析，帮你生成开发板配置文件。（仅支持esp32、avr、renesas、rp2040、stm32为核心的开发板，因为编译器和核心sdk，还是需要我们提前准备的到仓库的）
5. block配置生成（完善中，预计4月下旬提供）
基于大模型的配置生成，开发过程中，如果想使用arduino库，但没有对应的blockly库，只用将arduino库提供给AI，AI自动分析，生成对应的blockly库。借助该功能，本软件可以成为blockly最多的开发平台。

## 非正式版注意事项  
本次测试的alpha版本，仅保证最低限度的能用，很多计划的亮点功能还未完成设计和开发。
当前版本不建议实际用于工作，因为后期我们做出的诸多调整，可能会导致版本间的不兼容。

## 计划功能
· AI加持（项目模板生成、块/库生成、自动调试）    
· 多版本开发板、库共存管理  
· 硬件仿真  

## 文档
[使用文档](https://aily.pro/doc)  
[库适配文档](https://github.com/ailyProject/aily-blockly-libraries/blob/main/%E5%BA%93%E8%A7%84%E8%8C%83.md)  
[软件开发文档](./develop.md)  

## 相关仓库
[开发板](https://github.com/ailyProject/aily-blockly-boards)  
[block库](https://github.com/ailyProject/aily-blockly-libraries)  
[编译器](https://github.com/ailyProject/aily-blockly-compilers)  
[相关工具](https://github.com/ailyProject/aily-project-tools)  

## 项目赞助
本项目由以下企业和个人赞助

### 企业赞助  
<a target="_blank" href="https://www.seekfree.cn/" >
    <img src=".\brand\seekfree\logo.png" alt="seekfree" width=200 />
</a>  
<a target="_blank" href="https://www.seeedstudio.com/" >
    <img src=".\brand\seeedstudio\logo.png" alt="seeedstudio" width=200 />
</a>  
<a target="_blank" href="https://www.diandeng.tech/" >
    <img src=".\brand\diandeng\logo.png" alt="diandeng" width=200 />
</a>  
<a target="_blank" href="https://www.openjumper.com/" >
    <img src=".\brand\openjumper\logo.png" alt="openjumper" width=200 />
</a>  
<a target="_blank" href="https://www.titlab.cn/" >
    <img src=".\brand\titlab\logo.png" alt="titlab" width=200 />
</a>  
<a target="_blank" href="https://www.emakefun.com" >
    <img src=".\brand\emakefun\logo.png" alt="emakefun" width=200 />
</a>  
<a target="_blank" href="http://www.keyes-robot.com/" >
    <img src=".\brand\keyes\logo.png" alt="keyes" width=200 />
</a>  


### 个人赞助   


## 项目使用到的主要开源项目
[electron]()本项目使用electron构建桌面程序  
[angular]()本项目使用angular作为渲染端构建主要UI逻辑  
[node]()本项目使用npm和node进行包管理和执行必要脚本  
[7z]()本项目使用7z减小部分包的大小（如巨大的ESP32编译器）  
[arduino-cli]()本项目使用arduino cli构建arduino项目  
其他内容可见[package.json](./package.json)  

