export interface UserTurnPayload {
  llmText: string;
  displayText: string;
}

/**
 * Builds the user-visible text and LLM payload for a new main-agent turn.
 *
 * Display text keeps resource context visible to the user while edit feedback
 * stays LLM-only.
 */
export function buildUserTurnPayload(
  text: string,
  resourcesText?: string | null,
  editFeedback?: string | null,
): UserTurnPayload {
  let contextPrefix = '';
  if (editFeedback) contextPrefix += editFeedback + '\n';
  if (resourcesText) contextPrefix += resourcesText + '\n\n';

  if (!contextPrefix) {
    return { llmText: text, displayText: text };
  }

  return {
    llmText: contextPrefix + text,
    displayText: (resourcesText ? resourcesText + '\n\n' : '') + text,
  };
}