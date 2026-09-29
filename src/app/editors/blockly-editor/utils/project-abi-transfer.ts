/** Worker postMessage recursively clones parsed objects in Chromium. Deep
 * next/block chains can overflow that clone even though native JSON.parse
 * succeeds. Parse those inputs directly after yielding a frame; keep workers
 * for wide/shallow documents. This scan is not a JSON validity check.
 */
export function needsMainThreadAbiParse(content: string): boolean {
  let depth = 0, quoted = false, escaped = false;
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') {
      if (++depth > 512) return true;
    } else if (character === '}' || character === ']') depth--;
  }
  return false;
}
