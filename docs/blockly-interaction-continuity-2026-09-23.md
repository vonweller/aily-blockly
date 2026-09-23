# Blockly 1.0.2 交互连续性修复

## 范围与根因

主软件保留 `blockly: npm:aily-project-blockly@^1.0.2`，实装版本 `1.0.2`；未升级至 13，未修改 Blockly 包、锁文件或 Coder 分支。

原来组件在变更后防抖 500 ms 调用 `runWithPreparedProjectCode()`。该入口获取独占工作区编辑锁时，会执行 `cancelCurrentGesture()`、`hideChaff()`、输入拦截及等待遮罩。后台任务恰好撞上下一次拖拽、字段编辑或注释输入，就会主动终止交互；只监听 drag start/end 无法覆盖这些情况。

## 实现

- 后台代码刷新使用单独的 `runWithBackgroundProjectCode()`，仍与保存/ABS 共用项目操作队列，但不获取编辑锁，不取消手势、不关闭编辑器。
- 在排队执行、异步资源准备及发布前后校验项目、页面、运行时与内容版本；过期结果返回重试信号，真实生成错误仍上报。
- 统一读取当前手势、WidgetDiv、DropDownDiv 和 DOM 编辑焦点。拖拽、字段编辑、下拉、注释、可编辑文本及输入法组合输入期间推迟后台生成和小地图同步。
- 防抖任务合并；一次只运行一个后台生成任务，仅有待处理变更时重试。离开编辑态后恢复刷新，不永久暂停后台。
- 显式保存、编译及 ABS/AI 修改的事务保护不变。注释仍参与生成，不能当作无关 UI 事件丢弃。

## 验证方法

```sh
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit
./node_modules/.bin/ng test --configuration=blockly-performance --watch=false --browsers=ChromeHeadless
AILY_E2E_PROJECT=/path/to/installed/project ./node_modules/.bin/playwright test e2e/tests/blockly-interaction-continuity.spec.ts --reporter=line --repeat-each=2
git diff --check
```

定向单元测试 38 项通过，覆盖交互态、异步期间继续编辑、运行时替换、过期结果重试、真实错误保留及原有显式编辑锁边界。类型检查、生产构建和差异格式检查通过。

Electron 用例使用生产构建和真实编辑器/生成器，在工程副本中加入三个小型测试块。用户原工程、活动窗口及配置不作测试写入；复制时排除工程实例锁，关闭测试进程后清理副本。

用例覆盖：

1. 从连接栈拆出积木，持续按住 1300 ms；随后切换另一块拖拽 1300 ms，再次拖回 700 ms。
2. 文本编辑停留 1200 ms、组合输入事件停留 900 ms、数字输入停留 900 ms，保持焦点。
3. 下拉打开停留 1200 ms 后选择另一选项。
4. 注释输入停留 1500 ms，保持焦点；上述连续编辑期间后台不生成。
5. 注释失焦后恢复后台生成，生成结果包含最新文本、数字、下拉值和注释。
6. 再次编辑注释，未失焦时调用真实保存入口，后读 `project.abi` 确认最后输入已保存。

最终 Electron 回归连续重复两次，结果 `2 passed (52.3s)`，两次均无正在拖拽时被取消的记录。已检查最终注释保持焦点的截图。

运行环境：macOS、Electron 35.7.5、实装 aily-project-blockly 1.0.2；截图 3024×1768（逻辑窗口 1512×884）。截图与结构化附件由 Playwright 写入 `test-results` / `playwright-report`，不纳入源码提交。

## 验收边界

- 组合输入使用确定性 composition 事件，不等同于 macOS/Windows 系统输入法候选窗实测；触屏、笔输入、第三方自定义弹层也未逐个验收。
- 本轮是交互连续性修复，不代表万级积木拖拽性能验收；生成器自身的同步长任务仍属于独立性能问题。
- 构建保留既有 mermaid/fastdom CommonJS 警告。隔离 Electron 的空工具目录触发依赖下载，退出测试时出现取消下载日志；没有据此声称硬件编译/上传通过。
- 未提交、推送、发布 npm 包或替换已安装的发行版。
