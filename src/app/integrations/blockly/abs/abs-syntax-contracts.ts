import type { AbsAbiWorkspace, AbsProjectionContracts } from './abs-state';
import type { AbsArgumentDefinition, AbsSyntaxOptions } from './abs-syntax';
import { indexAbsAbi } from './abs-abi-index';

/** A type may use positional syntax only when all captured instances agree.
 * Never borrow one dynamic instance's order/options for a different shape.
 */
export function absSyntaxOptions(
  workspace: AbsAbiWorkspace, contracts: AbsProjectionContracts, fallback: AbsSyntaxOptions = {},
): AbsSyntaxOptions {
  const instances = new Map<string, string[]>();
  for (const block of indexAbsAbi(workspace).values()) {
    const ids = instances.get(block.type);
    if (ids) ids.push(block.id); else instances.set(block.type, [block.id]);
  }
  const common = <T>(type: string, value: (id: string) => T | undefined, otherwise: () => T | undefined): T | undefined => {
    const ids = instances.get(type);
    if (!ids?.length) return otherwise();
    const values = ids.map(value);
    if (values.every(item => item === undefined)) return otherwise();
    return values.every(item => item !== undefined && JSON.stringify(item) === JSON.stringify(values[0])) ? values[0] : undefined;
  };
  return {
    argumentOrder: type => common<readonly AbsArgumentDefinition[]>(type, id => contracts.syntax?.[id], () => fallback.argumentOrder?.(type)),
    fieldDefinition: (type, name) => common(type, id => contracts.fields[id]?.[name], () => fallback.fieldDefinition?.(type, name)),
  };
}
