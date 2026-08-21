# Coder 项目创建与 sketch 工作区契约

> 当前实现基线：2026-08-20。

## 1. 新建项目

Blockly 与 Coder 共用 `boards.json`、主板搜索、版本选择和使用次数排序。新建表单只选择项目类型，不再选择 Coder 专用硬件平台。

- Blockly：复制所选 `@aily-project/board-*` 包的 `template/`。
- Coder：复制同一主板包的 `template-coder/`。

主板包必须提供：

```text
@aily-project/board-xxx/
├── template/
└── template-coder/
    ├── package.json
    └── project.aci
```

`template-coder/package.json` 与 `project.aci` 是框架、平台和基础依赖的真相源。模板可以直接带 `sketch/` 内容；若未带入口文件或 `libraries/`，宿主按 `project.aci.entry` 补齐最小目录。宿主只更新项目名称、所选主板包及版本，不再根据独立 Coder 索引合成 `coder-*` 包或硬件平台。缺少 `template-coder/package.json` 或 `project.aci` 时创建失败并提示模板缺失。

## 2. 创建后的目录

```text
project-root/
├── package.json
├── project.aci
├── sketch/                  # 持久化编译工作区
│   ├── src/                 # 直接编辑的源码
│   │   └── main.cpp
│   ├── libraries/           # 项目本地 Arduino 库及库物化结果
│   ├── build-config.json    # 构建时生成，可重建
│   ├── preprocess.json      # 预处理结果，可重建
│   ├── library-cache.json   # 库指纹缓存，可重建
│   └── upload-config.json   # 上传时生成，可重建
├── node_modules/
└── .build/                  # 编译产物
```

`project.aci.entry` 相对 `sketch/`，默认值仍为 `src/main.cpp`；磁盘文件因此是 `sketch/src/main.cpp`。

## 3. 编译与清理边界

Coder 的 preprocess、compile 和 upload 直接使用 `sketch/`，不再把根目录源码复制到 `.temp/sketch`。`sketch/src` 与 `sketch/libraries` 是项目内容，清缓存时必须保留；只清理 `.build` 和 `sketch` 下可重建的 JSON 配置/缓存。

Blockly 的 `.temp/sketch`、`.temp/libraries` 和 package 快照保持原行为。

## 4. 旧项目迁移

旧 Coder 项目需在打开新版前完成一次目录迁移：

1. 将根 `src/` 移到 `sketch/src/`。
2. 将根 `components/` 移到 `sketch/libraries/`。
3. 保持 `project.aci.entry` 为相对 `sketch/` 的值，例如 `src/main.cpp`。
4. 删除旧 Coder `.temp/` 后重新构建。

宿主不会自动删除或覆盖旧目录，避免在无法判断用户自有文件时做破坏性迁移。
