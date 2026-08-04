export function normalizeModelStoreApiServer(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function buildModelStoreServiceContextVersion(apiServer: unknown): string {
  return `api-v1-${fnv1a(normalizeModelStoreApiServer(apiServer))}`;
}
