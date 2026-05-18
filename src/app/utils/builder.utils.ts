
export async function getDefaultBuildPath(sketchFilePath: string): Promise<string> {
    console.log("sketchFilePath: ", sketchFilePath);
    const sketchMd5Value = await window["tools"].calculateMD5(window['path'].resolve(sketchFilePath));
    const sketchMd5 = sketchMd5Value.slice(0, 8);
    const sketchName = window['path'].basename(sketchFilePath, '.ino');
    // 使用跨平台的路径拼接方式
    return window['path'].join(window['path'].getAilyBuilderBuildPath(), `${sketchName}_${sketchMd5}`);
}

/**
   * 文件查找
   */
export async function findFile(basePath: string, fileName: string, version: string = ''): Promise<string> {
    // 先判断basePath是否存在
    if (!window['fs'].existsSync(basePath)) {
        console.warn(`路径不存在: ${basePath}`);
        return '';
    }

    // 保持原始fileName，不进行*替换，让底层工具处理通配符
    const findRes = await window['tools'].findFileByName(basePath, fileName);
    console.log(`find ${fileName} in tools: `, findRes);

    let filteredRes = findRes;

    // 如果传入的是 *.bin 这样的模式，过滤结果只返回确切匹配的文件
    if (fileName.includes('*')) {
        // 将通配符模式转换为正则表达式
        const pattern = fileName.replace(/\*/g, '([^.]+)').replace(/\./g, '\\.');
        const regex = new RegExp(`^${pattern}$`);

        filteredRes = findRes.filter((filePath: string) => {
            const baseName = window['path'].basename(filePath);
            return regex.test(baseName);
        });
    } else {
        // 没有通配符时，进行全字匹配
        filteredRes = findRes.filter((filePath: string) => {
            const baseName = window['path'].basename(filePath);
            return baseName === fileName;
        });
    }

    // 如果有version参数且结果包含多个文件，优先返回路径中包含version的文件
    if (version && filteredRes.length > 1) {
        const versionMatched = filteredRes.filter((filePath: string) => {
            return filePath.includes(version);
        });
        
        if (versionMatched.length > 0) {
            return versionMatched[0];
        }
    }

    return filteredRes[0] || '';
}

/**
 * 在编译输出目录中解析 main.hex：根目录直连后再递归查找（与烧录前解析产物一致）。
 */
export async function resolveMainHexAbsolutePath(buildPath: string): Promise<string | undefined> {
  if (!buildPath?.trim()) {
    return undefined;
  }
  if (!window['fs'].existsSync(buildPath)) {
    return undefined;
  }
  const direct = window['path'].join(buildPath, 'main.hex');
  if (window['fs'].existsSync(direct)) {
    return direct;
  }
  const found = await findFile(buildPath, 'main.hex');
  return found && found.length > 0 ? found : undefined;
}

/**
 * aily-builder 实际子目录命名规则：`<basenameWithoutExt>_<md5(sourceAbs).slice(0,8)>`。
 * 与 `getDefaultBuildPath` 区别：basename 去掉所有扩展名（兼容 .ino / .cpp 等多种入口）。
 */
export async function getAilyBuilderBuildDir(sketchFilePath: string): Promise<string> {
  const md5 = (await window['tools'].calculateMD5(window['path'].resolve(sketchFilePath))).slice(0, 8);
  const sketchName = window['path'].basename(sketchFilePath).replace(/\.[^.]+$/, '');
  return window['path'].join(window['path'].getAilyBuilderBuildPath(), `${sketchName}_${md5}`);
}

/**
 * 工程层面解析 main.hex 真实落点：优先项目预期 buildPath，否则按 aily-builder 实际命名回探缓存子目录。
 * 候选 sketch 入口与 compile.js 一致：Aily Code -> `src/main.cpp`；纯 Blockly -> `.temp/sketch/sketch.ino`。
 */
export async function resolveActualMainHexLocation(
  projectRoot: string,
  primaryBuildPath: string
): Promise<{ abs?: string; buildPath: string }> {
  const fsApi = window['fs'] as { existsSync?: (p: string) => boolean } | undefined;
  const pathApi = window['path'] as {
    join: (...s: string[]) => string;
    getAilyBuilderBuildPath?: () => string;
  } | undefined;

  // 候选1：项目首选 buildPath（与 dev-tool openCompileFolder 对齐）
  const primaryHit = await resolveMainHexAbsolutePath(primaryBuildPath);
  if (primaryHit) {
    return { abs: primaryHit, buildPath: primaryBuildPath };
  }

  // 候选2：回探 aily-builder 全局缓存（覆盖 Aily Code 工程产物未落到 .aily/build 的常见情况）
  const globalRoot = pathApi?.getAilyBuilderBuildPath?.();
  if (globalRoot && fsApi?.existsSync?.(globalRoot) && pathApi) {
    const sketchCandidates = [
      pathApi.join(projectRoot, 'src', 'main.cpp'),
      pathApi.join(projectRoot, '.temp', 'sketch', 'sketch.ino'),
    ];
    for (const sketchPath of sketchCandidates) {
      if (!fsApi.existsSync?.(sketchPath)) continue;
      try {
        const candidateDir = await getAilyBuilderBuildDir(sketchPath);
        const found = await resolveMainHexAbsolutePath(candidateDir);
        if (found) {
          return { abs: found, buildPath: candidateDir };
        }
      } catch {
        /* 计算失败继续下一个候选 */
      }
    }
  }

  return { buildPath: primaryBuildPath };
}