function normalizeMermaidCode(rawCode) {
  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  if (!code) {
    throw new Error('参数 code 不能为空');
  }
  if (code.includes('```')) {
    throw new Error('code 必须是 Mermaid 原始 DSL，不要包含 fenced code block。');
  }
  return code;
}

module.exports = {
  normalizeMermaidCode,
};
