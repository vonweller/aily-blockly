const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * 新建临时项目文件夹，并生成 package.json 文件
 */
export function createTemporaryProject() {
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
