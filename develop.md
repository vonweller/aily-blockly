# 开发人员须知  

## 软件框架
软件主体使用electron开发，渲染端使用angular开发  

## /child目录
内为程序必须的组件：
1. node：程序使用npm和node进行包管理和执行必要脚本
2. 7za：为了减少部分包的大小，我们使用7z极限压缩来降低部分包（如编译器）的大小
3. arduino-cli：用于组织和编译arduino项目