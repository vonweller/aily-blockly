'use strict';

const path = require('node:path').posix;
const { shellQuote } = require('./bootstrap');

function validateProject(project = 'project') {
  const value = String(project);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
    throw new TypeError('project must contain only letters, numbers, underscore, or hyphen');
  }
  return value;
}

function validateAbsolutePath(value, label) {
  if (typeof value !== 'string'
    || !value.startsWith('/')
    || value.includes('\0')
    || value.includes('\\')
    || value.split('/').includes('..')) {
    throw new TypeError(`${label} must be an absolute normalized POSIX path`);
  }
  return path.normalize(value);
}

function getBootStartScriptPath(project) {
  return `/boot/start/aily-${validateProject(project)}.sh`;
}

function getManagedAutostartPaths(project, homeDirectory) {
  const projectId = validateProject(project);
  const home = validateAbsolutePath(homeDirectory, 'homeDirectory');
  const projectDirectory = path.join(
    home,
    '.aily-runtime',
    'projects',
    projectId,
  );
  return {
    projectDirectory,
    scriptPath: path.join(projectDirectory, 'main.py'),
    logPath: path.join(projectDirectory, 'autostart.log'),
    bootScriptPath: getBootStartScriptPath(projectId),
  };
}

function renderBootStartScript({
  scriptPath,
  logPath,
  workingDirectory,
} = {}) {
  const target = validateAbsolutePath(scriptPath, 'scriptPath');
  const cwd = validateAbsolutePath(
    workingDirectory || path.dirname(target),
    'workingDirectory',
  );
  const log = validateAbsolutePath(
    logPath || `${cwd}/aily-autostart.log`,
    'logPath',
  );
  return [
    '#!/bin/sh',
    'set -eu',
    `cd ${shellQuote(cwd)}`,
    `nohup python3 -u ${shellQuote(target)} >>${shellQuote(log)} 2>&1 </dev/null &`,
    '',
  ].join('\n');
}

function buildBootStartInstallCommand(options = {}) {
  const managedPath = getBootStartScriptPath(options.project);
  const content = renderBootStartScript(options);
  const encoded = Buffer.from(content, 'utf8').toString('base64');
  const source = [
    'import base64,os,tempfile',
    `target=${JSON.stringify(managedPath)}`,
    `data=base64.b64decode(${JSON.stringify(encoded)})`,
    'os.makedirs(os.path.dirname(target),exist_ok=True)',
    'fd,temp_path=tempfile.mkstemp(prefix=".aily-",dir=os.path.dirname(target))',
    'try:',
    '    with os.fdopen(fd,"wb") as output:',
    '        output.write(data)',
    '        output.flush()',
    '        os.fsync(output.fileno())',
    '    os.chmod(temp_path,0o755)',
    '    os.replace(temp_path,target)',
    'finally:',
    '    if os.path.exists(temp_path):',
    '        os.unlink(temp_path)',
  ].join('\n');
  return `python3 -u -c ${shellQuote(source)}`;
}

function buildBootStartUpdateCommand(options = {}) {
  return buildBootStartInstallCommand(options);
}

function buildBootStartStatusCommand({ project } = {}) {
  return `test -f ${shellQuote(getBootStartScriptPath(project))}`;
}

function buildBootStartRemoveCommand({ project } = {}) {
  return `rm -f ${shellQuote(getBootStartScriptPath(project))}`;
}

module.exports = {
  buildBootStartInstallCommand,
  buildBootStartRemoveCommand,
  buildBootStartStatusCommand,
  buildBootStartUpdateCommand,
  getBootStartScriptPath,
  getManagedAutostartPaths,
  renderBootStartScript,
  validateProject,
};
