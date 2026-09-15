import { Injectable } from '@angular/core';
import { BlocklyService, BlocklyProjectDocument } from '../../../editors/blockly-editor/services/blockly.service';
import { _ProjectService } from '../../../editors/blockly-editor/services/project.service';
import { BlocklyWorkspaceEditLease } from '../../../editors/blockly-editor/services/blockly-workspace-edit-lease';
import { composeBlocklyPage } from '../../../editors/blockly-editor/services/blockly-project-model';
import { getActiveProjectGenerator, getActiveProjectGeneratorRevision } from '../../../editors/blockly-editor/services/blockly-generator-runtime.service';
import { projectDataRuntime } from '@domain/project/public-api';
import { AbsBaselineStore, AbsDiskSnapshot, AbsPublishResult, absBaselineKey } from './abs-baseline-store';
import { openAbsHostStorage } from './abs-host-storage';
import { absJson, assertAbsBaselineContext, createAbsProjection, hashAbsText } from './abs-identity-map';
import { AbsProjection, AbsProjectionContracts, AbsSyncError } from './abs-state';
import { prepareAbsProjectData } from './abs-project-data';
import { prepareAbsReconciliation } from './abs-prepared-reconciliation';
import { assertAbsResourceContracts } from './abs-resource-contracts';
import { assertAbsReadback } from './abs-readback';
import { AbsWorkspaceLoadOptions, assertAbsProjectEnvelope, assertAbsRuntimeShapeSupported, captureAbsWorkspaceState, loadAbsWorkspaceState } from './abs-workspace-state';
import { captureAbsDeclarativeContracts } from './abs-declarative-contracts';
import { layoutAbsNewRoots } from './abs-new-root-layout';
import { AbsGenerationCandidateRequest, AbsGenerationEvidence, AbsGenerationValidation, generationEvidence } from './abs-generation-protocol';
import { inspectAbsGeneration } from './abs-generation-inspection';
import { planAbsVariableCreations } from './abs-variable-intents';
import { captureAbsBundledProcedures } from './abs-bundled-procedures';
import { describeAbsBlockCapability } from './abs-block-capabilities';
import { captureAbsCustomFunctions } from './abs-custom-functions';
import { captureAbsVariableDeclarations } from './abs-declaration-intents';

export interface AbsWorkspaceSyncOutcome {
  publication: AbsPublishResult;
  /** Only a fully committed, still-current application has an applied revision. */
  appliedRevision?: number;
  requiresReload: boolean;
  warnings: readonly string[];
  evidence?: AbsGenerationEvidence;
  abs?: string;
}

/** Explicit v2 coordinator. Not an automatic legacy-format switch.
 * The editor owns FIFO/lease/runtime, ProjectService owns save preparation/derived outputs,
 * the existing baseline kernel owns publication/recovery, and preload owns the common lock.
 */
@Injectable({ providedIn: 'root' })
export class AbsWorkspaceSyncService {
  constructor(private readonly editor: BlocklyService, private readonly project: _ProjectService) {}

  /** Synchronous runtime-scoped advice. No lease, persistence, generation or callback probing. */
  describeCapabilities(input: Record<string, any>) {
    if (input['version'] !== 1 || Object.keys(input).some(key => !['version', 'type', 'filter'].includes(key))
      || ['type', 'filter'].some(key => input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 256))
      || input['type'] !== undefined && (!input['type'] || input['filter'] !== undefined)) {
      throw new AbsSyncError('ABS_REQUEST_INVALID', 'Invalid ABS capability query.');
    }
    const context = this.context(), runtimeRevision = getActiveProjectGeneratorRevision();
    const filter = (input['filter'] ?? '').toLowerCase();
    const types = input['type'] !== undefined ? [input['type']] : context.definitions.types;
    const blocks = types.map(type => ({ type, library: this.editor.blockTypeToLibMap.get(type)?.name ?? 'host' }))
      .filter(item => !filter || item.type.toLowerCase().includes(filter) || item.library.toLowerCase().includes(filter))
      .map(item => ({ ...item, ...describeAbsBlockCapability(context.definitions, item.type) }));
    context.assertCurrent();
    return { version: 1, scope: context.scope, runtimeRevision, blocks };
  }

  /** initialize must be explicit when replacing an existing unversioned ABS mirror. */
  exportGeneration(options: { initialize?: boolean; expectedAbiHash?: string; publish?: boolean; rebind?: string } = {}): Promise<AbsWorkspaceSyncOutcome> {
    options = { ...options };
    const initialize = options.initialize === true;
    return this.run(async (context, lease, store) => {
      const inspection = options.rebind !== undefined ? await inspectAbsGeneration(store, context.scope) : undefined;
      if (inspection && (initialize || options.publish === false || !inspection.diagnostics.rebind
        || options.rebind !== inspection.diagnostics.rebind.token)) {
        throw new AbsSyncError('ABS_REBIND_STALE', 'Rebind requires the current inspection token, clean source and canonical export. Inspect again; never rebase a candidate.');
      }
      const expected = inspection?.disk ?? await store.captureDisk();
      if (options.expectedAbiHash !== undefined && (expected.abi === null || await hashAbsText(expected.abi) !== options.expectedAbiHash)) {
        throw new AbsSyncError('ABS_BASELINE_STALE', 'Saved ABI changed before export.');
      }
      if (await store.inspectPending()) throw new AbsSyncError('ABS_TRANSACTION_PENDING', 'Recover the pending generation before exporting.');
      const committed = inspection ? inspection.committed?.projection : await store.loadCommitted();
      if (committed && !inspection) this.assertMirrors(committed, expected, true);
      else if (!committed && (expected.map !== null || expected.abs !== null && !initialize)) {
        throw new AbsSyncError('ABS_INITIALIZATION_REQUIRED', 'An existing mirror requires explicit generation initialization; orphan maps are never overwritten.');
      }
      context.assertCurrent();
      const snapshot = this.editor.captureProjectSnapshot(lease);
      const assertCurrent = this.atRevision(context.assertCurrent, lease, snapshot.revision);
      if (committed) {
        const diskHash = expected.abi === null ? null : await hashAbsText(absJson(JSON.parse(expected.abi)));
        if (diskHash !== committed.map.savedAbiHash) {
          // A normal save may advance disk; an independent external edit must not
          // become the baseline for a different in-memory document.
          const prepared = await this.project.prepareSave(snapshot.document, assertCurrent);
          if (await hashAbsText(absJson(JSON.parse(prepared.abiText))) !== diskHash) {
            throw new AbsSyncError('ABS_DUAL_EDIT_CONFLICT', 'Saved ABI and workspace diverged; reconcile the external edit before exporting a new generation.');
          }
        }
        assertCurrent();
      }
      const runtime = captureAbsWorkspaceState(context.workspace, assertCurrent, context.definitions);
      const compact = await this.compactDocument(snapshot.document, runtime.contracts, assertCurrent);
      const projection = await this.projection(compact, runtime.contracts, expected.abi, context.scope, assertCurrent);
      const evidence = await generationEvidence(projection, expected.abi);
      await this.assertDisk(store, expected, assertCurrent);
      if (options.publish === false) return { publication: { status: 'NOT_COMMITTED', generation: projection.map.generation,
        abiSaved: false, absMirrored: false, mapPublished: false }, requiresReload: false, warnings: [], evidence, abs: projection.abs };
      await store.stage({ projection, mode: 'export', inputAbs: expected.abs, abi: null, expected,
        ...(inspection ? { inputMap: expected.map } : {}) }, inspection?.committed?.pointerHash);
      assertCurrent();
      const publication = await store.commit(projection.map.generation, assertCurrent, async () => {
        throw new AbsSyncError('ABS_EXPORT_SAVE_FORBIDDEN', 'Export must not save ABI.');
      });
      if (publication.status === 'COMMITTED') {
        assertCurrent();
        this.editor.publishAbsContext(projection, snapshot.revision, context.assertCurrent);
      }
      return { publication, requiresReload: false, warnings: [], ...(publication.status === 'COMMITTED' ? { evidence, abs: projection.abs } : {}) };
    });
  }

  validateGeneration(source: string, request: AbsGenerationCandidateRequest): Promise<AbsGenerationValidation> {
    request = JSON.parse(absJson(request));
    return this.run(async (context, lease, store) => {
      const prepared = await this.prepareGeneration(context, lease, store, source, request.base.generation, request);
      return { ...request, workspaceRevision: prepared.before.revision,
        ...(request.createVariables ? { preparedVariables: planAbsVariableCreations({ requestId: request.requestId, variables: request.createVariables }) } : {}) };
    });
  }

  private async prepareGeneration(context: ReturnType<AbsWorkspaceSyncService['context']>, lease: BlocklyWorkspaceEditLease,
    store: AbsBaselineStore, source: string, generation: string, binding?: AbsGenerationCandidateRequest | AbsGenerationValidation) {
      const shapes = captureAbsDeclarativeContracts(context.definitions);
      const procedures = captureAbsBundledProcedures(context.definitions);
      const custom = captureAbsCustomFunctions(context.definitions);
      const blockContract = (type: string, extra?: unknown) => custom.get(type, extra) ?? procedures.get(type, extra) ?? shapes.get(type, extra);
      const expected = await store.captureDisk();
      if (await store.inspectPending()) throw new AbsSyncError('ABS_TRANSACTION_PENDING', 'Recover or explicitly abandon the pending generation first.');
      const baseline = await store.loadCommitted();
      if (!baseline) throw new AbsSyncError('ABS_BASELINE_MISSING', 'An authoritative committed generation is required.');
      if (generation !== baseline.map.generation) throw new AbsSyncError('ABS_BASELINE_STALE', 'The candidate belongs to another generation.');
      this.assertMirrors(baseline, expected, false);
      if (binding) {
        const evidence = await generationEvidence(baseline, expected.abi);
        if (absJson(binding.base) !== absJson(evidence.binding) || binding.candidate.hash !== await hashAbsText(source)
          || binding.candidate.bytes !== new TextEncoder().encode(source).byteLength) {
          throw new AbsSyncError('ABS_BASELINE_STALE', 'Candidate bytes or generation binding changed; no automatic rebase is allowed.');
        }
      }
      context.assertCurrent();
      const before = this.editor.captureProjectSnapshot(lease);
      if (binding && 'workspaceRevision' in binding && binding.workspaceRevision !== before.revision) {
        throw new AbsSyncError('ABS_REVISION_STALE', 'Workspace changed after candidate validation.');
      }
      const assertPreparing = this.atRevision(context.assertCurrent, lease, before.revision);
      const rollback = captureAbsWorkspaceState(context.workspace, context.assertCurrent, context.definitions);
      assertPreparing();
      const compact = await this.compactDocument(before.document, rollback.contracts, assertPreparing);
      assertAbsBaselineContext(baseline.map, {
        generation, scope: context.scope,
        currentAbiHash: await hashAbsText(absJson(compact)),
        currentPageAbiHash: await hashAbsText(absJson(composeBlocklyPage(compact, context.scope.pageId))),
        savedAbiHash: expected.abi === null ? null : await hashAbsText(absJson(JSON.parse(expected.abi))),
      });
      if (absJson(rollback.contracts) !== absJson(baseline.contracts)) {
        throw new AbsSyncError('ABS_RUNTIME_CONTRACT_STALE', 'Runtime contracts changed since this generation was exported.');
      }
      assertPreparing();
      const candidate = await prepareAbsReconciliation(baseline, source, assertPreparing, {
        declaration: captureAbsVariableDeclarations(context.definitions, shapes.get),
        argumentOrder: type => shapes.get(type)?.argumentOrder,
        fieldDefinition: (type, name, id) => custom.field(type, name) ?? rollback.fieldDefinition(type, name, id) ?? shapes.get(type)?.fields[name],
        blockContract: shapes.get, prepareBlock: (block, previous, workspace, contracts) => {
          procedures.prepare(block, previous, workspace, contracts); custom.prepare(block, previous, workspace, contracts);
        },
        ...(binding?.createVariables ? { variableCreation: { requestId: binding.requestId, variables: binding.createVariables } } : {}),
      });
      const materialized = await candidate.materialize();
      assertPreparing();
      assertAbsRuntimeShapeSupported(rollback.state, materialized, candidate.contracts, blockContract);
      this.editor.assertWorkspaceSharedChange(before.document, materialized, lease);
      await this.assertDisk(store, expected, assertPreparing);
      return { expected, before, rollback, candidate, materialized };
  }

  applyGeneration(source: string, generation: string, options: AbsWorkspaceLoadOptions = {}, validation?: AbsGenerationValidation): Promise<AbsWorkspaceSyncOutcome> {
    options = { ...options };
    if (validation) validation = JSON.parse(absJson(validation));
    return this.run(async (context, lease, store) => {
      const { expected, before, rollback, candidate, materialized } = await this.prepareGeneration(context, lease, store, source, generation, validation);

      let mutated = false, commitStarted = false;
      let publication: AbsPublishResult | undefined;
      const runtime = window['Blockly'];
      const group = runtime.Events.getGroup(), recordUndo = runtime.Events.getRecordUndo();
      const restore = () => {
        mutated = false; // Never retry a failed rollback.
        context.assertCurrent(); lease.assertCurrent();
        this.editor.restoreProjectWorkspaceSnapshot(before.document, lease);
        context.definitions.customFunctions?.synchronize(context.workspace, rollback.state);
        const restored = captureAbsWorkspaceState(context.workspace, context.assertCurrent, context.definitions);
        assertAbsReadback(rollback.state, restored.state, rollback);
      };
      try {
        mutated = true;
        await loadAbsWorkspaceState(materialized, context.workspace, options, context.assertCurrent);
        context.definitions.customFunctions?.synchronize(context.workspace, materialized);
        layoutAbsNewRoots(materialized, candidate.added, context.workspace, context.assertCurrent);
        // Library model registration belongs before complete readback and the save seal.
        const generated = await this.editor.prepareProjectCode(context.assertCurrent, lease);
        context.assertCurrent();
        const actual = captureAbsWorkspaceState(context.workspace, context.assertCurrent, context.definitions);
        assertAbsReadback(materialized, actual.state, actual);
        this.editor.assertWorkspaceSharedChange(before.document, actual.state, lease);
        const applied = this.editor.captureProjectSnapshot(lease);
        assertAbsProjectEnvelope(before.document, applied.document, context.scope.pageId);
        if (generated && generated.revision !== applied.revision) throw new AbsSyncError('ABS_RUNTIME_CAPTURE_CHANGED', 'Prepared code no longer belongs to the applied revision.');
        const assertApplied = this.atRevision(context.assertCurrent, lease, applied.revision);
        const prepared = await this.project.prepareSave(applied.document, assertApplied);
        const savedCompact = await this.compactDocument(applied.document, actual.contracts, assertApplied);
        const projection = await this.projection(savedCompact, actual.contracts, prepared.abiText, context.scope, assertApplied);
        const evidence = await generationEvidence(projection, prepared.abiText);
        await store.stage({ projection, mode: 'import', inputAbs: source, abi: prepared.abiText, expected });
        assertApplied();
        commitStarted = true;
        publication = await store.commit(projection.map.generation, assertApplied, async (text, expectedHash, storage) => {
          assertApplied();
          if (text !== prepared.abiText || !await storage.replace('project.abi', expectedHash, text)) {
            throw new AbsSyncError('ABS_ABI_COMMIT_CONFLICT', 'Prepared ABI changed before commit.');
          }
        });
        if (!publication.abiSaved) {
          restore();
          return { publication, requiresReload: false, warnings: [] };
        }
        if (publication.status !== 'COMMITTED') {
          lease.quarantine('ABI was saved but generation publication is pending; inspect and explicitly recover before reopening.');
          return { publication, requiresReload: true, warnings: [] };
        }
        assertApplied();
        const warnings: string[] = [];
        try { await this.project.publishPreparedSaveOutputs(context.path, prepared, generated, assertApplied); }
        catch (error) { warnings.push(`Generation committed; derived outputs were not fully published: ${String(error)}`); }
        assertApplied();
        this.editor.publishAbsContext(projection, applied.revision, context.assertCurrent);
        return { publication, appliedRevision: applied.revision, requiresReload: false, warnings, evidence };
      } catch (error) {
        if (mutated && context.isCurrent()) {
          if (commitStarted) {
            // An interrupted host acknowledgement or saved ABI is not safe to undo in memory.
            lease.quarantine(`Generation commit needs explicit inspection: ${String(error)}`);
          } else {
            try { restore(); }
            catch (rollbackError) {
              const reason = `Rollback failed; reopen the project: ${String(rollbackError)}. Original failure: ${String(error)}`;
              lease.quarantine(reason);
              throw new AbsSyncError('ABS_ROLLBACK_FAILED', reason);
            }
          }
        }
        throw error;
      } finally {
        if (context.isCurrent()) {
          this.editor.markWorkspaceCodeDirty();
          runtime.Events.setGroup(group); runtime.Events.setRecordUndo(recordUndo);
        }
      }
    });
  }

  /** Disk-only recovery remains callable for a quarantined editor. It never unblocks,
   * loads, saves, generates code or marks the current workspace clean. Host lock owns exclusion.
   */
  async inspectRecovery() {
    const context = this.context();
    const store = await this.store(context);
    const result = await store.inspectPending(); context.assertCurrent(); return result;
  }

  /** Public diagnostics contain hashes/scopes only; raw recovery mirrors stay inside the host. */
  async inspectGeneration() {
    const context = this.context();
    const inspection = await inspectAbsGeneration(await this.store(context), context.scope);
    context.assertCurrent();
    return { pending: inspection.pending, diagnostics: inspection.diagnostics };
  }

  async recoverGeneration(): Promise<AbsPublishResult | null> {
    const context = this.context();
    const store = await this.store(context);
    const result = await store.recover(context.assertCurrent); context.assertCurrent(); return result;
  }

  async abandonGeneration(generation: string): Promise<void> {
    const context = this.context();
    const store = await this.store(context);
    await store.abandon(generation); context.assertCurrent();
  }

  private run<T>(operation: (context: ReturnType<AbsWorkspaceSyncService['context']>, lease: BlocklyWorkspaceEditLease, store: AbsBaselineStore) => Promise<T>): Promise<T> {
    const context = this.context(); // Before queueing, not when an old task eventually starts.
    return this.editor.runProjectOperation(async () => {
      context.assertCurrent();
      const lease = this.editor.acquireWorkspaceEditLease();
      try {
        await projectDataRuntime.flushPending(); context.assertCurrent(); lease.assertCurrent();
        const store = await this.store(context);
        return await operation(context, lease, store);
      } finally { lease.release(); }
    });
  }

  private context() {
    const path = this.project.currentProjectPath, pageId = this.editor.getActivePageId(), workspace = this.editor.workspace;
    const definitions = this.editor.captureDeclarativeBlockDefinitions();
    const generator = getActiveProjectGenerator(), runtimeRevision = getActiveProjectGeneratorRevision();
    const session = projectDataRuntime.getSessionToken();
    const isCurrent = () => !!path && !!workspace && path === this.project.currentProjectPath
      && pageId === this.editor.getActivePageId() && workspace === this.editor.workspace
      && generator === getActiveProjectGenerator() && runtimeRevision === getActiveProjectGeneratorRevision()
      && session === projectDataRuntime.getSessionToken();
    const assertCurrent = () => {
      if (!isCurrent()) throw new AbsSyncError('ABS_CONTEXT_STALE', 'ABS operation belongs to a stale project/page/runtime.');
      definitions.assertCurrent();
    };
    assertCurrent();
    return { path, workspace, definitions, scope: { projectKey: path, pageId }, isCurrent, assertCurrent };
  }

  private async store(context: ReturnType<AbsWorkspaceSyncService['context']>) {
    const port = await openAbsHostStorage(context.path, context.assertCurrent);
    context.assertCurrent(); return new AbsBaselineStore(port, context.scope);
  }

  private atRevision(assertContext: () => void, lease: BlocklyWorkspaceEditLease, revision: number) {
    return () => {
      assertContext(); lease.assertCurrent();
      if (this.editor.captureProjectSnapshot(lease).revision !== revision) throw new AbsSyncError('ABS_REVISION_STALE', 'Workspace changed during generation preparation.');
    };
  }

  private async compactDocument(document: BlocklyProjectDocument, contracts: AbsProjectionContracts, assertCurrent: () => void) {
    const result = await prepareAbsProjectData(document, assertCurrent);
    assertAbsResourceContracts(composeBlocklyPage(document, document.activePageId),
      composeBlocklyPage(result.document, document.activePageId), contracts);
    assertCurrent(); return result.document;
  }

  private async projection(document: BlocklyProjectDocument, contracts: AbsProjectionContracts, abi: string | null,
    scope: AbsProjection['map']['scope'], assertCurrent: () => void) {
    const generation = crypto.randomUUID();
    const projection = await createAbsProjection(composeBlocklyPage(document, scope.pageId), { document, contracts,
      generation, baselineRef: absBaselineKey(generation), scope,
      savedAbiHash: abi === null ? null : await hashAbsText(absJson(JSON.parse(abi))) });
    assertCurrent(); return projection;
  }

  private assertMirrors(baseline: AbsProjection, disk: AbsDiskSnapshot, exporting: boolean) {
    if (disk.map !== absJson(baseline.map)) throw new AbsSyncError('ABS_MAP_INVALID', 'Public map differs from the authoritative committed baseline.');
    if (exporting && disk.abs !== baseline.abs) throw new AbsSyncError('ABS_SOURCE_CONFLICT', 'ABS contains an unapplied edit; export will not overwrite it.');
  }

  private async assertDisk(store: AbsBaselineStore, expected: AbsDiskSnapshot, assertCurrent: () => void) {
    const actual = await store.captureDisk(); assertCurrent();
    if (absJson(actual) !== absJson(expected)) throw new AbsSyncError('ABS_DISK_CONFLICT', 'Project files changed during candidate preparation.');
  }
}
