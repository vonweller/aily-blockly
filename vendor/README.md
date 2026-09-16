# Blockly fork artifact

`aily-project-blockly-13.3.0.tgz` 是 Aily 定制核心源码构建的 npm 发行包，
不是修改 `node_modules` 后复制的临时依赖。`package-lock.json` 固定其 SHA-512 integrity。

源码仓库：`aily-npm-blockly`；上游基线：
[Blockly 13.3.0](https://github.com/RaspberryPiFoundation/blockly/releases/tag/blockly-v13.3.0)。
具体补丁与构建入口见源码根目录 `AILY_FORK.md`。

更新本地发行包：

```sh
npm run blockly:sync -- /absolute/path/to/aily-npm-blockly
```

更新后必须同时提交 tarball、package.json、package-lock.json，并运行完整回归。
当前没有发布 npm；全新检出可通过 `npm ci` 直接安装本 tarball，无需邻接源码目录。
`blockly` 的 npm override 保证官方插件与 Aily 库共享同一核心实例。
颜色插件的间接依赖也锁定 13.3.0，避免 HSV 插件声明遗留范围引入 v12 插件。
