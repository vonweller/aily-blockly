const fs = require('node:fs');
const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(workspaceRoot, relativePath), 'utf8');
}

function fail(message) {
  console.error(`[guard:aily-chat-mainline] ${message}`);
  process.exitCode = 1;
}

const routes = read('src/app/app.routes.ts');
const mainWindowSource = read('src/app/main-window/main-window.component.ts');
const mainWindowTemplate = read('src/app/main-window/main-window.component.html');
const childHostTemplate = read('src/app/tools/child-tool-host/child-tool-host.component.html');

if (!/path:\s*["']aily-chat["'][\s\S]*?redirectTo:\s*["']child-tool\/aily-chat["']/u.test(routes)) {
  fail('the legacy /aily-chat route must redirect to /child-tool/aily-chat');
}

for (const retiredSymbol of ['AilyChatComponent', 'AilyChatChildProtocolService', 'AILY_CHAT_VIEW_PROVIDERS']) {
  if (routes.includes(retiredSymbol) || mainWindowSource.includes(retiredSymbol)) {
    fail(`retired Angular symbol is reachable from the application shell: ${retiredSymbol}`);
  }
}

if (mainWindowTemplate.includes('<app-aily-chat')) {
  fail('the main window must not mount the legacy Angular Aily Chat component');
}

if (!childHostTemplate.includes('<app-subapp-activity-dock')) {
  fail('the installed Aily Chat surface must be hosted by the generic child-tool shell');
}

for (const retiredFile of [
  'src/app/tools/aily-chat/aily-chat.component.ts',
  'src/app/tools/aily-chat/services/aily-chat-child-protocol.service.ts',
]) {
  if (fs.existsSync(path.join(workspaceRoot, retiredFile))) {
    fail(`retired Angular entry still exists: ${retiredFile}`);
  }
}

if (!process.exitCode) {
  console.log('[guard:aily-chat-mainline] React subapp is the only Aily Chat UI entry.');
}
