export function formatQuotaResetLabel(resetAt: string | undefined): string | undefined {
  if (!resetAt) {
    return undefined;
  }

  const normalized = resetAt.trim();
  if (!normalized) {
    return undefined;
  }

  const resetAtMs = Date.parse(normalized);
  if (!Number.isFinite(resetAtMs)) {
    return `Resets ${normalized}.`;
  }

  const resetDate = new Date(resetAtMs);
  const now = new Date();
  const includeYear = resetDate.getFullYear() !== now.getFullYear();
  const dateOptions: Intl.DateTimeFormatOptions = includeYear
    ? { month: 'long', day: 'numeric', year: 'numeric' }
    : { month: 'long', day: 'numeric' };
  const dateLabel = new Intl.DateTimeFormat(undefined, dateOptions).format(resetDate);
  if (!hasExplicitResetTime(normalized)) {
    return `Resets ${dateLabel}.`;
  }

  const timeLabel = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(resetDate);
  return `Resets ${dateLabel} at ${timeLabel}.`;
}

export function appendQuotaResetLabel(
  message: string,
  resetAt: string | undefined,
): string {
  const resetLabel = formatQuotaResetLabel(resetAt);
  return resetLabel ? `${message} ${resetLabel}` : message;
}

export function trimQuotaResetLabel(label: string | undefined): string | undefined {
  return label?.replace(/[.]$/, '');
}

function hasExplicitResetTime(resetAt: string): boolean {
  return !/^\d{4}-\d{2}-\d{2}$/.test(resetAt);
}