/**
 * Aily Skill Registry - 技能注册中心
 *
 * 单例模式，管理所有已发现的 Skills。
 * 职责：发现、解析、加载、搜索 Skills。
 *
 * 扫描来源（按优先级从低到高，同名后者覆盖前者）：
 * 0. Builtin Skills: ${rendererPath}/skills/          (随应用安装包分发，public/skills/)
 * 1. Global Skills:  ${AppDataPath}/aily-skills/      (用户全局自定义)
 * 2. Claude Global:  ${userHome}/.claude/skills/      (Claude 全局 skills)
 * 3. Project Skills: ${projectRoot}/.aily/skills/     (项目专属)
 * 4. Workspace GH:   ${projectRoot}/.github/skills/   (VS Code/Copilot workspace root)
 * 5. Cross-client:   ${projectRoot}/.agents/skills/   (规范推荐，跨客户端)
 * 6. Claude Project: ${projectRoot}/.claude/skills/   (Claude 项目 skills)
 */

import {
  IAilySkill, SkillMetadata, SkillOrigin,
  SkillSearchResult,
  type SkillContextMode,
  type SkillInvocationContext,
  type SkillRelatedFile,
  type LoadedSkillSummary,
} from './skill-types';
import { AilyHost } from './host';

const MAX_SKILL_RELATED_FILES = 50;
const MAX_SKILL_RELATED_DEPTH = 5;
const SKILL_DISCOVERY_REFRESH_DEBOUNCE_MS = 100;
const IGNORED_SKILL_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.cache',
  'coverage',
]);

interface SkillRegistryInitializeOptions {
  readonly projectSkillFolders?: readonly string[];
  readonly userSkillFolders?: readonly string[];
}

// ============================
// YAML Frontmatter 解析
// ============================

/**
 * 从 SKILL.md 内容中解析 YAML frontmatter 和 body。
 * 格式: ---\nyaml\n---\nmarkdown body
 */
function parseSkillMd(raw: string): { metadata: SkillMetadata; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    // 无 frontmatter — 将整个内容作为 body, name 从文件夹推断
    return {
      metadata: { name: 'unknown', description: '' },
      body: raw,
    };
  }
  const yamlStr = match[1];
  const body = match[2];
  const metadata = parseSimpleYaml(yamlStr);
  return { metadata, body };
}

function normalizeSkillPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function trimQuotedValue(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function parseFrontmatterBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return undefined;
}

function parseFrontmatterList(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inlineItems = trimmed.slice(1, -1)
      .split(',')
      .map(item => trimQuotedValue(item))
      .filter(Boolean);
    return inlineItems.length > 0 ? inlineItems : undefined;
  }

  const items = trimmed
    .split(',')
    .map(item => trimQuotedValue(item))
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function parseSkillMode(value: string | undefined): SkillContextMode {
  return value?.trim().toLowerCase() === 'fork' ? 'fork' : 'inline';
}

/**
 * 轻量级 YAML 解析器 —— 支持 Agent Skills 规范的 frontmatter 格式。
 * 顶级字段：name, description, license, compatibility, allowed-tools
 * Aily 扩展字段：metadata 嵌套 map 下的 version, author, scope, agents, auto-activate, tags 等
 */
function parseSimpleYaml(yaml: string): SkillMetadata {
  const topLevel: Record<string, string> = {};
  const metadataMap: Record<string, string> = {};
  const lines = yaml.split(/\r?\n/);
  let inMetadata = false;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    if (inMetadata) {
      const nestedKv = line.match(/^  ([a-zA-Z_-]+)\s*:\s*(.*)/);
      if (nestedKv) {
        metadataMap[nestedKv[1].trim()] = nestedKv[2].trim().replace(/^['"]|['"]$/g, '');
        continue;
      }
      if (!line.startsWith(' ')) {
        inMetadata = false;
      } else {
        continue;
      }
    }

    const kvMatch = line.match(/^([a-zA-Z_-]+)\s*:\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const val = kvMatch[2].trim();
      if (key === 'metadata' && !val) {
        inMetadata = true;
        continue;
      }
      if (val) {
        topLevel[key] = trimQuotedValue(val);
      }
    }
  }

  const m = metadataMap;
  const parsedName = topLevel['name'] || 'unknown';
  const description = topLevel['description'] || '';
  const userInvocable = parseFrontmatterBoolean(topLevel['user-invokable'] ?? topLevel['userInvocable']);
  const disableModelInvocation = parseFrontmatterBoolean(topLevel['disable-model-invocation'] ?? topLevel['disableModelInvocation']);
  const targets = parseFrontmatterList(topLevel['target'] ?? topLevel['targets'] ?? topLevel['session-type'] ?? topLevel['sessionType']);
  const parseList = (s?: string) => parseFrontmatterList(s);

  return {
    name: parsedName,
    description,
    license: topLevel['license'],
    compatibility: topLevel['compatibility'],
    allowedTools: topLevel['allowed-tools'],
    metadata: Object.keys(m).length > 0 ? m : undefined,
    version: m['version'],
    scope: m['scope'] as any,
    agents: parseList(m['agents']),
    autoActivate: m['auto-activate'] === 'true',
    tags: parseList(m['tags']),
    author: m['author'],
    sourceUrl: m['source-url'],
    userInvocable,
    disableModelInvocation,
    context: parseSkillMode(topLevel['context']),
    targets,
  };
}

// ============================
// Registry 实现
// ============================

class SkillRegistryImpl {
  private skills = new Map<string, IAilySkill>();
  private _initialized = false;
  /** 会话级：Agent 主动激活的 skill 名称集合（通过 load_skill 加载，可通过 unload 卸载） */
  private _activatedSkills = new Set<string>();
  private readonly _changeListeners = new Set<() => void>();
  private _watchSubscriptions = new Map<string, { close?(): void; dispose?(): void; unsubscribe?(): void } | void>();
  private _watchedProjectRoot: string | undefined;
  private _initializationOptions: SkillRegistryInitializeOptions = {};
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;

  // ========== 初始化 ==========

  /**
   * 扫描所有来源的 Skills。
  * 扫描顺序：builtin → 全局 aily-skills → 全局 .claude/skills → 项目 .aily/skills/ → 项目 .github/skills/ → 项目 .agents/skills/ → 项目 .claude/skills/
   * 同名 skill 后扫描的覆盖先扫描的（项目级优先于全局优先于内置）。
   */
  async initialize(projectRoot?: string, options: SkillRegistryInitializeOptions = {}): Promise<void> {
    this._watchedProjectRoot = projectRoot;
    this._initializationOptions = this.normalizeInitializationOptions(options);
    this.skills.clear();

    const host = AilyHost.get();
    if (!host?.fs || !host?.path) {
      this.disposeDiscoveryWatchers();
      console.warn('[SkillRegistry] Host API 不可用，跳过 skill 发现');
      this._initialized = true;
      return;
    }

    // 0. 加载内置 skills（随安装包分发，优先级最低）
    const builtinDir = this.getBuiltinSkillsDir();
    if (builtinDir) {
      this.scanDirectory(builtinDir, { type: 'builtin' });
    }

    // 1. 加载全局 skills（用户在 AppData 下自定义的）
    const globalDir = this.getGlobalSkillsDir();
    if (globalDir) {
      this.scanDirectory(globalDir, { type: 'user' });
    }

    // 2. 加载 Claude 全局 skills（用户 home/.claude/skills）
    const claudeGlobalDir = this.getClaudeGlobalSkillsDir();
    if (claudeGlobalDir) {
      this.scanDirectory(claudeGlobalDir, { type: 'user' });
    }

    for (const userSkillDir of this.resolveConfiguredSkillDirectories(
      this._initializationOptions.userSkillFolders,
      'user',
      projectRoot,
      host,
    )) {
      this.scanDirectory(userSkillDir, { type: 'user' });
    }

    // 3. 加载项目 .aily/skills/
    if (projectRoot) {
      const ailySkillsDir = host.path.join(projectRoot, '.aily', 'skills');
      this.scanDirectory(ailySkillsDir, { type: 'project', projectRoot });
    }

    // 4. 加载项目 .github/skills/（VS Code/Copilot workspace skill root）
    if (projectRoot) {
      const githubSkillsDir = host.path.join(projectRoot, '.github', 'skills');
      this.scanDirectory(githubSkillsDir, { type: 'project', projectRoot });
    }

    // 5. 加载项目 .agents/skills/（Agent Skills 规范跨客户端互操作目录）
    if (projectRoot) {
      const agentsSkillsDir = host.path.join(projectRoot, '.agents', 'skills');
      this.scanDirectory(agentsSkillsDir, { type: 'project', projectRoot });
    }

    // 6. 加载项目 .claude/skills/（Claude Code skills 目录）
    if (projectRoot) {
      const claudeSkillsDir = host.path.join(projectRoot, '.claude', 'skills');
      this.scanDirectory(claudeSkillsDir, { type: 'project', projectRoot });
    }

    for (const projectSkillDir of this.resolveConfiguredSkillDirectories(
      this._initializationOptions.projectSkillFolders,
      'project',
      projectRoot,
      host,
    )) {
      this.scanDirectory(projectSkillDir, { type: 'project', projectRoot: projectRoot || projectSkillDir });
    }

    this.refreshDiscoveryWatchers(projectRoot, host);
    this._initialized = true;
    this.emitDidChange();
    console.log(`[SkillRegistry] 初始化完成, 发现 ${this.skills.size} 个 skills`);
  }

  get isInitialized(): boolean {
    return this._initialized;
  }

  // ========== 目录扫描 ==========

  private scanDirectory(dir: string, origin: SkillOrigin): void {
    const host = AilyHost.get();
    if (!host.fs.existsSync(dir)) return;

    try {
      const entries = host.fs.readdirSync(dir);
      for (const entry of entries) {
        const skillDir = host.path.join(dir, entry);
        // 跳过非目录
        try {
          if (!host.fs.isDirectory(skillDir)) continue;
        } catch {
          continue;
        }

        const skillMdPath = host.path.join(skillDir, 'SKILL.md');
        if (!host.fs.existsSync(skillMdPath)) continue;

        try {
          const raw = host.fs.readFileSync(skillMdPath, 'utf-8');
          const { metadata, body } = parseSkillMd(raw);
          const parsedName = metadata.name;
          metadata.displayName = parsedName && parsedName !== 'unknown' && parsedName !== entry
            ? parsedName
            : undefined;
          metadata.name = entry;

          const skill: IAilySkill = {
            metadata,
            folderPath: skillDir,
            baseDir: skillDir,
            skillMdPath,
            origin,
            // auto-activate skills 立即加载 body
            content: metadata.autoActivate ? body : undefined,
          };

          this.skills.set(metadata.name, skill);
        } catch (e) {
          console.warn(`[SkillRegistry] 解析 skill 失败: ${skillMdPath}`, e);
        }
      }
    } catch (e) {
      console.warn(`[SkillRegistry] 扫描目录失败: ${dir}`, e);
    }
  }

  // ========== 目录工具 ==========

  /**
   * 内置 skills 目录：
   * - 打包后：resources/app/electron/../renderer/skills/
   * - 开发模式回退：electron/../public/skills/
   */
  private getBuiltinSkillsDir(): string | null {
    const host = AilyHost.get();
    const electronPath = host.path?.getElectronPath?.();
    if (!electronPath) return null;

    const prodDir = host.path.join(electronPath, '..', 'renderer', 'skills');
    if (host.fs.existsSync(prodDir)) return prodDir;

    const devDir = host.path.join(electronPath, '..', 'public', 'skills');
    if (host.fs.existsSync(devDir)) return devDir;

    return null;
  }

  /** 全局 skills 目录：${appDataPath}/aily-skills/ */
  private getGlobalSkillsDir(): string | null {
    const host = AilyHost.get();
    const appDataPath = host.path?.getAppDataPath?.();
    if (!appDataPath) return null;
    return host.path.join(appDataPath, 'aily-skills');
  }

  /** Claude 全局 skills 目录：${userHome}/.claude/skills/ */
  private getClaudeGlobalSkillsDir(): string | null {
    const host = AilyHost.get();
    const userHome = host.path?.getUserHome?.();
    if (!userHome) return null;
    return host.path.join(userHome, '.claude', 'skills');
  }

  private normalizeInitializationOptions(options: SkillRegistryInitializeOptions | undefined): SkillRegistryInitializeOptions {
    return {
      userSkillFolders: this.normalizeConfiguredFolderEntries(options?.userSkillFolders),
      projectSkillFolders: this.normalizeConfiguredFolderEntries(options?.projectSkillFolders),
    };
  }

  private normalizeConfiguredFolderEntries(entries: readonly string[] | undefined): string[] {
    if (!Array.isArray(entries)) {
      return [];
    }

    return entries
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => entry.trim())
      .filter(entry => entry.length > 0);
  }

  private resolveConfiguredSkillDirectories(
    entries: readonly string[] | undefined,
    source: 'project' | 'user',
    projectRoot: string | undefined,
    host: ReturnType<typeof AilyHost.get>,
  ): string[] {
    const directories: string[] = [];
    const seen = new Set<string>();

    for (const entry of this.normalizeConfiguredFolderEntries(entries)) {
      const resolvedDirectory = this.resolveConfiguredSkillDirectory(entry, source, projectRoot, host);
      if (!resolvedDirectory) {
        continue;
      }

      const identity = this.normalizeWatchTargetIdentity(resolvedDirectory, host);
      if (!identity || seen.has(identity)) {
        continue;
      }

      seen.add(identity);
      directories.push(resolvedDirectory);
    }

    return directories;
  }

  private resolveConfiguredSkillDirectory(
    entry: string,
    source: 'project' | 'user',
    projectRoot: string | undefined,
    host: ReturnType<typeof AilyHost.get>,
  ): string | null {
    const normalizedEntry = entry.trim();
    if (!normalizedEntry) {
      return null;
    }

    const userHome = host.path?.getUserHome?.() || '';
    const basePath = source === 'user' ? userHome : projectRoot || '';

    if (normalizedEntry === '~') {
      return userHome || null;
    }

    if (/^~[\\/]/.test(normalizedEntry)) {
      if (!userHome) {
        return null;
      }

      return host.path.join(userHome, normalizedEntry.replace(/^~[\\/]/, ''));
    }

    if (host.path?.isAbsolute?.(normalizedEntry)) {
      return normalizedEntry;
    }

    if (!basePath) {
      return null;
    }

    return host.path.join(basePath, normalizedEntry);
  }

  // ========== Skill 加载 ==========

  /**
   * 加载 skill 的完整 body 内容（延迟加载）。
   * 首次加载后缓存在 skill.content 中。
   */
  loadSkillContent(name: string): string | null {
    const skill = this.skills.get(name);
    if (!skill) return null;

    if (skill.content !== undefined) return skill.content;

    // 从文件读取
    if (skill.folderPath) {
      try {
        const host = AilyHost.get();
        const raw = host.fs.readFileSync(skill.skillMdPath, 'utf-8');
        const { body } = parseSkillMd(raw);
        (skill as any).content = body;
        return body;
      } catch (e) {
        console.warn(`[SkillRegistry] 加载 skill 内容失败: ${skill.skillMdPath}`, e);
        return null;
      }
    }

    return null;
  }

  private isTrustedSkillSource(skill: IAilySkill | undefined | null): skill is IAilySkill {
    return !!skill && skill.origin.type !== 'url';
  }

  /**
   * 从 URL 直接加载 skill（不安装到磁盘，仅缓存在内存）。
   * 需要宿主环境提供 fetch 能力。
   */
  async loadFromUrl(url: string, fetchFn: (url: string) => Promise<string>): Promise<IAilySkill | null> {
    try {
      const raw = await fetchFn(url);
      const { metadata, body } = parseSkillMd(raw);

      const skill: IAilySkill = {
        metadata,
        folderPath: '',
        baseDir: '',
        skillMdPath: url,
        origin: { type: 'url', sourceUrl: url },
        content: body,
      };

      this.skills.set(metadata.name, skill);
      this.emitDidChange();
      return skill;
    } catch (e) {
      console.warn(`[SkillRegistry] 从 URL 加载 skill 失败: ${url}`, e);
      return null;
    }
  }

  private getSkillDisplayName(skill: IAilySkill): string {
    return skill.metadata.displayName || skill.metadata.name;
  }

  private getSkillMode(skill: IAilySkill): SkillContextMode {
    return skill.metadata.context || 'inline';
  }

  private getSkillRelatedFiles(skill: IAilySkill): SkillRelatedFile[] {
    if (!skill?.baseDir) return [];

    const host = AilyHost.get();
    if (!host?.fs) return [];

    const baseDir = skill.baseDir;
    const normalizedBaseDir = normalizeSkillPath(baseDir).replace(/\/+$/g, '');
    const relatedFiles: SkillRelatedFile[] = [];
    const visited = new Set<string>();

    const walk = (dirPath: string, depth: number): void => {
      if (depth > MAX_SKILL_RELATED_DEPTH || relatedFiles.length >= MAX_SKILL_RELATED_FILES) {
        return;
      }

      const normalizedDirPath = normalizeSkillPath(dirPath);
      if (visited.has(normalizedDirPath)) {
        return;
      }
      visited.add(normalizedDirPath);

      let entries: string[];
      try {
        entries = host.fs.readdirSync(dirPath);
      } catch {
        return;
      }

      for (const entry of entries) {
        if (relatedFiles.length >= MAX_SKILL_RELATED_FILES) {
          return;
        }

        const fullPath = host.path.join(dirPath, entry);
        let isDirectory = false;
        try {
          isDirectory = host.fs.isDirectory(fullPath);
        } catch {
          continue;
        }

        if (isDirectory) {
          if (IGNORED_SKILL_DIRECTORY_NAMES.has(entry.toLowerCase())) {
            continue;
          }
          walk(fullPath, depth + 1);
          continue;
        }

        const normalizedFullPath = normalizeSkillPath(fullPath);
        if (normalizedFullPath === normalizeSkillPath(skill.skillMdPath)) {
          continue;
        }

        if (!normalizedFullPath.startsWith(normalizedBaseDir)) {
          continue;
        }

        const relativePath = normalizedFullPath.slice(normalizedBaseDir.length).replace(/^\/+/, '');
        if (!relativePath) {
          continue;
        }

        const firstSegment = relativePath.split('/')[0]?.toLowerCase();
        const category = firstSegment === 'scripts'
          ? 'script'
          : firstSegment === 'references'
            ? 'reference'
            : firstSegment === 'assets'
              ? 'asset'
              : 'other';
        relatedFiles.push({
          path: relativePath,
          uri: normalizedFullPath,
          category,
        });
      }
    };

    walk(baseDir, 0);
    return relatedFiles.sort((left, right) => left.path.localeCompare(right.path));
  }

  /**
   * 列出 skill 目录下的附带资源文件（scripts/, references/, assets/）。
   * 保留给旧调用方；新路径应使用 getSkillContext()。
   */
  listSkillResources(name: string): string[] {
    const skill = this.skills.get(name);
    if (!skill) {
      return [];
    }

    return this.getSkillRelatedFiles(skill).map(file => file.path);
  }

  getSkillContext(name: string): SkillInvocationContext | null {
    const skill = this.skills.get(name);
    if (!this.isTrustedSkillSource(skill)) {
      return null;
    }

    const body = skill.content || this.loadSkillContent(name);
    if (!body) {
      return null;
    }

    return {
      name: skill.metadata.name,
      displayName: this.getSkillDisplayName(skill),
      description: skill.metadata.description || '',
      body,
      skillMdPath: normalizeSkillPath(skill.skillMdPath),
      baseDir: skill.baseDir ? normalizeSkillPath(skill.baseDir) : undefined,
      mode: this.getSkillMode(skill),
      userInvocable: skill.metadata.userInvocable !== false,
      modelInvocable: skill.metadata.disableModelInvocation !== true && !!skill.metadata.description,
      relatedFiles: this.getSkillRelatedFiles(skill),
    };
  }

  getLoadedSkillSummaries(agentName?: string): LoadedSkillSummary[] {
    return this.getActivatedSkillNames(agentName)
      .map(name => this.getSkillContext(name))
      .filter((context): context is SkillInvocationContext => !!context)
      .map(context => ({
        name: context.name,
        displayName: context.displayName,
        description: context.description,
        skillMdPath: context.skillMdPath,
        baseDir: context.baseDir,
        mode: context.mode,
        relatedFileCount: context.relatedFiles.length,
      }));
  }

  // ========== 查询 & 搜索 ==========

  /** 获取所有已注册 skills */
  getAll(): IAilySkill[] {
    return [...this.skills.values()];
  }

  /** 获取指定名称的 skill */
  get(name: string): IAilySkill | undefined {
    return this.skills.get(name);
  }

  /** 按 agent 过滤 skills */
  getSkillsForAgent(agentName: string): IAilySkill[] {
    return [...this.skills.values()].filter(
      s => {
        if (!this.isTrustedSkillSource(s)) {
          return false;
        }
        const matchesAgent = !s.metadata.agents || s.metadata.agents.length === 0 || s.metadata.agents.includes(agentName);
        const matchesTarget = !s.metadata.targets || s.metadata.targets.length === 0 || s.metadata.targets.includes(agentName);
        return matchesAgent && matchesTarget;
      }
    );
  }

  /** 获取自动激活的 skills（auto-activate: true） */
  getAutoActivateSkills(agentName?: string): IAilySkill[] {
    return [...this.skills.values()].filter(s => {
      if (!this.isTrustedSkillSource(s)) return false;
      if (!s.metadata.autoActivate) return false;
      if (agentName && s.metadata.agents && s.metadata.agents.length > 0) {
        return s.metadata.agents.includes(agentName);
      }
      return true;
    });
  }

  /**
   * 搜索 skills（三级策略，同 deferred tools 模式）。
   * 1. 精确名称匹配
   * 2. 标签/描述关键词匹配
   * 3. 模糊匹配
   */
  searchSkills(query: string, agentName?: string): SkillSearchResult[] {
    const q = query.toLowerCase();
    let candidates = agentName
      ? this.getSkillsForAgent(agentName)
      : this.getAll().filter(skill => this.isTrustedSkillSource(skill));

    // 1. 精确名称匹配
    const exact = candidates.filter(s => s.metadata.name === q);
    if (exact.length > 0) {
      return exact.map(skill => ({ skill, matchType: 'exact' as const }));
    }

    // 2. 标签匹配
    const tagMatches = candidates.filter(s =>
      s.metadata.tags?.some(t => t.toLowerCase().includes(q))
    );
    if (tagMatches.length > 0) {
      return tagMatches.map(skill => ({ skill, matchType: 'tag' as const }));
    }

    // 3. 名称/描述模糊匹配
    const fuzzy = candidates.filter(s =>
      s.metadata.name.toLowerCase().includes(q) ||
      s.metadata.description.toLowerCase().includes(q)
    );
    return fuzzy.map(skill => ({ skill, matchType: 'fuzzy' as const }));
  }

  /**
   * 生成 skills 索引列表文本（注入到系统提示中）。
   * 格式参考 getDeferredToolsListing()。
   */
  /**
   * 生成 skills 索引列表（渐进式发现：名称 → load_skill 加载完整内容）。
   * 只列出名称，类似 deferred tools 的渐进式索引模式。
   */
  getSkillsListing(
    agentName?: string,
    options?: {
      readonly availableToolNames?: ReadonlySet<string> | readonly string[] | null;
    },
  ): string {
    const skills = agentName
      ? this.getSkillsForAgent(agentName)
      : this.getAll();
    const availableToolNames = normalizeAvailableToolNames(options?.availableToolNames);
    const hasLoadSkillTool = !availableToolNames || availableToolNames.has('load_skill');
    const hasReadFileTool = !availableToolNames || availableToolNames.has('read_file');

    // 排除 auto-activate 和已激活的（它们的内容已通过 getActiveSkillsContent 持久注入）
    const listable = skills.filter(s => !s.metadata.autoActivate
      && !this._activatedSkills.has(s.metadata.name)
      && !!s.metadata.description
      && s.metadata.disableModelInvocation !== true);
    if (listable.length === 0) return '';

    const entries = listable.map(skill => {
        const context = this.getSkillContext(skill.metadata.name);
        const flags = [
          `user-invocable: ${context?.userInvocable === false ? 'false' : 'true'}`,
          `model-invocable: ${context?.modelInvocable === false ? 'false' : 'true'}`,
          `mode: ${context?.mode || 'inline'}`,
          ...(!hasLoadSkillTool ? [`uri: ${normalizeSkillPath(skill.skillMdPath)}`] : []),
        ];
        return `- ${skill.metadata.name}: ${skill.metadata.description} (${flags.join(', ')})`;
      });

    if (entries.length === 0) {
      return '';
    }

    return [
      '<skills>',
      ...entries,
      '',
      buildSkillsListingInstruction({
        hasLoadSkillTool,
        hasReadFileTool,
      }),
      '</skills>',
    ].join('\n');
  }

  // ========== 会话级激活/卸载 ==========

  /**
   * 激活一个 skill（Agent 通过 load_skill 调用）。
   * 激活后其内容会通过 getActiveSkillsContent() 持久注入到每轮请求中。
   */
  activateSkill(name: string): boolean {
    const skill = this.skills.get(name);
    if (!this.isTrustedSkillSource(skill)) return false;
    // 确保内容已加载
    this.loadSkillContent(name);
    const sizeBefore = this._activatedSkills.size;
    this._activatedSkills.add(name);
    if (this._activatedSkills.size !== sizeBefore) {
      this.emitDidChange();
    }
    return true;
  }

  /**
   * 卸载一个 Agent 主动加载的 skill。
   * auto-activate 的 skill 不可卸载（始终活跃）。
   */
  deactivateSkill(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;
    if (skill.metadata.autoActivate) return false;
    const didDelete = this._activatedSkills.delete(name);
    if (didDelete) {
      this.emitDidChange();
    }
    return didDelete;
  }

  /** 获取当前已激活的 skill 名称列表（含 auto-activate） */
  getActivatedSkillNames(agentName?: string): string[] {
    const autoNames = this.getAutoActivateSkills(agentName).map(s => s.metadata.name);
    return [...new Set([...autoNames, ...this._activatedSkills])];
  }

  /** 清除会话级激活状态（会话结束时调用） */
  clearSessionState(): void {
    if (this._activatedSkills.size === 0) {
      return;
    }

    this._activatedSkills.clear();
    this.emitDidChange();
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this._changeListeners.add(listener);
    return {
      dispose: () => {
        this._changeListeners.delete(listener);
      },
    };
  }

  /**
   * 获取所有活跃 skills 的合并内容（auto-activate + Agent 激活的）。
   * 用 <rules> 标签包裹，便于压缩时清理、下轮重新注入。
   *
   * 这是 Copilot 式的"每轮重新组装"模式的核心方法。
   */
  getActiveSkillsContent(agentName?: string): string {
    const contents: string[] = [];

    // 1. auto-activate skills
    const autoSkills = this.getAutoActivateSkills(agentName);
    for (const skill of autoSkills) {
      const body = skill.content || this.loadSkillContent(skill.metadata.name);
      if (body) contents.push(body);
    }

    // 2. Agent 主动激活的 skills
    for (const name of this._activatedSkills) {
      // 跳过已在 auto-activate 中包含的
      if (autoSkills.some(s => s.metadata.name === name)) continue;
      const body = this.loadSkillContent(name);
      if (body) contents.push(body);
    }

    if (contents.length === 0) return '';
    return `<rules>\n${contents.join('\n\n')}\n</rules>`;
  }

  /**
   * @deprecated 使用 getActiveSkillsContent() 替代
   */
  getAutoActivateContent(agentName?: string): string {
    return this.getActiveSkillsContent(agentName);
  }

  /** 已注册 skill 数量 */
  get size(): number {
    return this.skills.size;
  }

  private refreshDiscoveryWatchers(projectRoot: string | undefined, host: ReturnType<typeof AilyHost.get>): void {
    if (typeof host.fs?.watch !== 'function') {
      this.disposeDiscoveryWatchers();
      return;
    }

    const watchTargets = this.collectDiscoveryWatchTargets(projectRoot, host);
    const nextTargetKeys = new Set<string>();

    for (const targetPath of watchTargets) {
      const targetKey = this.normalizeWatchTargetIdentity(targetPath, host);
      nextTargetKeys.add(targetKey);
      if (this._watchSubscriptions.has(targetKey)) {
        continue;
      }

      try {
        const subscription = host.fs.watch(targetPath, () => {
          this.scheduleDiscoveryRefresh();
        });
        if (subscription) {
          this._watchSubscriptions.set(targetKey, subscription);
        }
      } catch {
        // Ignore unsupported watch failures; read-side initialize remains authoritative.
      }
    }

    for (const [targetKey, subscription] of Array.from(this._watchSubscriptions.entries())) {
      if (nextTargetKeys.has(targetKey)) {
        continue;
      }

      this.disposeDiscoveryWatchSubscription(subscription);
      this._watchSubscriptions.delete(targetKey);
    }
  }

  private collectDiscoveryWatchTargets(projectRoot: string | undefined, host: ReturnType<typeof AilyHost.get>): string[] {
    const roots: string[] = [];
    const builtinDir = this.getBuiltinSkillsDir();
    if (builtinDir) {
      roots.push(builtinDir);
    }

    const globalDir = this.getGlobalSkillsDir();
    if (globalDir) {
      roots.push(globalDir);
    }

    const claudeGlobalDir = this.getClaudeGlobalSkillsDir();
    if (claudeGlobalDir) {
      roots.push(claudeGlobalDir);
    }

    roots.push(...this.resolveConfiguredSkillDirectories(
      this._initializationOptions.userSkillFolders,
      'user',
      projectRoot,
      host,
    ));

    if (projectRoot) {
      roots.push(
        host.path.join(projectRoot, '.aily', 'skills'),
        host.path.join(projectRoot, '.github', 'skills'),
        host.path.join(projectRoot, '.agents', 'skills'),
        host.path.join(projectRoot, '.claude', 'skills'),
      );
    }

    roots.push(...this.resolveConfiguredSkillDirectories(
      this._initializationOptions.projectSkillFolders,
      'project',
      projectRoot,
      host,
    ));

    const watchTargets: string[] = [];
    const seenTargets = new Set<string>();
    for (const rootPath of roots) {
      for (const targetPath of this.resolveWatchTargetsForDiscoveryRoot(rootPath, host)) {
        const identity = this.normalizeWatchTargetIdentity(targetPath, host);
        if (seenTargets.has(identity)) {
          continue;
        }
        seenTargets.add(identity);
        watchTargets.push(targetPath);
      }
    }

    return watchTargets;
  }

  private resolveWatchTargetsForDiscoveryRoot(rootPath: string, host: ReturnType<typeof AilyHost.get>): string[] {
    const targets: string[] = [];
    const nearestExistingDirectory = this.findNearestExistingDirectory(rootPath, host);
    if (nearestExistingDirectory) {
      targets.push(nearestExistingDirectory);
    }

    try {
      if (host.fs.existsSync(rootPath) && host.fs.isDirectory(rootPath)) {
        targets.push(rootPath);
      }
    } catch {
      // Ignore transient fs errors while resolving watch targets.
    }

    return targets;
  }

  private findNearestExistingDirectory(rootPath: string, host: ReturnType<typeof AilyHost.get>): string | null {
    let currentPath = typeof rootPath === 'string' ? rootPath.trim() : '';
    while (currentPath) {
      try {
        if (host.fs.existsSync(currentPath) && host.fs.isDirectory(currentPath)) {
          return currentPath;
        }
      } catch {
        // Ignore unsupported stat lookups and keep walking upward.
      }

      const parentPath = host.path.dirname(currentPath);
      if (!parentPath || parentPath === currentPath) {
        break;
      }
      currentPath = parentPath;
    }

    return null;
  }

  private normalizeWatchTargetIdentity(targetPath: string, host: ReturnType<typeof AilyHost.get>): string {
    const normalizedPath = normalizeSkillPath(targetPath).replace(/\/+$/g, '').trim();
    if (!normalizedPath) {
      return '';
    }

    return host.platform?.isWindows ? normalizedPath.toLowerCase() : normalizedPath;
  }

  private scheduleDiscoveryRefresh(): void {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
    }

    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      void this.initialize(this._watchedProjectRoot, this._initializationOptions).catch((error) => {
        console.warn('[SkillRegistry] Skills 刷新失败:', error);
      });
    }, SKILL_DISCOVERY_REFRESH_DEBOUNCE_MS);
  }

  private disposeDiscoveryWatchers(): void {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }

    for (const subscription of this._watchSubscriptions.values()) {
      this.disposeDiscoveryWatchSubscription(subscription);
    }
    this._watchSubscriptions.clear();
  }

  private disposeDiscoveryWatchSubscription(
    subscription: { close?(): void; dispose?(): void; unsubscribe?(): void } | void,
  ): void {
    if (!subscription) {
      return;
    }

    if (typeof subscription.unsubscribe === 'function') {
      subscription.unsubscribe();
      return;
    }
    if (typeof subscription.dispose === 'function') {
      subscription.dispose();
      return;
    }
    subscription.close?.();
  }

  private emitDidChange(): void {
    for (const listener of Array.from(this._changeListeners)) {
      listener();
    }
  }
}

/** 全局单例 */
export const SkillRegistry = new SkillRegistryImpl();

function normalizeAvailableToolNames(
  value: ReadonlySet<string> | readonly string[] | null | undefined,
): ReadonlySet<string> | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = Array.from(value)
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map(entry => entry.trim());
  return normalized.length > 0 ? new Set(normalized) : undefined;
}

function buildSkillsListingInstruction(input: {
  readonly hasLoadSkillTool: boolean;
  readonly hasReadFileTool: boolean;
}): string {
  if (input.hasLoadSkillTool) {
    return 'Call load_skill with the skill name before starting the related task. The tool returns the skill\'s SKILL.md context plus related files; read related files on demand with read_file.';
  }

  if (input.hasReadFileTool) {
    return 'When a user request falls within a skill\'s domain, use read_file to acquire the full instructions from the skill\'s SKILL.md file URI before continuing.';
  }

  return 'When a listed skill applies to the request, treat it as a blocking requirement and defer the task until the required skill instructions become readable in the current tool set.';
}
