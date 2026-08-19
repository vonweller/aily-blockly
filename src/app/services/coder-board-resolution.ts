export interface CoderBoardLike {
  boardId?: string;
  name?: string;
  nickname?: string;
  package?: string;
  version?: string;
  type?: string;
  defaultFramework?: string;
  defaultPlatform?: string;
  frameworkPlatforms?: unknown[];
  [key: string]: unknown;
}

export interface CoderBoardSearchCatalog {
  boardIndex: any[];
  boardList: any[];
}

/** Accept both real Coder packages and the equivalent legacy Blockly board package. */
export function resolveCoderBoard(
  boards: readonly CoderBoardLike[],
  requestedName: string,
): CoderBoardLike | undefined {
  const requested = normalizePackageName(requestedName);
  const requestedStem = boardPackageStem(requested);
  const requestedIdentity = normalizeIdentity(requestedName);

  return boards.find((board) => {
    const packageName = coderBoardPackageName(board);
    if (normalizePackageName(packageName) === requested) {
      return true;
    }
    if (requestedStem && boardPackageStem(packageName) === requestedStem) {
      return true;
    }
    if (requestedIdentity && normalizeIdentity(board.boardId) === requestedIdentity) {
      return true;
    }
    return requestedIdentity && [board.name, board.nickname]
      .some((value) => normalizeIdentity(value) === requestedIdentity);
  });
}

/**
 * Reuse rich boards.json metadata while exposing only supported Coder boards
 * and their actual package names to search_boards_libraries.
 */
export function buildCoderBoardSearchCatalog(
  coderBoards: readonly CoderBoardLike[],
  boardIndex: readonly any[],
  boardList: readonly any[],
): CoderBoardSearchCatalog {
  const projected = coderBoards.map((coderBoard) => {
    const source = findGenericBoard(coderBoard, boardIndex);
    const sourceListItem = findGenericBoard(coderBoard, boardList);
    const packageName = coderBoardPackageName(coderBoard);
    const displayName = String(coderBoard.nickname || coderBoard.name || packageName).trim();
    const description = String(source?.description || sourceListItem?.description || '').trim();
    const core = String(coderBoard.type || source?.core || sourceListItem?.type || '').trim();
    const keywords = uniqueStrings([
      ...asStringArray(source?.keywords),
      ...asStringArray(sourceListItem?.keywords),
      displayName,
      packageName,
      core,
      coderBoard.boardId,
    ]);

    return {
      index: {
        ...(source || {}),
        name: packageName,
        displayName,
        description,
        brand: source?.brand || sourceListItem?.brand || '',
        type: source?.type === 'series' ? 'series' : 'board',
        mcu: source?.mcu || '',
        architecture: source?.architecture || inferArchitecture(core),
        cores: finiteNumber(source?.cores),
        frequency: finiteNumber(source?.frequency),
        frequencyUnit: source?.frequencyUnit || 'MHz',
        flash: finiteNumber(source?.flash),
        sram: finiteNumber(source?.sram),
        psram: finiteNumber(source?.psram),
        connectivity: asStringArray(source?.connectivity),
        interfaces: asStringArray(source?.interfaces),
        voltage: finiteNumber(source?.voltage),
        core,
        features: asStringArray(source?.features),
        tags: uniqueStrings([...asStringArray(source?.tags), ...keywords]),
        keywords,
      },
      list: {
        ...(sourceListItem || {}),
        name: packageName,
        nickname: displayName,
        description,
        brand: source?.brand || sourceListItem?.brand || '',
        type: core,
        keywords,
      },
    };
  });

  return {
    boardIndex: projected.map((item) => item.index),
    boardList: projected.map((item) => item.list),
  };
}

export function coderBoardPackageName(board: CoderBoardLike): string {
  return String(board.name || board.package || '').trim();
}

function findGenericBoard(coderBoard: CoderBoardLike, candidates: readonly any[]): any | undefined {
  const packageStem = boardPackageStem(coderBoardPackageName(coderBoard));
  const core = String(coderBoard.type || '').trim().toLowerCase();
  const displayIdentity = normalizeIdentity(coderBoard.nickname || coderBoard.name);

  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: Math.max(
        packageStem && boardPackageStem(candidate?.packageName || candidate?.name) === packageStem ? 100 : 0,
        core && String(candidate?.core || candidate?.type || '').trim().toLowerCase() === core ? 80 : 0,
        displayIdentity && normalizeIdentity(candidate?.displayName || candidate?.nickname) === displayIdentity ? 60 : 0,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.candidate;
}

function boardPackageStem(value: unknown): string {
  const normalized = normalizePackageName(value);
  const unscoped = normalized.startsWith('@aily-project/')
    ? normalized.slice('@aily-project/'.length)
    : normalized;
  return unscoped.replace(/^(?:board|coder)-/, '');
}

function normalizePackageName(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeIdentity(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function finiteNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function inferArchitecture(core: string): string {
  return core.split(':')[1] || '';
}
