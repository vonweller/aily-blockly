import { Injectable } from '@angular/core';
import { PlatformService } from './platform.service';

/**
 * Aily Code 项目创建参数。
 * 只承载新建项目最小集合：名称 + 保存目录，避免与 blockly 的 NewProjectData 互相串味。
 */
export interface AilyCodeNewProjectData {
  /** 用户输入的项目名（允许中文等），最终作为目录名。空格会被替换为 `_`。 */
  name: string;
  /** 项目保存的父目录（绝对路径），最终目录 = path + name。 */
  path: string;
  /**
   * 来自 Blockly 新建向导的步骤数据：开发板 npm 包名、显示名、包版本与开发框架，
   * 用于预填 project.aci 的 target 字段（与纯名称+路径的快速创建兼容）。
   */
  wizardTarget?: {
    /** 开发板在 npm/registry 中的一级包名（如 esp32duino） */
    boardId: string;
    /** 向导中展示的开发板昵称，便于用户在 .aci 中辨识 */
    boardNickname: string;
    /** 所选板卡包的 semver / tag */
    boardPkgVersion: string;
    /** Blockly 侧的 devmode，如 arduino、micropython */
    framework: string;
  };
}

/**
 * 创建结果。
 * - ok=true 时返回最终项目根目录绝对路径，方便上层"在资源管理器打开"。
 * - ok=false 时返回错误原因，让上层决定提示文案。
 */
export interface AilyCodeNewProjectResult {
  ok: boolean;
  projectPath?: string;
  error?: string;
}

/**
 * AilyCodeProjectService
 * ---------------------------------------------
 * 专门用于按照 aily-code docs/aily-code最终目录与生命周期设计.md 第 3.1 节
 * 推荐的目录结构创建一个全新的 aily-code 项目骨架。
 *
 * 设计原则（与 blockly 项目创建严格独立）：
 *   1. 不依赖 ConfigService / NpmService / 任何板卡或模板下载逻辑；
 *   2. 不调用 projectService.projectOpen，避免触发 blockly 状态机；
 *   3. 仅依赖 PlatformService（路径分隔符）与 preload 暴露的 window['fs']、window['path']；
 *   4. 全部产物落地到用户选定的目录，绝不写入 AppData，便于团队协作 / Git 版本化。
 */
@Injectable({ providedIn: 'root' })
export class AilyCodeProjectService {

  constructor(private platformService: PlatformService) { }

  /**
   * 在 `data.path` 下创建以 `data.name` 命名的 aily-code 项目目录。
   * 整个流程是同步串行的：失败会立刻 reject，并尽可能保留已生成的中间文件以便人工排查。
   */
  async projectNew(data: AilyCodeNewProjectData): Promise<AilyCodeNewProjectResult> {
    try {
      const fs = window['fs'];
      const pathApi = window['path'];

      // 1. 入参校验：名称与父目录必须非空
      const rawName = String(data?.name ?? '').trim();
      const parentDir = String(data?.path ?? '').trim();
      if (!rawName) {
        return { ok: false, error: 'NAME_EMPTY' };
      }
      if (!parentDir) {
        return { ok: false, error: 'PATH_EMPTY' };
      }

      // 2. 规范化最终项目目录名：去空格，避免后续构建路径异常
      const safeName = rawName.replace(/\s+/g, '_');
      const projectPath = pathApi.join(parentDir, safeName);

      // 3. 同名目录已存在则直接拒绝，避免覆盖用户数据
      if (pathApi.isExists(projectPath)) {
        return { ok: false, error: 'PATH_EXISTS', projectPath };
      }

      // 4. 创建目录骨架（递归 mkdir）
      this.ensureDirs(projectPath);

      // 5. 写入根目录文件（若向导传入板卡上下文则带进 project.aci）
      const wizardCtx = data.wizardTarget;
      this.writeRootFiles(projectPath, safeName, rawName, wizardCtx);

      // 6. 写入 .aily/state 下的初始状态文件
      this.writeAilyStateFiles(projectPath);

      return { ok: true, projectPath };
    } catch (error: any) {
      console.error('[AilyCodeProjectService] projectNew 失败:', error);
      return { ok: false, error: error?.message || 'UNKNOWN' };
    }
  }

  /**
   * 仅负责递归 mkdir 项目骨架目录。
   * 顺序无要求，但分组列出来便于和 docs 第 3.1 节对齐审计。
   */
  private ensureDirs(root: string): void {
    const fs = window['fs'];
    const pathApi = window['path'];
    const join = (...parts: string[]) => pathApi.join(...parts);

    // 用户可见目录
    const userDirs = [
      root,
      join(root, 'src'),
      join(root, 'components'),
      join(root, 'include'),
      join(root, 'assets'),
      join(root, 'scripts'),
    ];

    // 隐藏工作区（.aily），所有内容应可重建
    const ailyDirs = [
      join(root, '.aily'),
      join(root, '.aily', 'generated'),
      join(root, '.aily', 'generated', 'cpp'),
      join(root, '.aily', 'generated', 'headers'),
      join(root, '.aily', 'bridge'),
      join(root, '.aily', 'bridge', 'xpm'),
      join(root, '.aily', 'bridge', 'xpm', 'xpacks'),
      join(root, '.aily', 'bridge', 'cmake'),
      join(root, '.aily', 'build'),
      join(root, '.aily', 'build', 'debug'),
      join(root, '.aily', 'build', 'release'),
      join(root, '.aily', 'build', 'simulator'),
      join(root, '.aily', 'cache'),
      join(root, '.aily', 'cache', 'index'),
      join(root, '.aily', 'cache', 'downloads'),
      join(root, '.aily', 'cache', 'fingerprints'),
      join(root, '.aily', 'logs'),
      join(root, '.aily', 'state'),
    ];

    for (const dir of [...userDirs, ...ailyDirs]) {
      // mkdirSync 已是 recursive，重复存在不会抛错
      fs.mkdirSync(dir);
    }

    // 空目录用 .gitkeep 占位，方便后续 Git 化
    // const gitkeepDirs = [
    //   join(root, 'components'),
    //   join(root, 'include'),
    //   join(root, 'assets'),
    //   join(root, 'scripts'),
    // ];
    // for (const dir of gitkeepDirs) {
    //   fs.writeFileSync(join(dir, '.gitkeep'), '');
    // }
  }

  /**
   * 根目录用户可见文件：project.aci / aily.lock.json / package.json / README.md / .gitignore / src/main.cpp。
   * `.aily/generated/source-map.json` 等基础桥接占位也一并写入。
   */
  private writeRootFiles(
    root: string,
    safeName: string,
    displayName: string,
    wizardTarget?: AilyCodeNewProjectData['wizardTarget']
  ): void {
    const fs = window['fs'];
    const pathApi = window['path'];

    // Blockly 向导：把用户选的板卡/npm 版本映射到 target，便于 IDE 后续解析
    const hasWizard = !!(wizardTarget?.boardId && wizardTarget.boardPkgVersion);
    const targetBlock = hasWizard
      ? {
          board: wizardTarget!.boardId,
          chip: '',
          framework: wizardTarget!.framework ?? '',
          sdk: wizardTarget!.boardPkgVersion
        }
      : {
          board: '',
          chip: '',
          framework: '',
          sdk: ''
        };

    const projectAci = {
      // 标识当前 .aci 文件的 schema，后续可由 IDE 校验
      $schema: 'https://aily.pro/schemas/project.aci.json',
      // 项目身份
      name: safeName,
      nickname: displayName,
      version: '0.0.1',
      description: hasWizard ? `Blockly 向导：${wizardTarget!.boardNickname || wizardTarget!.boardId}` : '',
      // 目标设备 / 框架：无向导时占位，可由后续板卡选择器写入
      target: targetBlock,
      // 入口与源码根，文档 4.3/4.4 中冻结的两条约定
      entry: 'src/main.cpp',
      sourceRoots: ['src', 'components', 'include'],
      // 构建 profile 列表，对应 .aily/build/<profile>
      buildProfiles: ['debug', 'release', 'simulator'],
      // 依赖与上传配置先留空，由后续编辑器/向导补充
      dependencies: {},
      upload: {},
      monitor: { baudRate: 115200 }
    };

    const ailyLock = {
      // 文档 4.2：解析结果快照，初始为空
      $schema: 'https://aily.pro/schemas/aily.lock.json',
      generatedAt: new Date().toISOString(),
      target: null,
      toolchains: [],
      packages: [],
      fingerprint: ''
    };

    // 根目录 package.json 仅作占位，不暴露 xpm 语义（详见 docs 9.1）
    const rootPackageJson = {
      name: safeName,
      version: '0.0.1',
      private: true,
      description: displayName
    };

    // .aily/bridge/xpm/package.json 才是真正的 xpm 入口（由 IDE 接管）
    const bridgePackageJson = {
      name: `${safeName}-xpm`,
      version: '0.0.1',
      private: true,
      xpack: {
        dependencies: {}
      }
    };

    const readme = [
      `# ${displayName}`,
      '',
      '> 由 Aily Blockly 创建的 Aily Code 项目骨架。',
      '',
      '## 目录说明',
      '',
      '- `project.aci`：项目唯一真相源，由 IDE 维护。',
      '- `src/main.cpp`：默认源码入口。',
      '- `components/`：项目本地可复用模块。',
      '- `include/`：公共头文件。',
      '- `assets/`：图片、字库、资源文件。',
      '- `scripts/`：项目级辅助脚本。',
      '- `.aily/`：IDE 隐藏工作区（构建/索引/缓存均可重建，已加入 .gitignore）。',
      ''
    ].join('\n');

    // 忽略所有生成物 / 桥接层 / 缓存，保持 Git 历史干净
    const gitignore = [
      '# Aily Code 隐藏工作区（全部可由 .aci 重建，禁止提交）',
      '.aily/',
      '',
      '# 常见系统/编辑器临时文件',
      '.DS_Store',
      'Thumbs.db',
      '*.log',
      ''
    ].join('\n');

    // 最小可编译的 C++ 占位入口（不依赖具体 framework）
    const mainCpp = [
      '// Aily Code 默认源码入口',
      '// 实际框架与运行逻辑由 project.aci 中的 target 配置驱动',
      '',
      'int main() {',
      '    return 0;',
      '}',
      ''
    ].join('\n');

    // source-map.json 桥接层占位：后续由 ShadowWorkspaceService 增量刷新
    const sourceMap = {
      version: 1,
      entries: []
    };

    const compileCommands: any[] = [];

    fs.writeFileSync(pathApi.join(root, 'project.aci'), JSON.stringify(projectAci, null, 2));
    fs.writeFileSync(pathApi.join(root, 'aily.lock.json'), JSON.stringify(ailyLock, null, 2));
    fs.writeFileSync(pathApi.join(root, 'package.json'), JSON.stringify(rootPackageJson, null, 2));
    fs.writeFileSync(pathApi.join(root, 'README.md'), readme);
    fs.writeFileSync(pathApi.join(root, '.gitignore'), gitignore);
    fs.writeFileSync(pathApi.join(root, 'src', 'main.cpp'), mainCpp);

    fs.writeFileSync(
      pathApi.join(root, '.aily', 'bridge', 'xpm', 'package.json'),
      JSON.stringify(bridgePackageJson, null, 2)
    );
    fs.writeFileSync(
      pathApi.join(root, '.aily', 'generated', 'source-map.json'),
      JSON.stringify(sourceMap, null, 2)
    );
    fs.writeFileSync(
      pathApi.join(root, '.aily', 'bridge', 'compile_commands.json'),
      JSON.stringify(compileCommands, null, 2)
    );
  }

  /**
   * 写入 .aily/state 下的三个状态文件（文档 3.1 节明确列出）。
   * 全部默认空骨架，由后续运行时增量更新。
   */
  private writeAilyStateFiles(root: string): void {
    const fs = window['fs'];
    const pathApi = window['path'];
    const stateDir = pathApi.join(root, '.aily', 'state');

    const workspace = {
      lastOpenedAt: new Date().toISOString(),
      stage: 'Draft' // 对应文档第 7 节的状态机
    };
    const deviceHistory = { ports: [], probes: [] };
    const lastSession = { openFiles: [], activeFile: '' };

    fs.writeFileSync(pathApi.join(stateDir, 'workspace.json'), JSON.stringify(workspace, null, 2));
    fs.writeFileSync(pathApi.join(stateDir, 'device-history.json'), JSON.stringify(deviceHistory, null, 2));
    fs.writeFileSync(pathApi.join(stateDir, 'last-session.json'), JSON.stringify(lastSession, null, 2));
  }

  /**
   * 生成形如 `aily_code_20251029a` 的默认项目名，避免和已有目录撞名。
   * 用法与 ProjectService.generateUniqueProjectName 等价，但不共享其内部状态。
   */
  generateUniqueProjectName(parentPath: string, prefix = 'aily_code_'): string {
    const pathApi = window['path'];
    const pt = this.platformService.getPlatformSeparator();
    const date = new Date();
    const baseDate = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const base = `${prefix}${baseDate}`;

    // a-z 后缀优先，撞了再使用数字
    for (let charCode = 97; charCode <= 122; charCode++) {
      const name = `${base}${String.fromCharCode(charCode)}`;
      if (!pathApi.isExists(parentPath + pt + name)) {
        return name;
      }
    }
    let i = 0;
    while (true) {
      const name = `${base}a${i}`;
      if (!pathApi.isExists(parentPath + pt + name)) return name;
      if (++i > 1000) return `${base}a${Date.now()}`;
    }
  }
}
