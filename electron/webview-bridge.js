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
}

function createHiddenBridgeWindow() {
  ensureBridgeSessionConfigured();
  return new BrowserWindow({
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
  sharedBridgeWindow.destroy();
  sharedBridgeWindow = null;
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
    return sharedBridgeWindow;
  }

  sharedBridgeWindow = createHiddenBridgeWindow();
  sharedBridgeWindow.once("closed", () => {
    if (sharedBridgeWindow && sharedBridgeWindow.isDestroyed()) {
      sharedBridgeWindow = null;
    }
    clearIdleDestroyTimer();
  });

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

async function loadUrlWithTimeout(win, url, timeoutMs) {
  await Promise.race([
    new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        win.webContents.removeListener("did-finish-load", onFinish);
        win.webContents.removeListener("did-fail-load", onFail);
      };
      const onFinish = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve();
      };
      const onFail = (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (!isMainFrame || settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new Error(`Load failed (${errorCode}): ${errorDescription || validatedUrl || url}`));
      };

      win.webContents.once("did-finish-load", onFinish);
      win.webContents.on("did-fail-load", onFail);
      void win.loadURL(url).catch(error => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      });
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`webview bridge timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
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
    await loadUrlWithTimeout(win, String(payload.url || ""), timeoutMs);
    if (waitAfterLoadMs > 0) {
      await delay(waitAfterLoadMs);
    }

    const result = await win.webContents.executeJavaScript(
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

    return {
      ok: true,
      status: 200,
      contentType: "text/html; charset=utf-8",
      ...result,
    };
  });
}

async function searchViaEngine(engine, query, maxResults, timeoutMs) {
  const searchUrl = engine === "google"
    ? `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us&pws=0&num=${Math.max(maxResults, 10)}`
    : engine === "bing"
      ? `https://www.bing.com/search?q=${encodeURIComponent(query)}&cc=us&setlang=en-US`
      : engine === "duckduckgo"
        ? `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`
        : `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&ie=utf-8&lang=en`;

  return await withBridgeWindow(async (win) => {
    await loadUrlWithTimeout(win, searchUrl, timeoutMs);
    await delay(SEARCH_WAIT_AFTER_LOAD_MS);

    return await win.webContents.executeJavaScript(
      `(() => ({
        url: location.href,
        title: document.title || "",
        html: (document.documentElement?.outerHTML || "").slice(0, ${MAX_HTML_CHARS}),
      }))()`,
      true,
    );
  });
}

async function searchViaWebview(payload = {}) {
  const query = String(payload.query || "").trim();
  const maxResults = Number.isFinite(payload.maxResults)
    ? Math.max(1, Math.min(Number(payload.maxResults), 20))
    : 5;
  const timeoutMs = normalizeTimeout(payload.timeoutMs);

  const attempts = ["google", "bing", "duckduckgo", "baidu"];
  const errors = [];

  for (const engine of attempts) {
    try {
      const page = await searchViaEngine(engine, query, maxResults, timeoutMs);
      if (page?.html) {
        return { ok: true, engine, ...page };
      }
      errors.push(`${engine}: empty html`);
    } catch (error) {
      errors.push(`${engine}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    ok: false,
    error: errors.join("; "),
  };
}

function registerWebviewBridgeHandlers() {
  ipcMain.removeHandler(FETCH_CHANNEL);
  ipcMain.removeHandler(SEARCH_CHANNEL);

  ipcMain.handle(FETCH_CHANNEL, async (_event, payload = {}) => {
    return await fetchViaWebview(payload);
  });

  ipcMain.handle(SEARCH_CHANNEL, async (_event, payload = {}) => {
    return await searchViaWebview(payload);
  });
}

module.exports = {
  registerWebviewBridgeHandlers,
};
