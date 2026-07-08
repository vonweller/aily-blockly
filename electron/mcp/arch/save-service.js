const fs = require('fs');

const { buildArchMarkdown, resolveArchFilePath } = require('./arch-file');
const { normalizeMermaidCode } = require('./normalize-mermaid');

function createArchSaveService(projectContext) {
  async function save(args = {}) {
    const code = normalizeMermaidCode(args.code);
    const projectPath = projectContext.resolveProjectPath('');
    if (!projectPath) {
      throw new Error('当前没有打开的项目。');
    }

    const archPath = resolveArchFilePath(projectPath);
    const content = buildArchMarkdown(code);
    fs.writeFileSync(archPath, content, 'utf8');

    return {
      archPath,
      content,
    };
  }

  return {
    save,
  };
}

module.exports = {
  createArchSaveService,
};
