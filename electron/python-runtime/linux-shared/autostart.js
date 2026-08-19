const path = require('node:path');

function requiredPath(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

function requiredName(value, label) {
  const name = requiredPath(value, label);
  if (!/^[A-Za-z0-9_.@-]+$/.test(name)) {
    throw new TypeError(`${label} contains invalid characters`);
  }
  return name;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function renderSystemdUnit(options = {}) {
  const serviceName = requiredName(options.serviceName || 'aily-python', 'serviceName');
  const scriptPath = requiredPath(options.scriptPath, 'scriptPath');
  const workingDirectory = options.workingDirectory
    ? requiredPath(options.workingDirectory, 'workingDirectory')
    : path.posix.dirname(scriptPath);
  const python = options.python || '/usr/bin/python3';
  const user = options.user ? `\nUser=${requiredName(options.user, 'user')}` : '';
  const environment = Array.isArray(options.environment)
    ? options.environment.map(entry => `Environment=${shellQuote(entry)}`).join('\n')
    : '';

  return `[Unit]
Description=${serviceName} Python runtime
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${workingDirectory}
ExecStart=${python} -u ${scriptPath}${user}
Restart=on-failure
RestartSec=2
${environment}

[Install]
WantedBy=multi-user.target
`;
}

function renderBootStartScript(options = {}) {
  const scriptPath = requiredPath(options.scriptPath, 'scriptPath');
  const logPath = requiredPath(options.logPath || `${path.posix.dirname(scriptPath)}/runtime.log`, 'logPath');
  const workingDirectory = options.workingDirectory
    ? requiredPath(options.workingDirectory, 'workingDirectory')
    : path.posix.dirname(scriptPath);
  const python = options.python || 'python3';

  return `#!/bin/sh
set -eu
cd ${shellQuote(workingDirectory)}
nohup ${python} -u ${scriptPath} >>${logPath} 2>&1 </dev/null &
`;
}

function createAutostartPlan(options = {}) {
  const kind = options.kind || 'systemd';
  const scriptPath = requiredPath(options.scriptPath, 'scriptPath');
  if (kind === 'systemd') {
    const serviceName = requiredName(options.serviceName || 'aily-python', 'serviceName');
    const servicePath = `/etc/systemd/system/${serviceName}.service`;
    return {
      kind,
      files: [{
        path: servicePath,
        content: renderSystemdUnit({ ...options, scriptPath, serviceName }),
      }],
      commands: [
        `sudo install -m 0644 ${shellQuote(servicePath)} ${shellQuote(servicePath)}`,
        'sudo systemctl daemon-reload',
        `sudo systemctl enable ${shellQuote(serviceName)}.service`,
        `sudo systemctl restart ${shellQuote(serviceName)}.service`,
      ],
    };
  }
  if (kind === 'boot-start-sh') {
    const bootPath = options.bootPath || '/boot/start.sh';
    return {
      kind,
      files: [{
        path: bootPath,
        content: renderBootStartScript(options),
      }],
      commands: [
        `chmod +x ${shellQuote(bootPath)}`,
        `sh ${shellQuote(bootPath)}`,
      ],
    };
  }
  throw new TypeError(`Unsupported autostart kind: ${kind}`);
}

module.exports = {
  createAutostartPlan,
  renderBootStartScript,
  renderSystemdUnit,
  shellQuote,
};
