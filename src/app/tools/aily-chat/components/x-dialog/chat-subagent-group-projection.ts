import { ChatPart, getSubAgentInvocationId, isSubagentChildPart } from '../../core/chat-parts';
import { isProgressMessageDisplayPart, type RenderableChatPart } from './chat-render-parts';
import {
  buildActivityGroupIdentity,
  buildChatPartIdentity,
  isGroupableActivityPart,
  isSubagentToolCall,
} from './chat-activity-group-projection';
import { ChatPerformanceTracer } from '../../services/chat-perf-tracer';

export interface PartRenderItem {
  kind: 'part';
  id: string;
  part: RenderableChatPart;
}

export interface ActivityGroupRenderItem {
  kind: 'group';
  id: string;
  parts: readonly ChatPart[];
  live: boolean;
}

export type ChatRenderItem = PartRenderItem | ActivityGroupRenderItem;

export function buildChatRenderItems(
  parts: readonly RenderableChatPart[],
  doing: boolean,
): ChatRenderItem[] {
  const startedAt = performance.now();
  const baseItems = buildBaseRenderItems(parts);
  const items = markLiveActivityGroups(baseItems, doing);
  const groupCount = items.filter((item) => item.kind === 'group').length;
  const subagentGroupCount = items.filter((item) => item.kind === 'group'
    && item.parts.some((part) => isSubagentToolCall(part))).length;
  const scopedSubagentChildCount = countScopedSubagentChildren(parts);
  const legacyChildCount = countLegacySubagentChildren(parts);

  ChatPerformanceTracer.recordDuration(
    'message_parts_projection',
    performance.now() - startedAt,
    `parts=${parts.length},items=${items.length},groups=${groupCount},subagentGroups=${subagentGroupCount},scopedChildren=${scopedSubagentChildCount},legacyChildren=${legacyChildCount},doing=${doing}`,
    { slowThresholdMs: 6 },
  );
  ChatPerformanceTracer.recordJankSnapshot('message_parts_projection', {
    parts: parts.length,
    items: items.length,
    groups: groupCount,
    subagentGroups: subagentGroupCount,
    scopedSubagentChildren: scopedSubagentChildCount,
    legacySubagentChildren: legacyChildCount,
    doing,
  });

  return items;
}

function buildBaseRenderItems(parts: readonly RenderableChatPart[]): ChatRenderItem[] {
  const items: ChatRenderItem[] = [];
  let buffer: ChatPart[] = [];
  let bufferStartIndex = -1;

  const flushBuffer = (): void => {
    if (buffer.length >= 1) {
      items.push({
        kind: 'group',
        id: buildActivityGroupIdentity(buffer, Math.max(0, bufferStartIndex)),
        parts: buffer,
        live: false,
      });
    }
    buffer = [];
    bufferStartIndex = -1;
  };

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (isIgnorablePart(part)) {
      continue;
    }

    if (isProgressMessageDisplayPart(part)) {
      flushBuffer();
      items.push({ kind: 'part', id: `progress:${part.progressKind}:${index}:${part.content}`, part });
      continue;
    }

    if (isSubagentToolCall(part)) {
      flushBuffer();
      const subagentGroup = collectSubagentGroup(parts, index, part);
      if (subagentGroup.parts.length > 1) {
        items.push({
          kind: 'group',
          id: buildActivityGroupIdentity(subagentGroup.parts, index),
          parts: subagentGroup.parts,
          live: false,
        });
        index = subagentGroup.endIndex;
        continue;
      }

      items.push({ kind: 'part', id: buildChatPartIdentity(part, index), part });
      continue;
    }

    if (isGroupableActivityPart(part)) {
      if (buffer.length === 0) {
        bufferStartIndex = index;
      }
      buffer.push(part);
      continue;
    }
    flushBuffer();
    items.push({ kind: 'part', id: buildChatPartIdentity(part, index), part });
  }

  flushBuffer();
  return items;
}

function markLiveActivityGroups(items: readonly ChatRenderItem[], doing: boolean): ChatRenderItem[] {
  if (!doing || items.length === 0) {
    return items.map((item) => item.kind === 'group' ? { ...item, live: false } : item);
  }

  return items.map((item, index) => item.kind === 'group'
    ? { ...item, live: !hasLookAheadBoundary(items, index) }
    : item);
}

function hasLookAheadBoundary(items: readonly ChatRenderItem[], groupIndex: number): boolean {
  for (let index = groupIndex + 1; index < items.length; index++) {
    if (items[index].kind === 'part') {
      return true;
    }
  }

  return false;
}

function collectSubagentGroup(
  parts: readonly RenderableChatPart[],
  startIndex: number,
  parent: ChatPart,
): { parts: readonly ChatPart[]; endIndex: number } {
  const startedAt = performance.now();
  const subAgentInvocationId = getSubAgentInvocationId(parent) || (parent.type === 'tool_call' ? parent.toolCallId : undefined);
  if (!subAgentInvocationId) {
    ChatPerformanceTracer.recordDuration(
      'message_parts_scoped_subagent_group',
      performance.now() - startedAt,
      `missingSubAgent=true,start=${startIndex}`,
      { slowThresholdMs: 3 },
    );
    return { parts: [parent], endIndex: startIndex };
  }

  const group: ChatPart[] = [parent];
  let endIndex = startIndex;

  for (let index = startIndex + 1; index < parts.length; index += 1) {
    const candidate = parts[index];
    if (isProgressMessageDisplayPart(candidate)) {
      break;
    }
    if (isIgnorablePart(candidate)) {
      continue;
    }
    if (!isSubagentChildPart(candidate)) {
      break;
    }
    if (getSubAgentInvocationId(candidate) !== subAgentInvocationId) {
      break;
    }

    group.push(candidate);
    endIndex = index;
  }

  ChatPerformanceTracer.increment('message_parts.scoped_subagent_group.count');
  ChatPerformanceTracer.increment('message_parts.scoped_subagent_group.children', Math.max(0, group.length - 1));
  ChatPerformanceTracer.recordDuration(
    'message_parts_scoped_subagent_group',
    performance.now() - startedAt,
    `start=${startIndex},end=${endIndex},children=${Math.max(0, group.length - 1)},parts=${parts.length},subAgent=${subAgentInvocationId}`,
    { slowThresholdMs: 3 },
  );

  return { parts: group, endIndex };
}

function isIgnorablePart(part: RenderableChatPart): boolean {
  if (isProgressMessageDisplayPart(part)) {
    return part.content.trim().length === 0;
  }

  return part.type === 'markdown' && part.content.trim().length === 0;
}

function countLegacySubagentChildren(parts: readonly RenderableChatPart[]): number {
  let count = 0;
  for (const part of parts) {
    if (part.type !== 'tool_call') {
      continue;
    }
    const toolSpecificData = part.metadata?.['toolSpecificData'];
    if (!toolSpecificData || typeof toolSpecificData !== 'object') {
      continue;
    }
    const childItems = (toolSpecificData as Record<string, unknown>)['childItems'];
    if (Array.isArray(childItems)) {
      count += childItems.length;
    }
  }
  return count;
}

function countScopedSubagentChildren(parts: readonly RenderableChatPart[]): number {
  let count = 0;
  for (const part of parts) {
    if (isProgressMessageDisplayPart(part)) {
      continue;
    }
    if (isSubagentChildPart(part)) {
      count += 1;
    }
  }
  return count;
}
