const path = require('path');

function buildArchMarkdown(code) {
  return `\`\`\`mermaid\n${code}\n\`\`\`\n`;
}

function resolveArchFilePath(projectPath) {
  return path.join(projectPath, 'arch.md');
}

module.exports = {
  buildArchMarkdown,
  resolveArchFilePath,
};
