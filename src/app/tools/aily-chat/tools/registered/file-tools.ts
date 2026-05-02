/**
 * 已注册工具 - 文件操作类（显示文本注册）
 *
 * Phase 3: invoke() 已迁移至 lex core，此处仅保留 getStartText/getResultText 供 PartEventProcessor 使用。
 * Handler imports 已移除，invoke() 为 stub。
 */

import { IAilyTool, ToolContext, ToolUseResult } from '../../core/tool-types';
import { ToolDisplayRegistry } from '../../core/tool-display-registry';
import { AilyHost } from '../../core/host';
import { createDisplayOnlyToolSchema } from './display-only-tool-schema';

// ============================
// 辅助函数
// ============================

function getFileName(path: string): string {
  if (!path) return '';
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

function getLastFolderName(path: string): string {
  if (!path) return '';
  const normalized = path.replace(/\\/g, '/');
  const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const parts = trimmed.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

function getPathArg(args: any): string {
  return args?.path || args?.dirPath || args?.filePath || args?.cwd || '';
}

function getSearchPatternArg(args: any): string {
  return args?.pattern || args?.query || '';
}

function formatReadRange(startLine: any, endLine: any): string {
  const start = typeof startLine === 'number' && Number.isFinite(startLine) ? startLine : undefined;
  const end = typeof endLine === 'number' && Number.isFinite(endLine) ? endLine : undefined;

  if (start !== undefined && end !== undefined) {
    return start === end ? `, line ${start}` : `, lines ${start} to ${end}`;
  }
  if (start !== undefined) {
    return `, from line ${start}`;
  }
  if (end !== undefined) {
    return `, through line ${end}`;
  }
  return '';
}

function formatSearchScope(args: any): string {
  const pathArg = getPathArg(args) || args?.includePattern || '';
  if (!pathArg) {
    return 'workspace';
  }

  const normalized = String(pathArg).replace(/\\/g, '/').trim();
  if (!normalized) {
    return 'workspace';
  }
  if (normalized.includes('*')) {
    return normalized.length > 48 ? `${normalized.substring(0, 45)}...` : normalized;
  }

  const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return parts.slice(-2).join('/');
  }
  return trimmed;
}

// ============================
// read_file
// ============================

class ReadFileTool implements IAilyTool {
  readonly name = 'read_file';
  readonly schema = createDisplayOnlyToolSchema('read_file', { agents: ['mainAgent', 'schematicAgent'] });

  /**
   * Resolve library nickname from path (synchronous, uses AilyHost.get().fs).
   * Returns the package.json nickname or the lib-xxx directory name.
   */
  private resolveLibInfo(path: string): { isLib: boolean; libNickName: string } {
    if (!path) return { isLib: false, libNickName: '' };

    const normalized = path.replace(/\\/g, '/');
    // 检测路径是否在 @aily-project/lib-* 库目录下
    const libMatch = normalized.match(/@aily-project\/(lib-[^/]+)/);
    if (!libMatch) return { isLib: false, libNickName: '' };

    const libName = libMatch[1];

    // Try to read nickname from package.json
    let nickname = '';
    try {
      const ailyIdx = normalized.indexOf('/@aily-project/');
      const pkgPath = normalized.substring(0, ailyIdx) + '/@aily-project/' + libName + '/package.json';
      if (typeof window !== 'undefined' && AilyHost.get().fs?.existsSync?.(pkgPath)) {
        const pkg = JSON.parse(AilyHost.get().fs.readFileSync(pkgPath, 'utf-8'));
        nickname = pkg.nickname || '';
      }
    } catch { /* ignore */ }

    return { isLib: true, libNickName: nickname || libName };
  }

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'read_file execution migrated to lex core' };
  }

  getStartText(args: any): string {
    const libInfo = this.resolveLibInfo(args?.path);
    if (libInfo.isLib && libInfo.libNickName) {
      return `了解 ${libInfo.libNickName} 使用方法`;
    }
    const fileName = getFileName(args?.filePath || args?.path);
    return `Read ${fileName}${formatReadRange(args?.startLine, args?.endLine)}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    const fileName = getFileName(args?.filePath || args?.path);
    const libNickName = result?.metadata?.libNickName;
    const isLib = result?.metadata?.isLib;

    if (result?.is_error) {
      if (fileName === 'project.abs') return '读取 项目文件 异常, 即将重试';
      if (libNickName) return `了解 ${libNickName} 使用方法异常, 即将重试`;
      return `Failed to read ${fileName || 'file'}${formatReadRange(args?.startLine, args?.endLine)}`;
    }

    if (fileName === 'project.abs') return '读取 项目文件 成功';
    if (libNickName || isLib) return `了解 ${libNickName || fileName} 使用方法成功`;
    return `Read ${fileName}${formatReadRange(args?.startLine, args?.endLine)}`;
  }
}

// ============================
// create_file
// ============================

class CreateFileTool implements IAilyTool {
  readonly name = 'create_file';
  readonly schema = createDisplayOnlyToolSchema('create_file');

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'create_file execution migrated to lex core' };
  }

  getStartText(args: any): string {
    let fileName = getFileName(args?.path);
    if (fileName === 'project.abs') fileName = '项目文件';
    return `创建: ${fileName}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    let fileName = getFileName(args?.path);
    if (fileName === 'project.abs') fileName = '项目文件';
    if (result?.is_error) return `创建 ${fileName} 文件异常, 即将重试`;
    return `创建 ${fileName} 文件成功`;
  }
}

// ============================
// create_folder
// ============================

class CreateFolderTool implements IAilyTool {
  readonly name = 'create_folder';
  readonly schema = createDisplayOnlyToolSchema('create_folder');

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'create_folder execution migrated to lex core' };
  }

  getStartText(args: any): string {
    return `创建: ${getLastFolderName(getPathArg(args))}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    const name = getLastFolderName(getPathArg(args));
    if (result?.is_error) return `创建 ${name} 文件夹异常, 即将重试`;
    return `创建 ${name} 文件夹成功`;
  }
}

// ============================
// edit_file
// ============================

class EditFileTool implements IAilyTool {
  readonly name = 'edit_file';
  readonly schema = createDisplayOnlyToolSchema('edit_file', { agents: ['mainAgent', 'schematicAgent'] });

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'edit_file execution migrated to lex core' };
  }

  getStartText(args: any): string {
    let fileName = getFileName(args?.path);
    if (fileName === 'project.abs') fileName = '项目文件';
    return `编辑: ${fileName}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    let fileName = getFileName(args?.path);
    if (fileName === 'project.abs') fileName = '项目文件';
    if (result?.is_error) return `编辑 ${fileName} 文件异常, 即将重试`;
    return `编辑 ${fileName} 文件成功`;
  }
}

// ============================
// delete_file
// ============================

class DeleteFileTool implements IAilyTool {
  readonly name = 'delete_file';
  readonly schema = createDisplayOnlyToolSchema('delete_file', { agents: ['mainAgent', 'schematicAgent'] });

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'delete_file execution migrated to lex core' };
  }

  getStartText(args: any): string {
    return `删除: ${getFileName(args?.path)}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    const name = getFileName(args?.path);
    if (result?.is_error) return `删除 ${name} 文件异常, 即将重试`;
    return `删除 ${name} 文件成功`;
  }
}

// ============================
// delete_folder
// ============================

class DeleteFolderTool implements IAilyTool {
  readonly name = 'delete_folder';
  readonly schema = createDisplayOnlyToolSchema('delete_folder', { agents: ['mainAgent', 'schematicAgent'] });

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'delete_folder execution migrated to lex core' };
  }

  getStartText(args: any): string {
    return `删除: ${getLastFolderName(args?.path)}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    const name = getLastFolderName(args?.path);
    if (result?.is_error) return `删除 ${name} 文件夹异常, 即将重试`;
    return `删除 ${name} 文件夹成功`;
  }
}

// ============================
// check_exists (不在 TOOLS 数组中但 component 有 case)
// ============================

class CheckExistsTool implements IAilyTool {
  readonly name = 'check_exists';
  readonly schema = {
    name: 'check_exists',
    description: '检查指定路径的文件或文件夹是否存在，返回详细信息。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要检查的路径' },
        type: { type: 'string', enum: ['file', 'folder', 'any'], default: 'any' }
      },
      required: ['path']
    },
    agents: ['mainAgent']
  };

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'check_exists execution migrated to lex core' };
  }

  getStartText(args: any): string {
    const fileName = getFileName(args?.path);
    const folderName = getLastFolderName(args?.path);
    return fileName ? `检查文件是否存在: ${fileName}` : `检查文件夹是否存在: ${folderName}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    const fileName = getFileName(args?.path);
    const folderName = getLastFolderName(args?.path);
    if (result?.is_error) return fileName ? `检查文件 ${fileName} 是否存在失败` : `检查文件夹 ${folderName} 是否存在失败`;
    return fileName ? `文件 ${fileName} 存在` : `文件夹 ${folderName} 存在`;
  }
}

// ============================
// list_directory
// ============================

class ListDirectoryTool implements IAilyTool {
  readonly name = 'list_directory';
  readonly schema = {
    name: 'list_directory',
    description: '列出指定目录的内容，包括文件和文件夹信息。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要列出内容的目录路径' }
      },
      required: ['path']
    },
    agents: ['mainAgent', 'schematicAgent']
  };

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'list_directory execution migrated to lex core' };
  }

  getStartText(args: any): string {
    return `获取${getLastFolderName(getPathArg(args))}目录内容`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    const name = getLastFolderName(getPathArg(args));
    if (result?.is_error) return `获取 ${name} 目录内容异常, 即将重试`;
    return `获取 ${name} 目录内容成功`;
  }
}

// ============================
// get_directory_tree
// ============================

class GetDirectoryTreeTool implements IAilyTool {
  readonly name = 'get_directory_tree';
  readonly schema = {
    name: 'get_directory_tree',
    description: '获取指定目录的树状结构，可控制遍历深度。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要获取树状结构的目录路径' },
        maxDepth: { type: 'number', default: 3 },
        includeFiles: { type: 'boolean', default: true }
      },
      required: ['path']
    },
    agents: ['mainAgent', 'schematicAgent']
  };

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'get_directory_tree execution migrated to lex core' };
  }

  getStartText(args: any): string {
    return `获取目录树: ${getLastFolderName(getPathArg(args))}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    const name = getLastFolderName(getPathArg(args));
    if (result?.is_error) return `获取目录树 ${name} 失败: ${result?.content || '未知错误'}`;
    return `获取目录树 ${name} 成功`;
  }
}

// ============================
// grep_tool
// ============================

class GrepTool implements IAilyTool {
  readonly name = 'grep_tool';
  readonly schema = createDisplayOnlyToolSchema('grep_tool', { agents: ['mainAgent', 'schematicAgent'] });
  readonly displayMode = 'appendMessage' as const;

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'grep_tool execution migrated to lex core' };
  }

  getStartText(args: any): string {
    const pattern = getSearchPatternArg(args).substring(0, 48);
    return `Searching ${formatSearchScope(args)} for ${pattern}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    const pattern = getSearchPatternArg(args).substring(0, 48);
    const searchLabel = `Searched ${formatSearchScope(args)} for ${pattern}`;
    if (result?.is_error) return `${searchLabel} failed`;
    const numMatches = result?.metadata?.numMatches;
    const numFiles = result?.metadata?.numFiles;
    if (numMatches !== undefined) {
      return numMatches === 0
        ? `${searchLabel} with no matches`
        : `${searchLabel} (${numMatches} matches)`;
    }
    if (numFiles !== undefined) return `${searchLabel} (${numFiles} files)`;
    return searchLabel;
  }
}

// ============================
// glob_tool
// ============================

class GlobTool implements IAilyTool {
  readonly name = 'glob_tool';
  readonly schema = createDisplayOnlyToolSchema('glob_tool', { agents: ['mainAgent', 'schematicAgent'] });
  readonly displayMode = 'appendMessage' as const;

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'glob_tool execution migrated to lex core' };
  }

  getStartText(args: any): string {
    const pattern = (getSearchPatternArg(args) || '未知模式').substring(0, 30);
    const pathDisplay = getPathArg(args) ? getLastFolderName(getPathArg(args)) : '当前目录';
    return `正在查找文件: ${pattern} (${pathDisplay})`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return `文件搜索失败: ${result?.content || '未知错误'}`;
    const numFiles = result?.metadata?.numFiles;
    if (numFiles === 0) return '搜索完成，未找到匹配的文件';
    let text = `搜索完成，找到 ${numFiles} 个文件`;
    if (result?.metadata?.truncated) text += ' (结果已截断)';
    return text;
  }
}

// ============================
// replace_string_in_file
// ============================

class ReplaceStringInFileTool implements IAilyTool {
  readonly name = 'replace_string_in_file';
  readonly schema = createDisplayOnlyToolSchema('replace_string_in_file', { agents: ['mainAgent', 'schematicAgent'] });

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'replace_string_in_file execution migrated to lex core' };
  }

  getStartText(args: any): string {
    let fileName = getFileName(args?.path);
    if (fileName === 'project.abs') fileName = '项目文件';
    return `替换: ${fileName}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    let fileName = getFileName(args?.path);
    if (fileName === 'project.abs') fileName = '项目文件';
    if (result?.is_error) return `替换 ${fileName} 异常, 即将重试`;
    return `替换 ${fileName} 成功`;
  }
}

// ============================
// multi_replace_string_in_file
// ============================

class MultiReplaceStringInFileTool implements IAilyTool {
  readonly name = 'multi_replace_string_in_file';
  readonly schema = createDisplayOnlyToolSchema('multi_replace_string_in_file', { agents: ['mainAgent', 'schematicAgent'] });

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'multi_replace_string_in_file execution migrated to lex core' };
  }

  getStartText(args: any): string {
    const count = Array.isArray(args?.replacements) ? args.replacements.length : 0;
    return `批量替换: ${count} 处修改`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    const count = Array.isArray(args?.replacements) ? args.replacements.length : 0;
    if (result?.is_error) return `批量替换异常, 即将重试`;
    return `批量替换 ${count} 处修改成功`;
  }
}

// ============================
// 注册所有文件操作类工具
// ============================

ToolDisplayRegistry.register(new ReadFileTool());
ToolDisplayRegistry.register(new CreateFileTool());
ToolDisplayRegistry.register(new CreateFolderTool());
ToolDisplayRegistry.register(new EditFileTool());
ToolDisplayRegistry.register(new ReplaceStringInFileTool());
ToolDisplayRegistry.register(new MultiReplaceStringInFileTool());
ToolDisplayRegistry.register(new DeleteFileTool());
ToolDisplayRegistry.register(new DeleteFolderTool());
ToolDisplayRegistry.register(new CheckExistsTool());
ToolDisplayRegistry.register(new ListDirectoryTool());
ToolDisplayRegistry.register(new GetDirectoryTreeTool());
ToolDisplayRegistry.register(new GrepTool());
ToolDisplayRegistry.register(new GlobTool());
ToolDisplayRegistry.registerAlias('create_directory', 'create_folder');
ToolDisplayRegistry.registerAlias('list_dir', 'list_directory');
ToolDisplayRegistry.registerAlias('grep_search', 'grep_tool');
ToolDisplayRegistry.registerAlias('glob_search', 'glob_tool');
