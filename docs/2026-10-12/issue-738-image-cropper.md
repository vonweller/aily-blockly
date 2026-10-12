# Issue #738 图片裁剪复现与修复

来源：[图片裁剪错误 #738](https://github.com/ailyProject/aily-blockly/issues/738)。反馈环境为 Windows 0.9.104-cn。本次于 2026-10-12 在主软件仓库 `aily--blockly` 的 macOS Electron 35.7.5 / 0.9.105 开发环境复现与验证，基线 HEAD 为 `0b161dffb`。复用已运行的 4200 热更新服务；测试使用隔离 AppData 和临时 Arduino UNO / u8g2 工程，不修改用户工程。

从图像积木的位图编辑器点击 Upload，选图并连续重选，未改源码时出现了与反馈一致的 `NaN × NaN`、空预览和 `drawImage` TypeError。运行时读回确认：图片元素上的实例 `ready=true`，组件保存的实例 `ready=false`，两者引用不相等；另一轮还观察到两个残留的裁剪容器。[修复前截图](issue-738/before.png)和[状态记录](issue-738/before-state.json)保留了证据（JSON 中 NaN 被序列化为 null）。

原因是模板 `[src]` 与延迟初始化中的 `image.src` 同时驱动加载，且 `onload` 在创建 Cropper 后未解除。重复加载会在同一元素上构造第二个 Cropper；Cropper 1.6.2 发现已有实例就提前返回，组件却保存了这个未就绪实例。之后 `getCropBoxData()` 返回空对象，尺寸成为 NaN，`getCroppedCanvas()` 返回 undefined，最终进入 `drawImage` 抛错。重选时未回收的 FileReader 和初始化定时器还会扩大这个竞态。

修复将图片源交给一个入口管理，使用一次性加载回调，移除两个 50ms 初始化定时器。重选和关闭时取消读图、预览定时器和转换 Worker，并用版本号丢弃迟到结果。转换前检查就绪状态、有效尺寸和裁剪画布；确认时清空待执行预览，立即转换最新选项，防止重复提交或旧转换关闭弹窗。重置恢复调用方请求的初始尺寸。预览防抖从 1000ms 调整为 120ms。

验证结果：

- ChromeHeadless 专项测试 9/9：重复 load、连续选图、迟到 FileReader、关闭销毁、损坏图片恢复、空画布、重置尺寸、确认与预览竞争、关闭后的迟到转换。
- 真实 Electron 完整流程通过：18 次有效选图，覆盖 PNG/JPEG/WebP、快速重选及相同文件重选；拖动裁剪框、滚轮缩放、重置、反色、抖动与阈值操作；立即确认、回填位图、保存并重新加载；损坏图片恢复及取消不覆盖原值。
- 保存重开后位图为 128×64，8192 个像素均为 1，与确认时的全黑测试图一致；没有回填初始空位图或先前反色预览。
- TypeScript 无输出类型检查及 `git diff --check` 通过。
- [修复后裁剪预览](issue-738/after.png)、[保存重开后的工程](issue-738/saved-bitmap.png)、[运行数据](issue-738/evidence.json)。运行时间是测试轮询观测值，包含文件加载与轮询开销，不作为跨平台性能承诺。

专项测试命令（仓库根目录）：

```sh
node scripts/run-angular.cjs test --watch=false --browsers=ChromeHeadless --ts-config=tsconfig.image-cropper.spec.json --include='src/app/editors/blockly-editor/components/blockly/components/image-upload-dialog/image-upload-dialog.component.spec.ts'
```

Electron 用例位于 `e2e/tests/image-cropper.spec.ts`，需要 `AILY_E2E_PROJECT` 指向已安装基础库的 Arduino 工程，`AILY_E2E_LIBRARIES` 指向库源码目录。用例复制所需资源到临时工程；可通过现有 `test:e2e` 入口选择此用例。本次执行使用临时 Playwright 配置复用 `http://127.0.0.1:4200`，没有新建热更新服务。

本次证据限于 macOS 开发 Electron，不代表 Windows 安装包已验收或已发布。隔离测试环境存在缺少 builder/linter/connector 的启动提示，不影响此次本地图片裁剪链。Issue 中 10 月 1 日的 Network Service 崩溃记录未作为本次裁剪错误的原因，也未宣称已修复该崩溃。
