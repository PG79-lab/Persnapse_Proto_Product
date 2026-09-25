import type { RecallDateRange } from "./types";

/** Calendar boundaries use the product's explicit Asia/Seoul timezone. */
export function koreanDayRange(
  reference: Date,
  offset: number,
  label: string,
): RecallDateRange {
  const shifted = new Date(reference.getTime() + 9 * 3_600_000);
  const start =
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() + offset,
    ) -
    9 * 3_600_000;
  return {
    from: new Date(start).toISOString(),
    to: new Date(start + 86_400_000).toISOString(),
    label,
  };
}

export function withinRange(
  value: string | null,
  range: RecallDateRange | null,
): boolean {
  return (
    !range ||
    (value !== null &&
      Date.parse(value) >= Date.parse(range.from) &&
      Date.parse(value) < Date.parse(range.to))
  );
}

/** Preserve the instant while exposing its Korean calendar date to the LLM. */
export function koreanOffsetInstant(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  return new Date(Date.parse(value) + 9 * 3_600_000)
    .toISOString()
    .replace("Z", "+09:00");
}
