// 管理 aily-builder 工具链的安装、环境配置和构建任务调用。
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { ipcMain } = require("electron");

const { isWin32 } = require("./platform");

const CHANNELS = {
  stable: {
    key: "aily-builder",
    platformPackages: {
      "darwin-arm64": "@aily-project/aily-builder-darwin-arm64",
      "win32-x64": "@aily-project/aily-builder-win32-x64",
    },
  },
  next: {
    key: "aily-builder-next",
    platformPackages: {
      "darwin-arm64": "@aily-project/aily-builder-next-darwin-arm64",
      "win32-x64": "@aily-project/aily-builder-next-win32-x64",
    },
  },
};

let channel = "stable";
let installPromise = null;
let installKey = null;
let getMainWindow = () => null;
let handlersRegistered = false;

function normalizeChannel(value) {
  return value === "next" ? "next" : "stable";
}

function getChannel() {
  return normalizeChannel(process.env.AILY_BUILDER_CHANNEL || channel);
}

function setChannel(value) {
  channel = normalizeChannel(value);
  process.env.AILY_BUILDER_CHANNEL = channel;
  return channel;
}

function getChannelConfig(value = getChannel()) {
  return CHANNELS[normalizeChannel(value)] || CHANNELS.stable;
}

function getPackageName(value = getChannel()) {
  const platformKey = `${process.platform}-${process.arch}`;
  return getChannelConfig(value).platformPackages[platformKey] || "";
}

function getNpmEnv() {
  const env = { ...process.env };
  if (process.env.AILY_APPDATA_PATH) {
    env.npm_config_prefix = process.env.AILY_APPDATA_PATH;
  }
  return env;
}

function configureCacheEnvironment() {
  if (process.platform === "win32") {
    process.env.AILY_BUILDER_CACHE_PATH = path.join(os.homedir(), "AppData", "Local", "aily-builder");
  } else if (process.platform === "darwin") {
    process.env.AILY_BUILDER_CACHE_PATH = path.join(os.homedir(), "Library", "Caches", "aily-builder");
  } else {
    process.env.AILY_BUILDER_CACHE_PATH = path.join(os.homedir(), ".cache", "aily-builder");
  }
  process.env.AILY_BUILDER_BUILD_PATH = path.join(process.env.AILY_BUILDER_CACHE_PATH, "cache");

  for (const targetPath of [process.env.AILY_BUILDER_CACHE_PATH, process.env.AILY_BUILDER_BUILD_PATH]) {
    try {
      fs.mkdirSync(targetPath, { recursive: true });
    } catch (error) {
      console.error(`Failed to create aily-builder path: ${targetPath}`, error);
    }
  }
}

function getNpmExecutable(childPath) {
  if (isWin32) {
    const npmCmdPath = path.join(childPath, "node", "npm.cmd");
    return fs.existsSync(npmCmdPath) ? npmCmdPath : "npm";
  }

  const npmPath = path.join(childPath, "node", "bin", "npm");
  return fs.existsSync(npmPath) ? npmPath : "npm";
}

function quoteWindowsShellPath(filePath) {
  return `"${String(filePath).replace(/"/g, '""')}"`;
}

function readNpmGlobalValue(childPath, args) {
  const npmPath = getNpmExecutable(childPath);
  const npmCommand = isWin32 ? quoteWindowsShellPath(npmPath) : npmPath;
  const result = spawnSync(npmCommand, args, {
    env: getNpmEnv(),
    shell: isWin32,
    windowsHide: true,
    encoding: "utf8",
  });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function getInstalledPackageState(childPath, value = getChannel()) {
  const packageName = getPackageName(value);
  const npmRoot = readNpmGlobalValue(childPath, ["root", "-g"]);
  const packagePath = npmRoot && packageName
    ? path.join(npmRoot, ...packageName.split("/"))
    : "";
  let version = null;

  try {
    const packageJsonPath = path.join(packagePath, "package.json");
    if (packagePath && fs.existsSync(packageJsonPath)) {
      version = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).version || null;
    }
  } catch (_) {
    version = null;
  }

  return {
    packageName,
    path: packagePath,
    version,
    complete: !!packagePath && fs.existsSync(path.join(packagePath, "index.js")),
  };
}

function applyCommandEnv(childPath) {
  const prefix = readNpmGlobalValue(childPath, ["prefix", "-g"]);
  if (!prefix) {
    return;
  }

  const binPath = isWin32 ? prefix : path.join(prefix, "bin");
  const currentPath = process.env.PATH || "";
  const pathParts = currentPath.split(path.delimiter).filter(Boolean);
  if (!pathParts.includes(binPath)) {
    process.env.PATH = `${binPath}${path.delimiter}${currentPath}`;
  }
}

function sendNpmLog(log) {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("window-receive", {
    data: {
      action: "log",
      log,
    },
  });
}

function runNpm(childPath, npmArgs) {
  const npmPath = getNpmExecutable(childPath);
  const npmCommand = isWin32 ? quoteWindowsShellPath(npmPath) : npmPath;
  const displayCommand = `npm ${npmArgs.join(" ")}`;
  sendNpmLog({ title: "执行命令", detail: displayCommand, state: "doing" });

  return new Promise((resolve) => {
    const child = spawn(npmCommand, npmArgs, {
      env: getNpmEnv(),
      shell: isWin32,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let spawnFailed = false;

    child.stdout?.on("data", (chunk) => {
      const output = chunk.toString();
      stdout += output;
      sendNpmLog({ detail: output.replace(/^[\r\n]+/, "").trimEnd(), state: "doing" });
    });
    child.stderr?.on("data", (chunk) => {
      const output = chunk.toString();
      stderr += output;
      sendNpmLog({ detail: output.replace(/^[\r\n]+/, "").trimEnd(), state: "doing" });
    });
    child.on("error", (error) => {
      spawnFailed = true;
      sendNpmLog({
        title: "命令执行失败",
        detail: `${displayCommand}\n${error.message}`,
        state: "error",
      });
      resolve({ code: -1, stdout, stderr, error: error.message });
    });
    child.on("close", (code) => {
      if (!spawnFailed) {
        resolve({ code, stdout, stderr, error: "" });
      }
    });
  });
}

function installFromNpm(childPath, options = {}) {
  const activeChannel = getChannel();
  let packageState = getInstalledPackageState(childPath, activeChannel);
  if (!packageState.packageName) {
    return Promise.resolve({
      ok: false,
      path: "",
      error: `当前平台暂不支持 npm 版 aily-builder: ${process.platform}-${process.arch}`,
    });
  }

  if (!options.force && packageState.version && packageState.complete) {
    return Promise.resolve({
      ok: true,
      path: packageState.path,
      version: packageState.version,
      installed: false,
    });
  }

  if (installPromise) {
    return installKey === activeChannel
      ? installPromise
      : installPromise.then(() => installFromNpm(childPath, options));
  }

  const npmArgs = ["i", packageState.packageName, "-g"];
  if (process.env.AILY_NPM_REGISTRY) {
    npmArgs.push("--registry", process.env.AILY_NPM_REGISTRY);
  }

  installKey = activeChannel;
  installPromise = runNpm(childPath, npmArgs)
    .then(({ code, stdout, stderr, error }) => {
      if (code !== 0) {
        return {
          ok: false,
          path: packageState.path,
          error: error || stderr || stdout || `npm install exited with ${code}`,
        };
      }

      packageState = getInstalledPackageState(childPath, activeChannel);
      return {
        ok: packageState.complete,
        path: packageState.path,
        version: packageState.version,
        installed: packageState.complete,
        error: packageState.complete ? "" : `@aily-project/aily-builder 安装完成但缺少 index.js`,
      };
    })
    .finally(() => {
      installPromise = null;
      installKey = null;
    });

  return installPromise;
}

function uninstallFromNpm(childPath, value) {
  const packageState = getInstalledPackageState(childPath, value);
  if (!packageState.packageName || !packageState.complete) {
    return Promise.resolve({ ok: true, path: packageState.path, uninstalled: false });
  }

  const npmArgs = ["uninstall", packageState.packageName, "-g"];
  if (process.env.AILY_NPM_REGISTRY) {
    npmArgs.push("--registry", process.env.AILY_NPM_REGISTRY);
  }

  return runNpm(childPath, npmArgs).then(({ code, stdout, stderr, error }) => ({
    ok: code === 0,
    path: packageState.path,
    uninstalled: code === 0,
    error: code === 0 ? "" : error || stderr || stdout || `npm uninstall exited with ${code}`,
  }));
}

async function ensure(childPath, options = {}) {
  const activeChannel = getChannel();
  const otherChannel = activeChannel === "next" ? "stable" : "next";
  const otherResult = await uninstallFromNpm(childPath, otherChannel);
  if (!otherResult.ok) {
    return otherResult;
  }

  const packageState = getInstalledPackageState(childPath, activeChannel);
  const force = options.force || otherResult.uninstalled;
  const result = packageState.complete && packageState.version && !force
    ? {
      ok: true,
      path: packageState.path,
      version: packageState.version,
      installed: false,
    }
    : await installFromNpm(childPath, { ...options, force });

  if (result.ok) {
    applyCommandEnv(childPath);
  }
  return result;
}

function getStatus(childPath) {
  const activeChannel = getChannel();
  const packageState = getInstalledPackageState(childPath, activeChannel);
  return {
    channel: activeChannel,
    key: getChannelConfig(activeChannel).key,
    packageName: packageState.packageName,
    installed: packageState.complete,
    installedVersion: packageState.version,
    installing: !!installPromise,
    installingKey: installKey,
    configLoaded: true,
    error: "",
  };
}

function requireChildPath() {
  const childPath = process.env.AILY_CHILD_PATH;
  if (!childPath) {
    throw new Error("AILY_CHILD_PATH 未设置");
  }
  return childPath;
}

function registerHandlers(mainWindowProvider) {
  getMainWindow = typeof mainWindowProvider === "function"
    ? mainWindowProvider
    : () => mainWindowProvider;
  if (handlersRegistered) {
    return;
  }
  handlersRegistered = true;

  ipcMain.handle("aily-builder-status", async () => getStatus(requireChildPath()));
  ipcMain.handle("aily-builder-channel-get", async () => getChannel());
  ipcMain.handle("aily-builder-channel-set", async (event, { channel: value } = {}) => {
    const childPath = requireChildPath();
    setChannel(value);
    const result = await ensure(childPath, { reason: "channel-switch" });
    if (!result.ok) {
      throw new Error(result.error || "aily-builder npm 安装失败");
    }
    return getStatus(childPath);
  });
  ipcMain.handle("aily-builder-ensure", async () => {
    const childPath = requireChildPath();
    const result = await ensure(childPath);
    if (!result.ok) {
      throw new Error(result.error || "aily-builder npm 安装失败");
    }
    return { version: result.version, status: getStatus(childPath) };
  });
  ipcMain.handle("aily-builder-update", async () => {
    const childPath = requireChildPath();
    const result = await ensure(childPath, { reason: "manual", force: true });
    if (!result.ok) {
      throw new Error(result.error || "aily-builder npm 安装失败");
    }
    return { version: result.version, status: getStatus(childPath) };
  });
}

module.exports = {
  applyCommandEnv,
  configureCacheEnvironment,
  ensure,
  registerHandlers,
  setChannel,
};