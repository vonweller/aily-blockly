// 这个文件负责下载package并放到对应位置

const { spawn } = require('child_process');

// 当前以arduino-cli来下载

const cliPath = '.\\child\\arduino-cli.exe';

function installPackageByArduinoCli(packageName, cliYamlPath) {
    console.log('installPackageByArduinoCli', packageName, cliYamlPath);
    return new Promise((resolve, reject) => {
        const arduinoCli = spawn(cliPath, ['core', 'install', packageName, '--config-file', cliYamlPath]);
        arduinoCli.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
        });
        arduinoCli.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
        });
        arduinoCli.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
        if (code === 0) {
            resolve();
        } else {
            reject();
        }
        });
    });
}

module.exports = {
    installPackageByArduinoCli,
}