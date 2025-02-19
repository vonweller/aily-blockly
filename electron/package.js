const { spawn } = require('child_process');
const { execSync } = require('child_process');

function initNpmRegistry() {
    execSync('npm config set @aily-blockly:registry "https://registry.openjumper.cn/"', { stdio: 'inherit' });
}

function installPackage(prjPath, package = '') {
    return new Promise((resolve, reject) => {
        const args = package ? ['i', package] : ['i'];
        const child = spawn('npm', args, { cwd: prjPath, shell: true });
        child.stdout.on('data', (data) => {
            console.log(data.toString());
        });
        child.stderr.on('data', (data) => {
            console.error(data.toString());
        });
        child.on('close', (code) => {
            if (code !== 0) {
            reject(new Error(`npm process exited with code ${code}`));
            } else {
            resolve();
            }
        });
    });
}

module.exports = {
    initNpmRegistry,
    installPackage
}