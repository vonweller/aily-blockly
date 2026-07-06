function normalizeTextContent(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
}

function createSuccessToolResult(content, extra = {}) {
  return {
    content: [{ type: 'text', text: normalizeTextContent(content) }],
    isError: false,
    ...extra,
  };
}

function createErrorToolResult(message, extra = {}) {
  return {
    content: [{ type: 'text', text: normalizeTextContent(message || 'Unknown error') }],
    isError: true,
    ...extra,
  };
}

function fromToolUseResult(toolResult) {
  const content = toolResult && Object.prototype.hasOwnProperty.call(toolResult, 'content')
    ? toolResult.content
    : '';
  return toolResult && toolResult.is_error === true
    ? createErrorToolResult(content)
    : createSuccessToolResult(content);
}

module.exports = {
  normalizeTextContent,
  createSuccessToolResult,
  createErrorToolResult,
  fromToolUseResult,
};
