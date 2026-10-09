# Blockly fork artifact

`aily-project-blockly-13.3.0-aily.5d59fc955336.tgz` 是 Aily 定制核心源码构建的 npm 发行包，
不是修改 `node_modules` 后复制的临时依赖。`package-lock.json` 固定其 SHA-512 integrity。

源码仓库：`aily-npm-blockly`；上游基线：
[Blockly 13.3.0](https://github.com/RaspberryPiFoundation/blockly/releases/tag/blockly-v13.3.0)。
具体补丁与构建入口见源码根目录 `AILY_FORK.md`。

本次额外修复使用原生 `moveBefore` 调整单个积木层级，保留旧浏览器回退；
隔离字段和气泡焦点样式，避免工作区焦点变化扫描隐藏函数；拖拽字段、图标样式
只匹配所属积木的直接子节点；HTML 尺寸重置排除深层 SVG，工作区及拖拽 SVG
显式保留原有尺寸规则。原有焦点类、键盘焦点、模型及事件契约保持兼容。
完整补丁见 `patches/blockly13-large-project.patch`，基于源码 `fbee0c44d`，
包含原发行包已有的大项目优化以及本次新增回归测试，对应核心提交 `2f7663280`。

更新本地发行包：

```sh
npm run blockly:sync -- /absolute/path/to/aily-npm-blockly
```

更新后必须同时提交 tarball、package.json、两份 lockfile 及 pnpm-workspace.yaml，
清理已替换的旧发行包，并运行完整回归。文件名包含内容哈希，避免同版本包缓存失效。
当前没有发布 npm；全新检出可通过 `npm ci` 直接安装本 tarball，无需邻接源码目录。
`blockly` 的 npm override 保证官方插件与 Aily 库共享同一核心实例。
颜色插件的间接依赖也锁定 13.3.0，避免 HSV 插件声明遗留范围引入 v12 插件。
