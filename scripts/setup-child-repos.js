const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const childDir = path.join(rootDir, 'child');

const REPOS = [
  {
    name: 'aily-coder',
    url: 'https://github.com/ailyProject/aily-coder.git',
    branch: 'downey',
    buildScript: 'build:netlify',
  },
  {
    name: 'aily-lex',
    url: 'https://github.com/ailyProject/aily-lex.git',
    buildCommand: 'npx tsc -b --force',
    link: true,
  },
];

function run(command, cwd) {
  console.log(`\n> (${path.relative(rootDir, cwd)}) ${command}\n`);
  execSync(command, { cwd, stdio: 'inherit' });
}

function isGitRepo(repoDir) {
  return fs.existsSync(path.join(repoDir, '.git'));
}

function syncExistingRepo(repoDir, branch) {
  if (!isGitRepo(repoDir)) {
    return;
  }

  if (branch) {
    run(`git fetch origin ${branch}`, repoDir);
    run(`git checkout ${branch}`, repoDir);
  }

  run('git pull --ff-only', repoDir);
}

function ensureRepoDir(name, url, branch) {
  const repoDir = path.join(childDir, name);
  const existed = fs.existsSync(repoDir);

  if (existed) {
    console.log(`[exists] ${name}: ${repoDir}`);
    syncExistingRepo(repoDir, branch);
    return { repoDir, existed: true };
  }

  fs.mkdirSync(childDir, { recursive: true });
  const cloneCmd = branch
    ? `git clone -b ${branch} ${url} ${JSON.stringify(name)}`
    : `git clone ${url} ${JSON.stringify(name)}`;
  run(cloneCmd, childDir);
  return { repoDir, existed: false };
}

function main() {
  for (const repo of REPOS) {
    const { repoDir, existed } = ensureRepoDir(repo.name, repo.url, repo.branch);

    if (!existed) {
      run('npm install', repoDir);
    }

    if (repo.buildCommand) {
      run(repo.buildCommand, repoDir);
    } else if (repo.buildScript) {
      run(`npm run ${repo.buildScript}`, repoDir);
    }

    if (repo.link) {
      run('npm link', repoDir);
    }
  }

  run('npm link aily-lex', rootDir);
  console.log('\n[done] child repos ready.');
}

main();
