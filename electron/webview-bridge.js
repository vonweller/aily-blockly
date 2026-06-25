const { BrowserWindow, ipcMain, session } = require("electron");

const FETCH_CHANNEL = "webview-bridge-fetch";
const SEARCH_CHANNEL = "webview-bridge-search";
const PARTITION = "persist:aily-webview-bridge";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_WAIT_AFTER_LOAD_MS = 800;
const IDLE_DESTROY_MS = 3 * 60 * 1000;
const MAX_HTML_CHARS = 1_000_000;
const MAX_TEXT_CHARS = 200_000;
const SEARCH_WAIT_AFTER_LOAD_MS = 1500;
const SEARCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

let sessionConfigured = false;
let sharedBridgeWindow = null;
let sharedBridgeWindowIdleTimer = null;

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function logBridgeInfo(message, details) {
  if (details) {
    console.log(`[webview-bridge] ${message}`, details);
    return;
  }
  console.log(`[webview-bridge] ${message}`);
}

function logBridgeWarn(message, details) {
  if (details) {
    console.warn(`[webview-bridge] ${message}`, details);
    return;
  }
  console.warn(`[webview-bridge] ${message}`);
}

function logBridgeError(message, details) {
  if (details) {
    console.error(`[webview-bridge] ${message}`, details);
    return;
  }
  console.error(`[webview-bridge] ${message}`);
}

function getBridgeWindowMeta(win) {
  if (!win) {
    return { windowId: null, webContentsId: null };
  }

  return {
    windowId: typeof win.id === "number" ? win.id : null,
    webContentsId: win.webContents?.id ?? null,
  };
}

function getSafeUrl(win) {
  try {
    return win?.webContents?.getURL?.() || "";
  } catch {
    return "";
  }
}

function ensureBridgeSessionConfigured() {
  if (sessionConfigured) {
    return;
  }

  const bridgeSession = session.fromPartition(PARTITION);
  bridgeSession.setUserAgent(SEARCH_USER_AGENT);
  bridgeSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        "User-Agent": SEARCH_USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
      },
    });
  });

  sessionConfigured = true;
  logBridgeInfo("configured bridge session", { partition: PARTITION });
}

function clearSharedBridgeWindowReference(win) {
  if (sharedBridgeWindow === win) {
    sharedBridgeWindow = null;
  }
}

function destroyBridgeWindow(win, reason, details) {
  if (!win) {
    return;
  }

  const meta = {
    ...getBridgeWindowMeta(win),
    url: getSafeUrl(win),
    reason,
    ...details,
  };
  clearIdleDestroyTimer();
  clearSharedBridgeWindowReference(win);

  if (win.isDestroyed()) {
    logBridgeWarn("bridge window already destroyed", meta);
    return;
  }

  logBridgeWarn("destroying bridge window", meta);
  try {
    win.destroy();
  } catch (error) {
    logBridgeError("failed to destroy bridge window", {
      ...meta,
      error: describeError(error),
    });
  }
}

function attachBridgeWindowObservers(win) {
  const baseMeta = getBridgeWindowMeta(win);

  win.once("closed", () => {
    clearSharedBridgeWindowReference(win);
    clearIdleDestroyTimer();
    logBridgeInfo("bridge window closed", {
      ...baseMeta,
      url: getSafeUrl(win),
    });
  });

  win.on("unresponsive", () => {
    destroyBridgeWindow(win, "unresponsive", baseMeta);
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    destroyBridgeWindow(win, "render-process-gone", {
      ...baseMeta,
      exitCode: details?.exitCode,
      reason: details?.reason,
    });
  });

  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }

      const detail = {
        ...baseMeta,
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      };

      if (errorCode === -3) {
        logBridgeWarn("bridge load aborted", detail);
        return;
      }

      destroyBridgeWindow(win, "did-fail-load", detail);
    },
  );
}

function createHiddenBridgeWindow() {
  ensureBridgeSessionConfigured();
  const win = new BrowserWindow({
    show: false,
    width: 1366,
    height: 900,
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  attachBridgeWindowObservers(win);
  logBridgeInfo("created bridge window", {
    ...getBridgeWindowMeta(win),
    partition: PARTITION,
  });
  return win;
}

function clearIdleDestroyTimer() {
  if (!sharedBridgeWindowIdleTimer) {
    return;
  }
  clearTimeout(sharedBridgeWindowIdleTimer);
  sharedBridgeWindowIdleTimer = null;
}

function destroySharedBridgeWindow() {
  clearIdleDestroyTimer();
  if (!sharedBridgeWindow || sharedBridgeWindow.isDestroyed()) {
    sharedBridgeWindow = null;
    return;
  }
  destroyBridgeWindow(sharedBridgeWindow, "idle-timeout");
}

function scheduleIdleDestroy() {
  clearIdleDestroyTimer();
  sharedBridgeWindowIdleTimer = setTimeout(() => {
    destroySharedBridgeWindow();
  }, IDLE_DESTROY_MS);
}

function getSharedBridgeWindow() {
  clearIdleDestroyTimer();

  if (sharedBridgeWindow && !sharedBridgeWindow.isDestroyed()) {
    logBridgeInfo("reusing bridge window", {
      ...getBridgeWindowMeta(sharedBridgeWindow),
      url: getSafeUrl(sharedBridgeWindow),
    });
    return sharedBridgeWindow;
  }

  sharedBridgeWindow = createHiddenBridgeWindow();
  return sharedBridgeWindow;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeTimeout(value, fallback = DEFAULT_TIMEOUT_MS) {
  return Number.isFinite(value) && value > 0
    ? Math.max(1000, Math.min(Number(value), 60000))
    : fallback;
}

async function loadUrlWithTimeout(win, url, timeoutMs, operationLabel = "loadURL") {
  const meta = {
    ...getBridgeWindowMeta(win),
    url,
    timeoutMs,
    operation: operationLabel,
  };
  logBridgeInfo("starting bridge navigation", meta);

  await new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle = null;
    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      win.webContents.removeListener("did-finish-load", onFinish);
      win.webContents.removeListener("did-fail-load", onFail);
      win.webContents.removeListener("render-process-gone", onGone);
      win.removeListener("unresponsive", onUnresponsive);
      win.removeListener("closed", onClosed);
    };
    const settleResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };
    const settleReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const onFinish = () => {
      logBridgeInfo("bridge navigation finished", {
        ...meta,
        finalUrl: getSafeUrl(win),
      });
      settleResolve();
    };
    const onFail = (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (!isMainFrame || settled) {
        return;
      }
      logBridgeWarn("bridge navigation failed", {
        ...meta,
        errorCode,
        errorDescription,
        validatedUrl,
      });
      settleReject(new Error(`Load failed (${errorCode}): ${errorDescription || validatedUrl || url}`));
    };
    const onGone = (_event, details) => {
      logBridgeError("bridge renderer process gone during navigation", {
        ...meta,
        reason: details?.reason,
        exitCode: details?.exitCode,
      });
      settleReject(
        new Error(`Bridge renderer process gone during ${operationLabel}: ${details?.reason || "unknown"}`),
      );
    };
    const onUnresponsive = () => {
      logBridgeError("bridge window unresponsive during navigation", meta);
      settleReject(new Error(`Bridge window became unresponsive during ${operationLabel}`));
    };
    const onClosed = () => {
      logBridgeWarn("bridge window closed during navigation", meta);
      settleReject(new Error(`Bridge window closed during ${operationLabel}`));
    };
    const onTimeout = () => {
      if (settled) {
        return;
      }
      logBridgeWarn("bridge navigation timed out", meta);
      settleReject(new Error(`webview bridge timed out after ${timeoutMs}ms`));
      destroyBridgeWindow(win, "navigation-timeout", meta);
    };

    timeoutHandle = setTimeout(onTimeout, timeoutMs);
    win.webContents.once("did-finish-load", onFinish);
    win.webContents.on("did-fail-load", onFail);
    win.webContents.once("render-process-gone", onGone);
    win.once("unresponsive", onUnresponsive);
    win.once("closed", onClosed);
    void win.loadURL(url).catch(error => {
      logBridgeError("bridge loadURL threw", {
        ...meta,
        error: describeError(error),
      });
      settleReject(error);
    });
  });
}

async function withBridgeWindow(task) {
  const win = getSharedBridgeWindow();
  try {
    return await task(win);
  } finally {
    scheduleIdleDestroy();
  }
}

async function fetchViaWebview(payload = {}) {
  const timeoutMs = normalizeTimeout(payload.timeoutMs);
  const waitAfterLoadMs = normalizeTimeout(payload.waitAfterLoadMs, DEFAULT_WAIT_AFTER_LOAD_MS);
  return await withBridgeWindow(async (win) => {
    const targetUrl = String(payload.url || "");
    await loadUrlWithTimeout(win, targetUrl, timeoutMs, `fetch:${targetUrl}`);
    if (waitAfterLoadMs > 0) {
      await delay(waitAfterLoadMs);
    }

    let result;
    try {
      result = await win.webContents.executeJavaScript(
        `(() => {
          const html = document.documentElement?.outerHTML || "";
          const text = document.body?.innerText || document.documentElement?.innerText || "";
          return {
            url: location.href,
            title: document.title || "",
            html: html.slice(0, ${MAX_HTML_CHARS}),
            text: text.slice(0, ${MAX_TEXT_CHARS}),
          };
        })()`,
        true,
      );
    } catch (error) {
      destroyBridgeWindow(win, "execute-javascript-failed", {
        ...getBridgeWindowMeta(win),
        url: targetUrl,
        operation: "fetch",
        error: describeError(error),
      });
      throw error;
    }

    return {
      ok: true,
      status: 200,
      contentType: "text/html; charset=utf-8",
      ...result,
    };
  });
}

async function loadSearchPageViaWebview(searchUrl, timeoutMs) {
  return await withBridgeWindow(async (win) => {
    await loadUrlWithTimeout(win, searchUrl, timeoutMs, `search:${searchUrl}`);
    await delay(SEARCH_WAIT_AFTER_LOAD_MS);

    try {
      return await win.webContents.executeJavaScript(
        `(() => ({
          url: location.href,
          title: document.title || "",
          html: (document.documentElement?.outerHTML || "").slice(0, ${MAX_HTML_CHARS}),
        }))()`,
        true,
      );
    } catch (error) {
      destroyBridgeWindow(win, "execute-javascript-failed", {
        ...getBridgeWindowMeta(win),
        url: searchUrl,
        operation: `search:${searchUrl}`,
        error: describeError(error),
      });
      throw error;
    }
  });
}

async function searchViaWebview(payload = {}) {
  const searchUrl = String(payload.url || "").trim();
  const timeoutMs = normalizeTimeout(payload.timeoutMs);

  if (!searchUrl) {
    return {
      ok: false,
      error: "Missing search url",
    };
  }

  try {
    logBridgeInfo("starting bridge search attempt", { url: searchUrl });
    const page = await loadSearchPageViaWebview(searchUrl, timeoutMs);
    if (!page?.html) {
      return {
        ok: false,
        error: `empty html for ${searchUrl}`,
      };
    }

    logBridgeInfo("bridge search attempt succeeded", {
      url: searchUrl,
      finalUrl: page.url,
    });
    return { ok: true, ...page };
  } catch (error) {
    logBridgeWarn("bridge search attempt failed", {
      url: searchUrl,
      error: describeError(error),
    });
    return {
      ok: false,
      error: `${searchUrl}: ${describeError(error)}`,
    };
  }
}

function registerWebviewBridgeHandlers() {
  ipcMain.removeHandler(FETCH_CHANNEL);
  ipcMain.removeHandler(SEARCH_CHANNEL);

  ipcMain.handle(FETCH_CHANNEL, async (_event, payload = {}) => {
    try {
      return await fetchViaWebview(payload);
    } catch (error) {
      logBridgeError("fetch handler failed", {
        payload,
        error: describeError(error),
      });
      return {
        ok: false,
        error: describeError(error),
      };
    }
  });

  ipcMain.handle(SEARCH_CHANNEL, async (_event, payload = {}) => {
    try {
      return await searchViaWebview(payload);
    } catch (error) {
      logBridgeError("search handler failed", {
        payload,
        error: describeError(error),
      });
      return {
        ok: false,
        error: describeError(error),
      };
    }
  });
}

module.exports = {
  registerWebviewBridgeHandlers,
};
