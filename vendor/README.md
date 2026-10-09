# Blockly fork artifact

当前依赖 `aily-project-blockly-13.3.0-aily.9691554019cf.tgz` 是 Aily 定制核心源码构建的 npm 发行包，
对应 `aily-npm-blockly` 提交 `154bdcad7`，无需邻接源码目录或 npm link 即可安装。
`package-lock.json`、`pnpm-lock.yaml` 固定其 integrity，pnpm override 保证主程序和插件共用一份核心。

该包包含浅层 SVG 视口渲染，以及大项目加载和深层字段编辑优化。
构建入口见源码 `AILY_FORK.md`；实际 Electron 性能、功能和安装包验证见
[性能报告](../docs/blockly-causal-performance-2026-10-09.md)。上游基线为
[Blockly 13.3.0](https://github.com/RaspberryPiFoundation/blockly/releases/tag/blockly-v13.3.0)。
`patches/blockly13-large-project.patch` 是旧版本补丁快照，当前完整实现以源码提交为准。

更新本地发行包：

```sh
npm run blockly:sync -- /absolute/path/to/aily-npm-blockly
# pnpm 调用时直接传路径，不额外传 --：
pnpm run blockly:sync /absolute/path/to/aily-npm-blockly
```

更新后同时提交 tarball、package.json、两份 lockfile 及 pnpm-workspace.yaml，并验证实际安装目录。
文件名包含内容哈希，避免同版本包缓存失效。颜色插件的间接依赖也锁定 13.3.0，避免引入 v12。

串口库的定时刷新修复在独立 `aily-blockly-libraries` 提交 `97250664`。
旧项目若仍安装旧 `lib-core-serial`，需要同步升级该库；仅替换 Blockly 核心不会替换项目依赖。
本仓库没有代为发布 npm，也不在加载项目时偷偷改写其库代码。
