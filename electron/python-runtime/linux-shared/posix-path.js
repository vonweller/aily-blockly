const path = require('node:path').posix;

function validateBoardPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\0')) {
    throw new TypeError('board path must be an absolute POSIX path');
  }
  if (value.includes('\\')) throw new TypeError('board path cannot contain backslashes');
  const normalized = path.normalize(value);
  const segments = value.split('/');
  if (segments.some(segment => segment === '..') || normalized !== value && normalized.startsWith('/..')) {
    throw new TypeError('invalid board path');
  }
  return normalized;
}

function ensureChildPath(root, value) {
  const rootPath = validateBoardPath(root);
  const target = validateBoardPath(value);
  const isChild = rootPath === '/'
    ? target.startsWith('/')
    : target !== rootPath && target.startsWith(`${rootPath}/`);
  if (!isChild) {
    throw new TypeError('path is outside the allowed board root');
  }
  return target;
}

module.exports = {
  validateBoardPath,
  ensureChildPath,
};
