const fs = require("fs");
const path = require("path");
const os = require("os");
const { Interface } = require("readline");


function genPackageJson(projectData) {
  return {
    name: projectData.name,
    version: projectData.version,
    description: projectData.description,
    main: "index.js",
    scripts: {
      start: "electron .",
    },
  }
}

function writePackageJson(data, prjPath) {
  const packageJson = genPackageJson({
    name: data.name,
    version: data.version,
    description: data.description,
    board: data.board,
  });
  const packageJsonPath = path.join(prjPath, "package.json");
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
}

/**
 * 新建临时项目文件夹，并生成 package.json 文件
 */
function createTemporaryProject() {
  // 使用操作系统提供的临时目录（Windows 下通常是 C:\Users\<User>\AppData\Local\Temp）
  const tmpDir = os.tmpdir();

  // 生成一个唯一的目录名称
  const projectFolderName = `aily-project-${Date.now()}`;
  const projectFolderPath = path.join(tmpDir, 'aily-project', projectFolderName);

  // 创建临时文件夹
  fs.mkdirSync(projectFolderPath, { recursive: true });

  // 构造 package.json 内容
  const packageJson = {
    name: "new-project",
    version: "1.0.0",
    description: "aily blockly project",
    main: "index.js",
    scripts: {
      start: "electron .",
    },
    author: "",
    license: "ISC",
  };

  // 写入 package.json 文件
  const packageJsonPath = path.join(projectFolderPath, "package.json");
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

  console.log(`临时项目文件夹已创建于: ${projectFolderPath}`);
  return projectFolderPath;
}


function createProject(data) {
  if (!fs.existsSync(data.path)) {
    fs.mkdirSync(data.path, { recursive: true });
  }

  // 判断projectName项目是否已存在
  const projectPath = path.join(data.path, data.name);
  if (fs.existsSync(projectPath)) {
    throw new Error("项目已存在");
  }

  // 创建项目文件夹
  fs.mkdirSync(projectPath, { recursive: true });

  // 生成 package.json 文件
  writePackageJson(data, projectPath);

  return projectPath;
}


module.exports = {
  createTemporaryProject,
  createProject,
}