export interface ToolInvocationDisplaySummary {
  label: string;
  subtitle?: string;
}

export function buildToolInvocationDisplaySummary(input: {
  toolName: string;
  args?: any;
  metadata?: Record<string, unknown> | null;
  result?: any;
}): ToolInvocationDisplaySummary | undefined {
  const cleanToolName = cleanToolNamePrefix(input.toolName);
  const args = inferToolArgs(input.args, cleanToolName, input.metadata);

  switch (cleanToolName) {
    case 'read_file':
      return buildReadFileSummary(args, input.metadata);
    case 'grep_search':
    case 'grep_tool':
      return buildSearchSummary(args, 'Searched');
    case 'glob_search':
    case 'glob_tool':
    case 'file_search':
      return buildFileSearchSummary(args);
    case 'semantic_search':
      return buildSemanticSearchSummary(args);
    case 'create_file':
      return buildPathSummary('Created', args);
    case 'create_folder':
    case 'create_directory':
      return buildPathSummary('Created', args, 'folder');
    case 'edit_file':
      return buildPathSummary('Edited', args);
    case 'replace_string_in_file':
    case 'multi_replace_string_in_file':
      return buildPathSummary('Updated', args);
    case 'delete_file':
      return buildPathSummary('Deleted', args);
    case 'delete_folder':
      return buildPathSummary('Deleted', args, 'folder');
    case 'list_dir':
    case 'list_directory':
      return { label: `Listed ${formatPathScope(getPrimaryPath(args))}` };
    case 'get_directory_tree':
      return { label: `Mapped ${formatPathScope(getPrimaryPath(args))}` };
    case 'check_exists':
      return { label: `Checked ${formatPathLeaf(getPrimaryPath(args), args?.type === 'folder' ? 'folder' : 'path')}` };
    case 'run_in_terminal':
    case 'run_terminal':
    case 'execute_command':
    case 'start_background_command':
      return buildCommandSummary('Ran', args);
    case 'send_to_terminal':
      return buildSendToTerminalSummary(args);
    case 'get_terminal_output':
      return buildTerminalOutputSummary(args);
    case 'fetch':
    case 'fetch_webpage':
      return buildFetchSummary(args);
    case 'web_search':
      return buildWebSearchSummary(args);
    case 'open_browser_page':
      return buildOpenBrowserSummary(args);
    case 'get_changed_files':
      return { label: 'Checked changed files' };
    case 'get_errors':
      return buildGetErrorsSummary(args);
    case 'renderMermaidDiagram':
      return { label: args?.title ? `Rendered ${String(args.title)}` : 'Rendered Mermaid diagram' };
    case 'create_new_workspace':
      return { label: 'Created workspace', subtitle: asString(args?.query) };
    case 'create_new_jupyter_notebook':
      return { label: 'Created notebook', subtitle: asString(args?.query) };
    case 'install_extension':
      return { label: `Installed ${truncateDisplayText(asString(args?.name) || asString(args?.id) || 'extension', 48)}` };
    case 'run_vscode_command':
      return { label: `Ran ${truncateDisplayText(asString(args?.name) || asString(args?.commandId) || 'VS Code command', 56)}` };
    case 'resolve_memory_file_uri':
      return { label: `Resolved ${truncateDisplayText(asString(args?.path) || 'memory file', 56)}` };
    case 'memory':
      return buildMemorySummary(args);
    case 'ask_user':
      return { label: 'Asked a question' };
    case 'ask_approval':
      return { label: 'Requested approval' };
    case 'runSubagent':
    case 'agent':
      return buildSubagentSummary(args);
    default:
      return buildGenericToolSummary(cleanToolName, args);
  }
}

export function flattenToolInvocationDisplaySummary(
  summary?: ToolInvocationDisplaySummary,
): string | undefined {
  if (!summary) {
    return undefined;
  }

  return summary.subtitle ? `${summary.label}, ${summary.subtitle}` : summary.label;
}

export function generateCopilotToolStartText(toolName: string, args?: any): string | undefined {
  return flattenToolInvocationDisplaySummary(buildToolInvocationDisplaySummary({ toolName, args }));
}

export function generateCopilotToolResultText(toolName: string, args?: any, result?: any): string | undefined {
  const cleanToolName = cleanToolNamePrefix(toolName);
  const summary = buildToolInvocationDisplaySummary({ toolName, args, result });
  const base = flattenToolInvocationDisplaySummary(summary);
  if (!base) {
    return undefined;
  }

  if (result?.is_error || result?.isError) {
    return `Failed: ${base}`;
  }

  const stats = buildResultStats(cleanToolName, args, result);
  return stats ? `${base} (${stats})` : base;
}

function buildReadFileSummary(args: any, metadata?: Record<string, unknown> | null): ToolInvocationDisplaySummary | undefined {
  const readFileMetadata = asRecord(metadata?.['readFile']);
  const path = asString(args?.filePath)
    || asString(args?.path)
    || asString(readFileMetadata?.['filePath'])
    || asString(metadata?.['argsSummary']);
  if (!path) {
    return undefined;
  }

  const rangeSummary = formatReadRange(
    readFileMetadata?.['returnedStartLine'] ?? readFileMetadata?.['requestedStartLine'] ?? args?.startLine,
    readFileMetadata?.['returnedEndLine'] ?? readFileMetadata?.['requestedEndLine'] ?? args?.endLine,
    readFileMetadata?.['lineCount'] ?? args?.lineCount,
    args?.startByte,
    args?.byteCount,
  );
  const byteSummary = formatReadByteSummary(
    readFileMetadata?.['readBytes'],
    readFileMetadata?.['totalBytes'],
    readFileMetadata?.['truncatedByBytes'],
  );
  const continuationSummary = formatReadContinuation(readFileMetadata?.['continueWith']);

  return {
    label: `Read ${formatPathLeaf(path, 'file')}`,
    subtitle: joinSummaryParts(rangeSummary, byteSummary, continuationSummary),
  };
}

function buildSearchSummary(args: any, verb: string): ToolInvocationDisplaySummary | undefined {
  const query = asString(args?.query) || asString(args?.pattern);
  if (!query) {
    return undefined;
  }

  return {
    label: `${verb} ${formatSearchScope(args)}`,
    subtitle: `for ${truncateDisplayText(query, 56)}`,
  };
}

function buildFileSearchSummary(args: any): ToolInvocationDisplaySummary | undefined {
  const query = asString(args?.query) || asString(args?.pattern);
  const scope = formatSearchScope(args);
  return {
    label: `Found files in ${scope}`,
    subtitle: query ? `for ${truncateDisplayText(query, 56)}` : undefined,
  };
}

function buildSemanticSearchSummary(args: any): ToolInvocationDisplaySummary | undefined {
  const query = asString(args?.query);
  return {
    label: 'Searched workspace semantically',
    subtitle: query ? `for ${truncateDisplayText(query, 56)}` : undefined,
  };
}

function buildPathSummary(verb: string, args: any, fallbackKind: 'file' | 'folder' | 'path' = 'file'): ToolInvocationDisplaySummary {
  return {
    label: `${verb} ${formatPathLeaf(getPrimaryPath(args), fallbackKind)}`,
  };
}

function buildCommandSummary(verb: string, args: any): ToolInvocationDisplaySummary {
  const command = asString(args?.command);
  return {
    label: `${verb} ${truncateDisplayText(command || 'command', 64)}`,
    subtitle: asString(args?.cwd) ? `in ${truncateDisplayText(String(args.cwd), 56)}` : undefined,
  };
}

function buildSendToTerminalSummary(args: any): ToolInvocationDisplaySummary {
  const command = asString(args?.command);
  const terminalId = asString(args?.id) || asString(args?.terminalId);
  return {
    label: command ? `Sent ${truncateDisplayText(command, 56)}` : 'Sent terminal input',
    subtitle: terminalId ? `to terminal ${terminalId}` : undefined,
  };
}

function buildTerminalOutputSummary(args: any): ToolInvocationDisplaySummary {
  const terminalId = asString(args?.id) || asString(args?.terminalId);
  return {
    label: 'Read terminal output',
    subtitle: terminalId ? `from terminal ${terminalId}` : undefined,
  };
}

function buildFetchSummary(args: any): ToolInvocationDisplaySummary {
  const url = firstUrl(args);
  const query = asString(args?.query);
  return {
    label: `Fetched ${formatUrlDisplay(url)}`,
    subtitle: query ? `for ${truncateDisplayText(query, 56)}` : undefined,
  };
}

function buildWebSearchSummary(args: any): ToolInvocationDisplaySummary {
  const query = asString(args?.query);
  return {
    label: 'Searched the web',
    subtitle: query ? `for ${truncateDisplayText(query, 56)}` : undefined,
  };
}

function buildOpenBrowserSummary(args: any): ToolInvocationDisplaySummary {
  return {
    label: `Opened ${formatUrlDisplay(asString(args?.url))}`,
  };
}

function buildGetErrorsSummary(args: any): ToolInvocationDisplaySummary {
  const filePaths = Array.isArray(args?.filePaths) ? args.filePaths.filter((item: unknown) => typeof item === 'string') : [];
  if (filePaths.length === 1) {
    return { label: `Checked problems in ${formatPathLeaf(filePaths[0], 'file')}` };
  }
  return { label: filePaths.length > 1 ? 'Checked problems in selected files' : 'Checked workspace problems' };
}

function buildMemorySummary(args: any): ToolInvocationDisplaySummary {
  const command = asString(args?.command) || 'view';
  const path = asString(args?.path);
  const actionMap: Record<string, string> = {
    view: 'Viewed',
    create: 'Saved',
    str_replace: 'Updated',
    insert: 'Inserted into',
    delete: 'Deleted',
    rename: 'Renamed',
  };
  const label = actionMap[command] || 'Updated';
  return {
    label: `${label} ${truncateDisplayText(path || 'memory', 56)}`,
  };
}

function buildSubagentSummary(args: any): ToolInvocationDisplaySummary {
  const agentName = asString(args?.agentName) || 'subagent';
  const description = asString(args?.description) || asString(args?.prompt);
  return {
    label: `Ran ${truncateDisplayText(agentName, 48)}`,
    subtitle: description ? truncateDisplayText(description, 64) : undefined,
  };
}

function buildGenericToolSummary(toolName: string, args: any): ToolInvocationDisplaySummary {
  const tokens = splitToolName(toolName);
  const verb = pastTenseVerb(tokens[0] || 'used');
  const nounPhrase = humanizeTokens(tokens.slice(1).filter(token => token !== 'tool')) || humanizeTokens(tokens);
  const target = extractGenericTarget(args);
  return {
    label: `${verb} ${truncateDisplayText(target || nounPhrase || toolName, 56)}`,
  };
}

function buildResultStats(toolName: string, args: any, result: any): string | undefined {
  const metadata = asRecord(result?.metadata);
  if (!metadata) {
    return undefined;
  }

  if (toolName === 'grep_search' || toolName === 'grep_tool') {
    const numMatches = asNumber(metadata['numMatches']);
    const numFiles = asNumber(metadata['numFiles']);
    if (numMatches === 0) {
      return 'no matches';
    }
    if (typeof numMatches === 'number') {
      return `${numMatches} matches`;
    }
    if (typeof numFiles === 'number') {
      return `${numFiles} files`;
    }
  }

  if (toolName === 'glob_search' || toolName === 'glob_tool' || toolName === 'file_search') {
    const numFiles = asNumber(metadata['numFiles']);
    if (numFiles === 0) {
      return 'no files';
    }
    if (typeof numFiles === 'number') {
      return `${numFiles} files`;
    }
  }

  if (toolName === 'get_errors') {
    const count = asNumber(metadata['count']) || asNumber(metadata['numErrors']);
    if (typeof count === 'number') {
      return `${count} issues`;
    }
  }

  if (toolName === 'get_terminal_output') {
    const status = asString(metadata['status']);
    if (status) {
      return status;
    }
  }

  return undefined;
}

function inferToolArgs(
  args: any,
  toolName: string,
  metadata?: Record<string, unknown> | null,
): any {
  if (args && Object.keys(args).length > 0) {
    return args;
  }

  const argsSummary = asString(metadata?.['argsSummary']);
  if (!argsSummary) {
    return {};
  }

  const parsedSummary = parseArgsSummary(argsSummary);
  if (parsedSummary) {
    return parsedSummary;
  }

  switch (toolName) {
    case 'read_file':
      return { filePath: argsSummary };
    case 'grep_search':
    case 'grep_tool':
    case 'semantic_search':
    case 'glob_search':
    case 'glob_tool':
    case 'file_search':
      return { query: argsSummary };
    case 'fetch':
    case 'fetch_webpage':
    case 'open_browser_page':
      return { url: argsSummary };
    case 'list_dir':
    case 'list_directory':
    case 'create_directory':
    case 'create_folder':
      return { path: argsSummary };
    case 'run_in_terminal':
    case 'run_terminal':
    case 'execute_command':
      return { command: argsSummary };
    default:
      return {};
  }
}

function parseArgsSummary(argsSummary: string): Record<string, unknown> | undefined {
  const trimmed = argsSummary.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return asRecord(parsed);
  } catch {
    return undefined;
  }
}

function getPrimaryPath(args: any): string | undefined {
  return asString(args?.filePath)
    || asString(args?.path)
    || asString(args?.dirPath)
    || asString(args?.cwd)
    || asString(args?.includePattern);
}

function extractGenericTarget(args: any): string | undefined {
  const path = getPrimaryPath(args);
  if (path) {
    return formatPathLeaf(path, 'path');
  }

  const command = asString(args?.command);
  if (command) {
    return truncateDisplayText(command, 56);
  }

  const query = asString(args?.query) || asString(args?.pattern);
  if (query) {
    return truncateDisplayText(query, 56);
  }

  const url = firstUrl(args);
  if (url) {
    return formatUrlDisplay(url);
  }

  const label = asString(args?.name) || asString(args?.title) || asString(args?.id);
  return label ? truncateDisplayText(label, 56) : undefined;
}

function cleanToolNamePrefix(toolName: string): string {
  return toolName.startsWith('mcp_') ? toolName.substring(4) : toolName;
}

function splitToolName(toolName: string): string[] {
  return toolName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(/[^A-Za-z0-9]+/)
    .map(token => token.trim().toLowerCase())
    .filter(Boolean);
}

function humanizeTokens(tokens: string[]): string {
  return tokens.join(' ').trim();
}

function pastTenseVerb(token: string): string {
  switch (token) {
    case 'read':
      return 'Read';
    case 'get':
      return 'Checked';
    case 'set':
      return 'Set';
    case 'run':
      return 'Ran';
    case 'send':
      return 'Sent';
    case 'build':
      return 'Built';
    case 'create':
    case 'new':
      return 'Created';
    case 'generate':
      return 'Generated';
    case 'render':
      return 'Rendered';
    case 'search':
    case 'grep':
      return 'Searched';
    case 'list':
      return 'Listed';
    case 'fetch':
      return 'Fetched';
    case 'clone':
      return 'Cloned';
    case 'open':
      return 'Opened';
    case 'delete':
      return 'Deleted';
    case 'edit':
      return 'Edited';
    case 'replace':
    case 'update':
      return 'Updated';
    case 'validate':
      return 'Validated';
    case 'verify':
      return 'Verified';
    case 'analyze':
      return 'Analyzed';
    case 'query':
      return 'Queried';
    case 'reload':
      return 'Reloaded';
    case 'save':
      return 'Saved';
    case 'apply':
      return 'Applied';
    case 'switch':
      return 'Switched';
    case 'configure':
      return 'Configured';
    case 'install':
      return 'Installed';
    case 'resolve':
      return 'Resolved';
    case 'rename':
      return 'Renamed';
    case 'register':
      return 'Registered';
    case 'ask':
      return 'Asked';
    default:
      return capitalize(token || 'Used');
  }
}

function formatPathLeaf(path: string | undefined, fallback: 'file' | 'folder' | 'path'): string {
  if (!path) {
    return fallback;
  }
  const normalized = path.replace(/\\/g, '/').trim();
  if (!normalized) {
    return fallback;
  }
  if (normalized.includes('*')) {
    return truncateDisplayText(normalized, 56);
  }
  const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const parts = trimmed.split('/').filter(Boolean);
  return truncateDisplayText(parts.length > 0 ? parts[parts.length - 1] : trimmed, 56);
}

function formatPathScope(path: string | undefined): string {
  if (!path) {
    return 'workspace';
  }
  const normalized = path.replace(/\\/g, '/').trim();
  if (!normalized) {
    return 'workspace';
  }
  if (normalized.includes('*')) {
    return truncateDisplayText(normalized, 56);
  }
  const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return truncateDisplayText(parts.slice(-2).join('/'), 56);
  }
  return truncateDisplayText(trimmed, 56);
}

function formatSearchScope(args: any): string {
  return formatPathScope(asString(args?.includePattern) || getPrimaryPath(args));
}

function formatReadRange(
  startLine: unknown,
  endLine: unknown,
  lineCount: unknown,
  startByte: unknown,
  byteCount: unknown,
): string | undefined {
  const start = asNumber(startLine);
  const end = asNumber(endLine);
  const count = asNumber(lineCount);
  const startOffset = asNumber(startByte);
  const byteLength = asNumber(byteCount);

  if (start !== undefined) {
    const resolvedEnd = end !== undefined
      ? end
      : count !== undefined && count > 0
        ? start + count - 1
        : undefined;
    if (resolvedEnd !== undefined) {
      return start === resolvedEnd ? `line ${start}` : `lines ${start} to ${resolvedEnd}`;
    }
    return `from line ${start}`;
  }

  if (startOffset !== undefined) {
    if (byteLength !== undefined && byteLength > 0) {
      return `bytes ${startOffset} to ${startOffset + byteLength - 1}`;
    }
    return `from byte ${startOffset}`;
  }

  return undefined;
}

function formatReadByteSummary(
  readBytes: unknown,
  totalBytes: unknown,
  truncatedByBytes: unknown,
): string | undefined {
  const read = asNumber(readBytes);
  const total = asNumber(totalBytes);
  const byteCap = truncatedByBytes === true;

  if (read === undefined && total === undefined && !byteCap) {
    return undefined;
  }

  const parts: string[] = [];
  if (read !== undefined && total !== undefined) {
    parts.push(`${formatByteCount(read)} of ${formatByteCount(total)}`);
  } else if (read !== undefined) {
    parts.push(formatByteCount(read));
  } else if (total !== undefined) {
    parts.push(`total ${formatByteCount(total)}`);
  }

  if (byteCap) {
    parts.push('byte-capped');
  }

  return parts.length > 0 ? parts.join(', ') : undefined;
}

function formatReadContinuation(value: unknown): string | undefined {
  const continuation = asRecord(value);
  if (!continuation) {
    return undefined;
  }

  const startLine = asNumber(continuation['startLine']);
  const endLine = asNumber(continuation['endLine']);
  if (startLine !== undefined) {
    if (endLine !== undefined) {
      return startLine === endLine
        ? `continue with line ${startLine}`
        : `continue with lines ${startLine} to ${endLine}`;
    }
    return `continue with line ${startLine}`;
  }

  const offset = asNumber(continuation['offset']);
  const limit = asNumber(continuation['limit']);
  if (offset !== undefined) {
    return limit !== undefined
      ? `continue with offset ${offset}, limit ${limit}`
      : `continue with offset ${offset}`;
  }

  return undefined;
}

function formatByteCount(value: number): string {
  return `${value.toLocaleString('en-US')} bytes`;
}

function joinSummaryParts(...parts: Array<string | undefined>): string | undefined {
  const filtered = parts.filter((part): part is string => typeof part === 'string' && part.length > 0);
  return filtered.length > 0 ? filtered.join(', ') : undefined;
}

function firstUrl(args: any): string | undefined {
  if (Array.isArray(args?.urls)) {
    const first = args.urls.find((item: unknown) => typeof item === 'string' && item.trim().length > 0);
    if (typeof first === 'string') {
      return first;
    }
  }
  return asString(args?.url);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function formatUrlDisplay(url: string | undefined): string {
  if (!url) {
    return 'resource';
  }
  try {
    const parsed = new URL(url);
    const leaf = parsed.pathname.split('/').filter(Boolean).at(-1);
    return truncateDisplayText(leaf || parsed.host || url, 56);
  } catch {
    return truncateDisplayText(url, 56);
  }
}

function truncateDisplayText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}