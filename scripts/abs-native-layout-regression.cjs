// Run after building the host and Agent. Uses a disposable app profile and the
// product import API; only the imported copy is edited. Original mirrors are hashed.
// node scripts/abs-issue-audit.cjs --source /path/to/copied-draft-project --agent /path/to/aily-agent [--profile]
// --expect-failure records the old persisted-coordinate rejection without applying.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const { parseArgs } = require("node:util");
const { pathToFileURL } = require("node:url");
const { values: args } = parseArgs({
  options: {
    source: { type: "string" },
    agent: { type: "string" },
    profile: { type: "boolean", default: false },
    candidate: { type: "string" },
    "expect-failure": { type: "boolean", default: false },
    compile: { type: "boolean", default: false },
    "npm-prefix": { type: "string" },
  },
});
if (!args.source || !args.agent || !args.candidate)
  throw Error(
    "--source, --agent and --candidate are required. Only an imported project copy is changed.",
  );
const repo = path.resolve(__dirname, "..");
const agent = args.agent && path.resolve(args.agent);
const req = createRequire(path.join(repo, "package.json"));
const { _electron } = req("playwright");
const { createPackagedRendererServer } = req(
  "./electron/packaged-renderer-server",
);
const source = args.source && path.resolve(args.source);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "aily-abs-layout-"));
const appData = path.join(root, "app-data"),
  project = path.join(root, "Project Copy");
fs.mkdirSync(appData);
if (args["npm-prefix"]) {
  fs.symlinkSync(path.resolve(args["npm-prefix"]), path.join(appData, "npm-global"), "dir");
  const installedTools = path.join(path.dirname(path.resolve(args["npm-prefix"])), "tools");
  if (fs.existsSync(installedTools)) fs.symlinkSync(installedTools, path.join(appData, "tools"), "dir");
}
const config = req("./electron/config/config.json");
config.project_path = root;
config.appdata_path[process.platform] = appData;
fs.writeFileSync(path.join(appData, "config.json"), JSON.stringify(config));
const sha = (v) => createHash("sha256").update(v).digest("hex");
const mirrors = (p) =>
  Object.fromEntries(
    ["project.abi", "project.abs", "project.abs.map.json"].map((n) => [
      n,
      sha(fs.readFileSync(path.join(p, n))),
    ]),
  );
const original = source && mirrors(source);
const report = {
  root,
  source,
  project,
  original,
  nativeRuntimeHash: sha(fs.readFileSync(path.join(repo, "dist/aily-blockly/browser/blockly/runtime/native-candidate.js"))),
  candidatePath: path.resolve(args.candidate),
  candidateHash: sha(fs.readFileSync(args.candidate)),
  checks: [],
  calls: [],
  errors: [],
};
const save = () =>
  fs.writeFileSync(
    path.join(root, "result.json"),
    JSON.stringify(report, null, 2),
  );
let app,
  page,
  cdp,
  phase = "start";
const renderer = createPackagedRendererServer();
const mark = (p) => {
  phase = p;
  console.log("PHASE=" + p);
  save();
};
const pass = (s) => {
  report.checks.push(s);
  console.log("PASS=" + s);
  save();
};
(async () => {
  console.log("ROOT=" + root);
  await renderer.start({
    rootDirectory: path.join(repo, "dist/aily-blockly/browser"),
  });
  const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
  app = await _electron.launch({
    args: [".", "--serve", `--user-data-dir=${path.join(root, "profile")}`],
    cwd: repo,
    env: {
      ...env,
      AILY_E2E: "1",
      AILY_BUILD_PRODUCT: "blockly",
      AILY_APPDATA_PATH: appData,
      ...(args["npm-prefix"] ? { AILY_NPM_PREFIX: path.resolve(args["npm-prefix"]) } : {}),
    },
    timeout: 60000,
  });
  await app.context().route("http://localhost:4200/**", (route) =>
    route.fulfill({
      status: 302,
      headers: { location: renderer.rendererUrl("/main/guide") },
    }),
  );
  const until = Date.now() + 60000;
  while (!page && Date.now() < until) {
    for (const win of app.windows()) {
      if (
        await win
          .locator("app-main-window")
          .count()
          .catch(() => 0)
      ) {
        page = win;
        break;
      }
    }
    if (!page) await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(page, "main window");
  page.on("pageerror", (e) => {
    report.errors.push({ phase, message: e.message });
    save();
  });
  await page.goto(renderer.rendererUrl("/main/guide"));
  await page.waitForFunction(
    () => !!document.querySelector("app-header") && !!window.ng?.getComponent,
    undefined,
    { timeout: 60000 },
  );
  await page.evaluate(() => {
    const dismiss = () =>
      document.querySelector("app-onboarding .btn-skip")?.click();
    new MutationObserver(dismiss).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    dismiss();
    window.auditService = window.ng.getComponent(
      document.querySelector("app-header"),
    ).projectService;
  });
  mark("import-and-open");
  await page.evaluate(
    ({ source, project }) => {
      window.auditService.importProjectDirectory(source, project, false);
      window.auditOpen = { state: "pending" };
      window.auditService.projectOpen(project).then(
        (value) => (window.auditOpen = { state: "settled", value }),
        (error) =>
          (window.auditOpen = { state: "error", error: String(error) }),
      );
    },
    { source, project },
  );
  await page.waitForTimeout(1500);
  console.log(
    "OPEN_STATE=" +
      JSON.stringify(
        await page.evaluate(() => ({
          open: window.auditOpen,
          text: document.body.innerText.slice(-200),
        })),
      ),
  );
  await page.screenshot({ path: path.join(root, "opening.png") });
  await page.waitForFunction(
    () => {
      const el = document.querySelector("app-blockly-editor");
      const c = el && window.ng.getComponent(el);
      return c?.projectService.getBlocklyProjectLoadStatus(
        c.projectService.currentProjectPath,
      )?.ready;
    },
    undefined,
    { timeout: 180000 },
  );
  report.loaded = await page.evaluate(() => {
    const c = window.ng.getComponent(
      document.querySelector("app-blockly-editor"),
    );
    return {
      blocks: c.blocklyService.workspace.getAllBlocks(false).length,
      status: c.projectService.getBlocklyProjectLoadStatus(),
    };
  });
  pass("Original project copy loads in actual Electron");
  const { createBlocklyToolCatalog } = await import(
    pathToFileURL(path.join(agent, "dist/blockly/tools/definitions.js")).href
  );
  const { WorkspaceHistoryRuntime } = await import(
    pathToFileURL(
      path.join(agent, "dist/extensions/pi-workspace-history/runtime.js"),
    ).href
  );
  const agentWorkspace = path.join(root, "agent-workspace");
  fs.mkdirSync(agentWorkspace);
  const history = new WorkspaceHistoryRuntime(agentWorkspace);
  const catalog = createBlocklyToolCatalog(agentWorkspace, history);
  const call = async (name, args = {}) => {
    mark(name);
    await page.evaluate(() => {
      window.auditHeartbeat = { maxGapMs: 0, ticks: 0 };
      window.auditLastTick = performance.now();
    });
    const t = Date.now();
    const r = await catalog
      .find((x) => x.name === name)
      .execute({ project, ...args });
    const result = r.structuredContent;
    const longTasks = await page.evaluate(
      () => window.auditLongTasks?.splice(0) || [],
    );
    const heartbeat = await page.evaluate(() => window.auditHeartbeat);
    report.calls.push({
      heartbeat,
      name,
      durationMs: Date.now() - t,
      longTasks,
      result,
    });
    save();
    console.log(
      "RESULT=" +
        JSON.stringify({
          name,
          ok: result?.ok,
          code: result?.code,
          diagnostics: result?.diagnostics,
        }),
    );
    return result;
  };
  await page.evaluate(() => {
    window.auditLongTasks = [];
    window.auditHeartbeat = { maxGapMs: 0, ticks: 0 };
    window.auditLastTick = performance.now();
    setInterval(() => {
      const now = performance.now();
      window.auditHeartbeat.maxGapMs = Math.max(
        window.auditHeartbeat.maxGapMs,
        now - window.auditLastTick,
      );
      window.auditHeartbeat.ticks++;
      window.auditLastTick = now;
    }, 50);
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        window.auditLongTasks.push({
          start: e.startTime,
          duration: e.duration,
        });
    }).observe({ entryTypes: ["longtask"] });
  });
  if (args.profile) {
    cdp = await app.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
  }
  const before = mirrors(project);
  const diagnosis = await call("project_recover", { action: "inspect" });
  assert.equal(diagnosis.ok, true, JSON.stringify(diagnosis));
  const exported = diagnosis.diagnostics?.refresh
    ? await call("project_recover", { action: "refresh", token: diagnosis.diagnostics.refresh.token })
    : await call("abs_export", diagnosis.diagnostics?.rebind ? { rebind: diagnosis.diagnostics.rebind.token } : {});
  assert.equal(exported.ok, true, JSON.stringify(exported));
  assert.equal(mirrors(project)["project.abi"], before["project.abi"]);
  const candidate = fs.readFileSync(args.candidate, "utf8");
  assert.notEqual(candidate, exported.abs, "Regression must exercise a real edit");
  assert.equal(exported.abs, fs.readFileSync(path.join(source, "project.abs"), "utf8"), "Imported projection must match the source baseline");
  const withoutDelays = text => text.split("\n").filter(line => line.trim() !== "time_delay(math_number(200))").join("\n");
  assert.equal(withoutDelays(candidate), withoutDelays(exported.abs), "Fixture must only add delay statements");
  fs.writeFileSync(path.join(root, "candidate.abs"), candidate);
  const validation = await call("abs_validate", { generation: exported.generation, abs: candidate, chunk: true });
  if (args["expect-failure"]) {
    assert.equal(validation.ok, false);
    assert.equal(validation.code, "ABS_GENERATION_FAILED");
    assert.match(JSON.stringify(validation), /deferred UI task changed persisted state.*\/x/);
    assert.equal(mirrors(project)["project.abi"], before["project.abi"]);
    pass("Old runtime reproduces the saved-coordinate failure; ABI was not modified");
    report.success = true;
    return;
  }
  assert.equal(validation.ok, true, JSON.stringify(validation));
  pass("Exact failing session candidate validates in the imported project");
  const applied = await call("abs_apply", { generation: exported.generation, abs: candidate, chunk: true });
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.applyVerification.ok, true);
  assert.equal(applied.publication.status, "COMMITTED");
  assert.equal(fs.readFileSync(path.join(project, "project.abs"), "utf8"), candidate);
  const roots = abi => [...(abi.blocks?.blocks || abi.pages?.[0]?.content?.blocks?.blocks || []), ...(abi.sharedModel?.procedureBlocks || [])];
  const beforeAbi = JSON.parse(fs.readFileSync(path.join(source, "project.abi"), "utf8"));
  const afterAbi = JSON.parse(fs.readFileSync(path.join(project, "project.abi"), "utf8"));
  report.abiKeys = Object.keys(afterAbi);
  report.rootCoordinates = roots(afterAbi).map(b => [b.id, b.x, b.y]);
  assert.ok(report.rootCoordinates.length, "Native ABI top roots must be inspected");
  assert.deepEqual(report.rootCoordinates, roots(beforeAbi).map(b => [b.id, b.x, b.y]));
  const delayDelta = (candidate.match(/time_delay\(math_number\(200\)\)/g) || []).length
    - (exported.abs.match(/time_delay\(math_number\(200\)\)/g) || []).length;
  report.expectedAddedBlocks = delayDelta * 2;
  const liveCount = () => page.evaluate(() => window.ng.getComponent(document.querySelector("app-blockly-editor"))
    .blocklyService.workspace.getAllBlocks(false).length);
  report.blocksAfter = await liveCount();
  assert.equal(report.blocksAfter, report.loaded.blocks + report.expectedAddedBlocks);
  pass("Candidate commits all new delay blocks and preserves every existing root coordinate");
  const persisted = mirrors(project);
  mark("reopen");
  await page.reload();
  await page.waitForFunction(() => {
    const el = document.querySelector("app-blockly-editor");
    const c = el && window.ng?.getComponent(el);
    return c?.projectService.getBlocklyProjectLoadStatus(c.projectService.currentProjectPath)?.ready;
  }, undefined, { timeout: 180000 });
  assert.equal(await liveCount(), report.blocksAfter);
  assert.deepEqual(mirrors(project), persisted);
  pass("Full edited project reopens with identical saved mirrors and block count");
  if (args.compile) {
    mark("wait-for-dependencies");
    await page.waitForFunction(() => {
      const el = document.querySelector("app-blockly-editor");
      const c = el && window.ng?.getComponent(el);
      return c?._builderService && !c._builderService.isInstallInProgress();
    }, undefined, { timeout: 180000 });
    const build = await call("project_build");
    assert.equal(build.ok, true, JSON.stringify(build));
    pass("Edited project compiles through the actual host build service");
  }
  await page.screenshot({ path: path.join(root, "project.png") });
  assert.deepEqual(mirrors(source), original);
  pass("Original ABI/ABS/map untouched");
  report.success = true;
})()
  .catch((e) => {
    report.failure = { phase, message: e.stack };
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    report.originalAfter = source && mirrors(source);
    if (JSON.stringify(report.originalAfter) !== JSON.stringify(original)) {
      report.success = false;
      report.originalChanged = true;
      process.exitCode = 1;
    }
    if (cdp) {
      const cpu = await cdp.send("Profiler.stop").catch(() => null);
      if (cpu)
        fs.writeFileSync(
          path.join(root, "cpu.json"),
          JSON.stringify(cpu.profile),
        );
    }
    save();
    console.log("REPORT=" + path.join(root, "result.json"));
    if (app) {
      const process = app.process();
      await Promise.race([
        app.close().catch(() => {}),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
      if (process.exitCode === null) process.kill("SIGKILL");
    }
    await renderer.close();
  });
