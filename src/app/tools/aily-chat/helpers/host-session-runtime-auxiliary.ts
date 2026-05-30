import type { SessionSnapshot } from 'aily-lex/browser';

import type { HostSessionRecord, HostSessionRuntimeAuxiliary, SessionMetadata } from '../services/chat-history.service';
import { cloneSessionRequestContextSnapshot } from './turn-request-prompt-context';

type SessionRequestContextSnapshot = NonNullable<SessionSnapshot['requestContext']>;

export function cloneHostSessionRuntimeAuxiliary(
  auxiliary: Partial<HostSessionRuntimeAuxiliary> | null | undefined,
): HostSessionRuntimeAuxiliary | undefined {
  if (!auxiliary) {
    return undefined;
  }

  const requestContext = cloneSessionRequestContextSnapshot(auxiliary.requestContext);
  const activeSkillNames = normalizeActiveSkillNames(auxiliary.activeSkillNames);
  if (!requestContext && !activeSkillNames?.length) {
    return undefined;
  }

  return {
    ...(requestContext ? { requestContext } : {}),
    ...(activeSkillNames?.length ? { activeSkillNames } : {}),
  };
}

export function resolveHostSessionRuntimeAuxiliary(
  record: Pick<HostSessionRecord, 'auxiliary' | 'metadata'>,
): HostSessionRuntimeAuxiliary | undefined {
  return cloneHostSessionRuntimeAuxiliary(
    record.auxiliary ?? {
      requestContext: record.metadata.requestContext,
      activeSkillNames: record.metadata.activeSkillNames,
    },
  );
}

export function resolveHostSessionRequestContext(
  record: Pick<HostSessionRecord, 'auxiliary' | 'metadata'>,
): SessionRequestContextSnapshot | undefined {
  return resolveHostSessionRuntimeAuxiliary(record)?.requestContext;
}

export function resolveHostSessionActiveSkillNames(
  record: Pick<HostSessionRecord, 'auxiliary' | 'metadata'>,
): readonly string[] | undefined {
  return resolveHostSessionRuntimeAuxiliary(record)?.activeSkillNames;
}

export function stripLegacyRuntimeAuxiliaryFromMetadata<T extends Partial<SessionMetadata>>(metadata: T): T {
  const { requestContext: _requestContext, activeSkillNames: _activeSkillNames, ...rest } = metadata;
  return rest as T;
}

function normalizeActiveSkillNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const names = Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map(entry => entry.trim()),
  )).sort((left, right) => left.localeCompare(right));

  return names.length > 0 ? names : undefined;
}