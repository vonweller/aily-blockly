export const DEFAULT_AILY_CHAT_TOOL_ID = 'aily-chat';

/**
 * The embedded tool stack is ordered from lowest to highest z-index. Select
 * the highest Aily Chat entry so host-side quick actions follow the surface
 * the user most recently brought to the front.
 */
export function resolvePreferredAilyChatTool(
  openToolList: readonly string[],
): string {
  return findPreferredAilyChatTool(openToolList) || DEFAULT_AILY_CHAT_TOOL_ID;
}

/**
 * Return the open Aily Chat without applying the default fallback.
 * Block-selection projection uses this variant so selecting a Blockly block
 * does not implicitly open a chat that the user has not opened.
 */
export function findPreferredAilyChatTool(
  openToolList: readonly string[],
): string | null {
  for (let index = openToolList.length - 1; index >= 0; index -= 1) {
    const toolId = openToolList[index];
    if (toolId === DEFAULT_AILY_CHAT_TOOL_ID) {
      return toolId;
    }
  }

  return null;
}
