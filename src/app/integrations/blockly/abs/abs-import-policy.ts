import { indexAbsAbi } from './abs-identity-map';
import { AbsAbiWorkspace, AbsSyncError } from './abs-state';
export { assertAbsReadback } from './abs-readback';

/** Blockly's deletable flag protects UI gestures, not serialization.load/clear. */
export function assertAbsProtectedBlocks(baseline: AbsAbiWorkspace, candidate: AbsAbiWorkspace): void {
  const before = indexAbsAbi(baseline);
  const after = indexAbsAbi(candidate);
  for (const block of before.values()) {
    if (block['deletable'] !== false) continue;
    const next = after.get(block.id);
    const fail = (code: string) => { throw new AbsSyncError(code,
      `Protected block ${block.type} cannot be removed, replaced or unlocked.`, undefined, [block.id], {
        blockType: block.type, reason: code.toLowerCase(),
        hint: 'Preserve this protected block from the baseline, including empty roots. Repair the candidate; this error does not require project recovery.',
      }); };
    if (!next) fail('PROTECTED_BLOCK_MISSING');
    if (next.type !== block.type) fail('PROTECTED_BLOCK_TYPE_CHANGED');
    if (next['deletable'] !== false) fail('PROTECTED_BLOCK_UNLOCK');
  }
}
