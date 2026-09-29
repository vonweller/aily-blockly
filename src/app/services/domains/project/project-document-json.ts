import { ProjectDataError } from './project-data/project-data.types';

const MAX_DOCUMENT_DEPTH = 32_768;
const MAX_DOCUMENT_NODES = 2_000_000;

/** Canonical snapshots of Blockly documents, whose next/block links add two
 * levels per statement. Keep the external canonical-json-v1 payload codec's
 * 512-level contract separate. This writer never recurses or calls toJSON.
 * Output ordering matches canonicalJsonStringify, including integer keys.
 */
export function canonicalProjectJsonStringify(value: unknown): string {
  type Location = { parent?: Location; key: string };
  type Frame = { value: any; keys: string[] | null; length: number; index: number; depth: number; location: Location };
  const stack: Frame[] = [], parts: string[] = [], active = new Set<object>();
  let nodes = 0;
  const pointer = (location: Location) => {
    const keys: string[] = [];
    for (let current: Location | undefined = location; current; current = current.parent) keys.push(current.key);
    return keys.reverse().join('/');
  };
  const reject = (message: string, location: Location): never => {
    throw new ProjectDataError('corrupt', `${message} at ${pointer(location)}.`);
  };
  const visit = (current: unknown, depth: number, location: Location) => {
    if (++nodes > MAX_DOCUMENT_NODES || depth > MAX_DOCUMENT_DEPTH) {
      throw new ProjectDataError('too-large', 'Project document JSON exceeds its complexity limit.', {
        maxNodes: MAX_DOCUMENT_NODES, maxDepth: MAX_DOCUMENT_DEPTH,
      });
    }
    if (current === null || typeof current === 'string' || typeof current === 'boolean' || typeof current === 'number') {
      if (typeof current === 'number' && !Number.isFinite(current)) reject('Non-finite JSON number', location);
      parts.push(JSON.stringify(current)); return;
    }
    if (!current || typeof current !== 'object') reject('Unsupported JSON value', location);
    const object = current as object;
    if (active.has(object)) reject('Circular JSON object', location);
    const array = Array.isArray(object);
    if (!array && ![null, Object.prototype].includes(Object.getPrototypeOf(object))) reject('Unsupported JSON object', location);
    // JSON.stringify orders array-index object keys numerically, even after the
    // original canonical normalizer inserted all keys in lexical order.
    const keys = array ? null : Object.keys(object).sort((a, b) => {
      const ai = String(Number(a) >>> 0) === a && Number(a) < 0xffffffff;
      const bi = String(Number(b) >>> 0) === b && Number(b) < 0xffffffff;
      return ai && bi ? Number(a) - Number(b) : ai ? -1 : bi ? 1 : a < b ? -1 : a > b ? 1 : 0;
    });
    const length = array ? (object as unknown[]).length : keys!.length;
    if (length > MAX_DOCUMENT_NODES - nodes) throw new ProjectDataError('too-large', 'Project document JSON exceeds the node limit.');
    active.add(object); parts.push(array ? '[' : '{');
    stack.push({value: object, keys, length, index: 0, depth, location});
  };
  visit(value, 0, {key: '$'});
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index === frame.length) {
      parts.push(frame.keys ? '}' : ']'); active.delete(frame.value); stack.pop(); continue;
    }
    if (frame.index) parts.push(',');
    const key = frame.keys?.[frame.index] ?? String(frame.index);
    frame.index++;
    if (frame.keys) parts.push(JSON.stringify(key), ':');
    // Preserve the existing codec's JSON representation of sparse arrays.
    if (!frame.keys && !(key in frame.value)) {parts.push('null'); continue;}
    visit(frame.value[key], frame.depth + 1, {parent: frame.location, key: key.replace(/~/g, '~0').replace(/\//g, '~1')});
  }
  return parts.join('');
}
