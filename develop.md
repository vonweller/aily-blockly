# 开发人员须知  

## 软件框架
软件主体使用electron开发，渲染端使用angular开发  

## /child  
内为程序必须的组件：
1. node：程序使用npm和node进行包管理和执行必要脚本，该npm中添加了npmrc文件，用以指向到aily blockly仓库
2. 7za：为了减少部分包的大小，我们使用7z极限压缩来降低部分包（如编译器）的大小
3. arduino-cli：用于组织和编译arduino项目

## /build  
改部分是安装/卸载程序的脚本。
在安装应用时，安装程序会将`child\node-v9.11.2-win-x64.7z`解压到`child\node`。
