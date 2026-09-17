import { Injectable } from '@angular/core';
import { AbsWorkspaceSyncService } from './abs-workspace-sync.service';
import { assertGenerationCandidate, assertGenerationRequest, assertGenerationValidation } from './abs-generation-protocol';
import { AbsSyncError } from './abs-state';
import { absJson } from './abs-identity-map';

/** Wire adaptation only. Preparation, leases, publication and recovery belong to the coordinator. */
@Injectable({ providedIn: 'root' })
export class AbsGenerationToolsService {
  constructor(private readonly sync: AbsWorkspaceSyncService) {}

  capabilities(input: Record<string, any>) { return this.sync.describeCapabilities(input); }

  async execute(operation: string, input: Record<string, any>, source?: string, onProgress?: (blocks: number, batches: number) => void) {
    try {
      const { abs, absPath, ...wire } = input;
      const params: Record<string, any> = JSON.parse(absJson(wire));
      assertGenerationRequest(params);
      if (operation === 'abs_projection') {
        if (!/^sha256:[a-f0-9]{64}$/.test(params['expectedAbiHash'])
          || ['initialize', 'publish'].some(key => params[key] !== undefined && typeof params[key] !== 'boolean')
          || params['rebind'] !== undefined && (typeof params['rebind'] !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(params['rebind']))) {
          throw new AbsSyncError('ABS_REQUEST_INVALID', 'Invalid generation export options.');
        }
        const result = await this.sync.exportGeneration({ initialize: params['initialize'], publish: params['publish'], expectedAbiHash: params['expectedAbiHash'], rebind: params['rebind'] });
        const ok = !!result.evidence && (params['publish'] === false || result.publication.status === 'COMMITTED');
        return { ...result, ok, operation, project: result.evidence?.binding.scope.projectKey,
          ...(ok ? { receipt: { version: 2, requestId: params.requestId, base: result.evidence!.binding,
            output: result.evidence, persisted: params['publish'] !== false, ...(params['rebind'] ? { rebind: params['rebind'] } : {}),
            validation: { ok: true, scope: 'generation-projection' } } } : {}) };
      }
      if (operation === 'abs_recovery') {
        const reply = { operation, receipt: { version: 2, requestId: params.requestId, action: params['action'] } };
        if (params['action'] === 'inspect') return { ...reply, ok: true, ...await this.sync.inspectGeneration(), requiresReload: false };
        if (params['action'] === 'recover') {
          const publication = await this.sync.recoverGeneration();
          return { ...reply, ok: !publication || publication.status === 'COMMITTED' || publication.status === 'NOT_COMMITTED',
            publication, requiresReload: publication !== null };
        }
        if (params['action'] === 'abandon' && typeof params['generation'] === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(params['generation'])) {
          await this.sync.abandonGeneration(params['generation']);
          return { ...reply, ok: true, requiresReload: true };
        }
        throw new AbsSyncError('ABS_REQUEST_INVALID', 'Recovery requires inspect, recover, or abandon with an explicit generation.');
      }
      if (typeof source !== 'string' || !source.trim()) throw new AbsSyncError('ABS_REQUEST_INVALID', 'Candidate source is empty.');
      if (operation === 'abs_validate') {
        assertGenerationCandidate(params);
        const { syntaxAdvice, ...prepared } = await this.sync.validateGeneration(source, params);
        return { ok: true, operation, project: prepared.base.scope.projectKey, syntaxAdvice,
          receipt: { ...prepared, validation: { ok: true, scope: 'prepared-generation' } } };
      }
      if (operation !== 'abs_apply') throw new AbsSyncError('ABS_REQUEST_INVALID', 'Unknown ABS generation operation.');
      const validation: Record<string, any> = params['validation'];
      assertGenerationValidation(validation);
      if (validation.requestId !== params.requestId || validation['validation']?.scope !== 'prepared-generation'
        || validation['validation']?.ok !== true || params['chunk'] !== undefined && typeof params['chunk'] !== 'boolean') {
        throw new AbsSyncError('ABS_REQUEST_INVALID', 'Apply requires the matching preparation receipt.');
      }
      const result = await this.sync.applyGeneration(source, validation.base.generation, { chunk: params['chunk'] === true, onProgress }, validation);
      const ok = result.publication.status === 'COMMITTED' && !result.requiresReload && result.appliedRevision !== undefined && !!result.evidence;
      return { ...result, ok, operation, project: validation.base.scope.projectKey,
        ...(ok ? { receipt: { ...validation, output: result.evidence,
          appliedRevision: result.appliedRevision, validation: { ok: true, scope: 'complete-generation' } } } : {}) };
    } catch (error) {
      return { ok: false, operation, code: (error as any)?.code || 'ABS_GENERATION_FAILED',
        ...((error as any)?.code === 'ABS_IDENTITY_AMBIGUOUS' ? {
          recovery: 'Keep the current generation and unapplied draft. Use one edit call with multiple targeted replacements from the generation source so the host can trace call identities, then validate/apply the whole batch. A full rewrite may lack identity evidence. Do not add IDs to ABS, discard the map or force export over the draft.',
        } : {}),
        message: error instanceof Error ? error.message : String(error) };
    }
  }
}
