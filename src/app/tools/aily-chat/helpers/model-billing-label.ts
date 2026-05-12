const DEFAULT_AUTO_PRESET_ID = 'auto';
const AUTO_MODEL_DISCOUNT_FACTOR = 0.9;

export function isDefaultAutoPresetIdentifier(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === DEFAULT_AUTO_PRESET_ID;
}

export function isDefaultAutoPresetSelected(
  model: { presetId?: unknown; model?: unknown } | null | undefined,
): boolean {
  return isDefaultAutoPresetIdentifier(model?.presetId) || isDefaultAutoPresetIdentifier(model?.model);
}

export function formatBillingMultiplierLabel(multiplier: number): string {
  const normalizedMultiplier = Number.isInteger(multiplier)
    ? multiplier.toFixed(0)
    : multiplier.toFixed(multiplier * 10 === Math.trunc(multiplier * 10) ? 1 : 2);
  return `${normalizedMultiplier}x`;
}

export function parseBillingMultiplierLabel(label: string | null | undefined): number | undefined {
  if (typeof label !== 'string') {
    return undefined;
  }

  const match = label.trim().match(/^(?:x\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*x)$/i);
  if (!match) {
    return undefined;
  }

  const value = Number(match[1] ?? match[2]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function applyAutoDiscountToBillingLabel(label: string | null | undefined): string | undefined {
  if (typeof label !== 'string' || !label.trim()) {
    return undefined;
  }

  const multiplier = parseBillingMultiplierLabel(label);
  if (multiplier === undefined) {
    return label.trim();
  }

  return formatBillingMultiplierLabel(multiplier * AUTO_MODEL_DISCOUNT_FACTOR);
}