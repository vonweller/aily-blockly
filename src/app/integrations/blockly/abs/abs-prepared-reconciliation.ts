import { createAilyProjectDataValue } from '@domain/project/public-api';
import { AbsProjection } from './abs-state';
import { AbsReconcileOptions, reconcileAbsDraft } from './abs-reconciler';
import { AbsProjectDataPort, prepareAbsProjectData } from './abs-project-data';
import { replaceAbsBoundValues } from './abs-source-edits';
import { assertAbsResourceContracts } from './abs-resource-contracts';

/** v2 preparation, not a commit. No Blockly instance, ABI/ABS/map write or clean revision. */
export async function prepareAbsReconciliation(
  baseline: AbsProjection, source: string, assertCurrent: () => void,
  options: AbsReconcileOptions = {}, runtime?: AbsProjectDataPort,
) {
  assertCurrent();
  const draft = await reconcileAbsDraft(baseline, source, options);
  assertCurrent();
  const resources = await prepareAbsProjectData(draft.workspace, assertCurrent, runtime);
  assertAbsResourceContracts(draft.workspace, resources.document, draft.contracts);
  const abs = replaceAbsBoundValues(source, draft.workspace, draft.literals,
    resources.externalized.map(entry => ({ jsonPointer: entry.jsonPointer, value: createAilyProjectDataValue(entry.ref) })));
  assertCurrent();
  return {
    workspace: resources.document, abs, inputAbs: source, retained: draft.retained, added: draft.added, removed: draft.removed,
    contracts: draft.contracts,
    externalized: resources.externalized,
    materialize: resources.materialize,
  };
}
