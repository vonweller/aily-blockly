// 这个文件用于和cli交互，进行编译和烧录等操作
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");


function findDependencies(prjPath) {
    boardList = [];
    libraryList = [];

    const nodeModulesPath = path.join(prjPath, 'node_modules/@aily-blockly');

    if (!fs.existsSync(nodeModulesPath)) {
        return { boardList, libraryList };
    }

    fs.readdirSync(nodeModulesPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
        if (entry.name.startsWith('board-')) {
            boardList.push(path.join(nodeModulesPath, entry.name));
        } else if (entry.name.startsWith('library-')) {
            libraryList.push(path.join(nodeModulesPath, entry.name));
        } else {
            console.log(`Unknown module: ${entry.name}`);
        }
    });

    return { boardList, libraryList };
}

function getDependencieName(depPath) {
    return path.basename(depPath);
}

// 读取依赖的配置文件（<depName>.json）
function getDependencieConfJson(depPath, keys) {
    const depName = getDependencieName(depPath);
    let configFileName;
    if (depName.startsWith("board-")) {
        configFileName = depName.substring("board-".length) + ".json";
    } else if (depName.startsWith("library-")) {
        configFileName = depName.substring("library-".length) + ".json";
    } else {
        configFileName = depName + ".json";
    }
    const configPath = path.join(depPath, configFileName);
    if (!fs.existsSync(configPath)) {
        throw new Error(`Config file not found: ${configPath}`);
    }
    const configContent = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(configContent);

    if (Array.isArray(keys) && keys.length > 0) {
        return keys.reduce((result, key) => {
            if (Object.prototype.hasOwnProperty.call(config, key)) {
                result[key] = config[key];
            }
            return result;
        }, {});
    }

    return config;
}

function getDependencies(prjPath) {
    const result = findDependencies(prjPath);
    result["boardConfList"] = [];
    result["libraryConfList"] = [];

    result.boardList.map(depPath => {
        const depName = getDependencieName(depPath);
        const depConf = getDependencieConfJson(depPath, ["core", "compilerTool", "compilerParam", "uploadParam"]);
        result["boardConfList"].push(depConf);
    });
    result.libraryList.map(depPath => {
        const depName = getDependencieName(depPath);
        const depConf = getDependencieConfJson(depPath, ["source"]);
        result["libraryConfList"].push(depConf);
    });

    console.log("buildResult: ", result);
    return result;
}

/**
 * 初始化arduino-cli配置文件
 * @param {string} prjPath 项目路径
 * @param {string} rootPath 程序资源根目录
 * @returns {string} arduino-cli配置文件路径
 */
function initArduinoCliConf(prjPath, rootPath) {
    // 判断项目下是否存在arduino-cli.yaml配置文件，如果存在则直接返回
    console.log("initArduinoCliConf: ", prjPath, rootPath);
    const cliYamlPath = path.join(prjPath, "arduino-cli.yaml");
    if (fs.existsSync(cliYamlPath)) {
        return cliYamlPath;
    }

    const directories = {
        "data": path.join(rootPath, "arduino15"),
        "downloads": path.join(rootPath, "staging"),
        "user": path.join(prjPath, "libraries"),
    }

    // 创建arduino-cli配置文件
    let cliYamlContent = `directories:\n`;
    Object.keys(directories).map(key => {
        cliYamlContent += `  ${key}: ${directories[key]}\n`;
    });
    fs.writeFileSync(cliYamlPath, cliYamlContent);

    console.log("arduino-cli.yaml created: ", cliYamlPath);
    return cliYamlPath;
}

function arduinoCodeGen(code, dirPath) {
    const codePath = path.join(dirPath, "src.ino");
    fs.writeFileSync(codePath, code);
}

function arduinoCliBuilder(core, sketchPath, cliYamlPath, outputDir="") {
    const cliPath = '.\\child\\arduino-cli.exe';

    return new Promise((resolve, reject) => {
        const arduinoCli = spawn(cliPath, ['compile', '--fqbn', core, sketchPath, '--config-file', cliYamlPath]);
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
    getDependencies,
    initArduinoCliConf,
    arduinoCliBuilder,
    arduinoCodeGen,
};