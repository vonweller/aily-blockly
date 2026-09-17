import { indexAbsAbi } from './abs-abi-index';
import { absJson } from './abs-json';
import type { AbsAbiWorkspace, AbsProjectionContracts } from './abs-state';

/** Read-only advice from an already prepared candidate. No probes, authority,
 * persisted IDs, payload values or alternate syntax schema. */
export function describePreparedAbsSyntax(workspace: AbsAbiWorkspace, contracts: AbsProjectionContracts,
  identities: readonly { start: number; id: string }[]) {
  const blocks = indexAbsAbi(workspace), seen = new Set<string>();
  const variants: Array<{ type: string; sourceStart: number; argsOrder: unknown[]; fields: Record<string, unknown>; truncated: boolean }> = [];
  let truncated = false;
  let bytes = 0;
  for (const { start, id } of identities) {
    const block = blocks.get(id), args = contracts.syntax?.[id];
    if (!block || !args) continue;
    const fields: Record<string, unknown> = Object.create(null);
    let limited = args.length > 64;
    for (const arg of args.slice(0, 64).filter(arg => arg.kind === 'field')) {
      const field = contracts.fields[id]?.[arg.name];
      if (!field) continue;
      const { type, min, max, precision } = field;
      const values = field.options?.map(option => option[1]);
      if (values && values.length > 32) limited = true;
      fields[arg.name] = { type, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}),
        ...(precision !== undefined ? { precision } : {}),
        ...(values ? { options: values.slice(0, 32), optionsTruncated: values.length > 32 } : {}) };
    }
    const variant = { type: block.type, argsOrder: args.slice(0, 64), fields, truncated: limited };
    const key = absJson(variant);
    if (seen.has(key)) continue;
    bytes += new TextEncoder().encode(absJson({ ...variant, sourceStart: start })).length;
    if (variants.length === 32 || bytes > 48 * 1024) { truncated = true; break; }
    seen.add(key); variants.push({ ...variant, sourceStart: start });
    truncated ||= limited;
  }
  return { scope: 'prepared-candidate' as const, authority: false as const, truncated, variants };
}
