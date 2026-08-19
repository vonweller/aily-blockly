import { coderBoardPackageName, resolveCoderBoard } from './coder-board-resolution';

export interface CoderFrameworkOptionLike {
  boardId?: string;
  platform?: string;
}

export interface CoderProjectCreateResult {
  ok: boolean;
  projectPath?: string;
  error?: string;
}

export interface CoderProjectCreateDependencies {
  normalizeBoardName(value: string): string;
  getCoderBoards(): readonly any[];
  loadCoderBoards(): Promise<readonly any[]>;
  resolveDefaultFramework(board: any): string;
  resolveFrameworkOption(board: any, framework: string): CoderFrameworkOptionLike | undefined;
  defaultParentPath(): string;
  generateUniqueName(parentPath: string, prefix: string): string;
  createProject(data: {
    name: string;
    path: string;
    wizardTarget: {
      boardPkgName: string;
      targetBoardId: string;
      boardNickname: string;
      boardPkgVersion: string;
      framework: string;
      platform: string;
    };
  }): Promise<CoderProjectCreateResult>;
  openProject(projectPath: string): Promise<boolean>;
  recordBoardUsage(boardName: string): void;
}

export async function executeCoderProjectCreateOperation(
  params: Record<string, any>,
  dependencies: CoderProjectCreateDependencies,
): Promise<Record<string, any>> {
  const rawBoardName = String(params['boardName'] || params['board'] || '').trim();
  const boardName = dependencies.normalizeBoardName(rawBoardName);
  if (!rawBoardName) {
    return {
      ok: false,
      operation: 'project_create',
      developmentMode: 'coder',
      reason: 'coder_board_required',
      message: '缺少 Coder 开发板包名 boardName',
    };
  }

  let coderBoards = dependencies.getCoderBoards();
  let boardInfo = resolveCoderBoard(coderBoards, boardName)
    || resolveCoderBoard(coderBoards, rawBoardName);
  if (!boardInfo) {
    coderBoards = await dependencies.loadCoderBoards();
    boardInfo = resolveCoderBoard(coderBoards, boardName)
      || resolveCoderBoard(coderBoards, rawBoardName);
  }
  if (!boardInfo) {
    return {
      ok: false,
      operation: 'project_create',
      developmentMode: 'coder',
      reason: 'coder_board_not_found',
      message: `Coder 开发板索引中不存在或尚未支持: ${boardName}`,
      board: { name: boardName, requestedName: rawBoardName },
    };
  }

  const resolvedBoardName = coderBoardPackageName(boardInfo);
  if (!resolvedBoardName) {
    return {
      ok: false,
      operation: 'project_create',
      developmentMode: 'coder',
      reason: 'coder_board_package_missing',
      message: `Coder 开发板索引缺少包名: ${boardName}`,
      board: { name: boardName, requestedName: rawBoardName },
    };
  }

  const requestedFramework = String(params['devmode'] || '').trim();
  const framework = requestedFramework || dependencies.resolveDefaultFramework(boardInfo);
  const platformOption = dependencies.resolveFrameworkOption(boardInfo, framework);
  if (!framework || !platformOption) {
    return {
      ok: false,
      operation: 'project_create',
      developmentMode: 'coder',
      reason: 'coder_framework_not_found',
      message: requestedFramework
        ? `开发板 ${resolvedBoardName} 不支持 Coder framework: ${requestedFramework}`
        : `开发板 ${resolvedBoardName} 缺少可用的 Coder framework`,
      board: { name: resolvedBoardName, requestedName: rawBoardName },
    };
  }

  const requestedParentPath = String(params['path'] || '').trim();
  const parentPath = requestedParentPath || dependencies.defaultParentPath();
  const requestedName = String(params['name'] || '').trim();
  const prefix = String(params['prefix'] || '').trim() || 'aily_code_';
  const projectName = requestedName || dependencies.generateUniqueName(parentPath, prefix);
  const requestedVersion = String(params['boardVersion'] || '').trim();
  const boardVersion = !requestedVersion || requestedVersion === 'latest'
    ? String(boardInfo.version || 'latest').trim() || 'latest'
    : requestedVersion;
  const boardNickname = String(
    params['boardNickname'] || boardInfo.nickname || boardInfo.name || resolvedBoardName,
  ).trim() || resolvedBoardName;
  const platform = platformOption.platform || boardInfo.defaultPlatform || '';
  const targetBoardId = platformOption.boardId || boardInfo.boardId || resolvedBoardName;

  const result = await dependencies.createProject({
    name: projectName,
    path: parentPath,
    wizardTarget: {
      boardPkgName: resolvedBoardName,
      targetBoardId,
      boardNickname,
      boardPkgVersion: boardVersion,
      framework,
      platform,
    },
  });
  if (!result.ok || !result.projectPath) {
    return {
      ok: false,
      operation: 'project_create',
      developmentMode: 'coder',
      reason: normalizeCoderProjectCreateError(result.error),
      message: `Coder 项目创建失败: ${result.error || 'UNKNOWN'}`,
      project: result.projectPath || null,
      name: projectName,
      path: parentPath,
      board: {
        name: resolvedBoardName,
        nickname: boardNickname,
        version: boardVersion,
        requestedName: rawBoardName,
        framework,
        platform,
      },
    };
  }

  let opened = false;
  try {
    opened = await dependencies.openProject(result.projectPath);
  } catch (error) {
    return {
      ok: false,
      operation: 'project_create',
      developmentMode: 'coder',
      reason: 'coder_project_activation_failed',
      partialMutation: true,
      project: result.projectPath,
      message: `Coder 项目已创建，但打开失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!opened) {
    return {
      ok: false,
      operation: 'project_create',
      developmentMode: 'coder',
      reason: 'coder_project_activation_failed',
      partialMutation: true,
      project: result.projectPath,
      message: 'Coder 项目已创建，但主软件未能激活该项目',
    };
  }

  dependencies.recordBoardUsage(resolvedBoardName);
  return {
    ok: true,
    operation: 'project_create',
    developmentMode: 'coder',
    projectType: 'coder',
    project: result.projectPath,
    message: `Coder 项目已创建并打开: ${result.projectPath}`,
    name: projectName,
    path: parentPath,
    board: {
      name: resolvedBoardName,
      nickname: boardNickname,
      version: boardVersion,
      requestedName: rawBoardName,
      framework,
      platform,
      targetBoardId,
    },
  };
}

function normalizeCoderProjectCreateError(error: string | undefined): string {
  switch (error) {
    case 'NAME_EMPTY':
      return 'coder_project_name_empty';
    case 'PATH_EMPTY':
      return 'coder_project_path_empty';
    case 'PATH_EXISTS':
      return 'project_directory_exists';
    default:
      return 'coder_project_create_failed';
  }
}
