import { describe, expect, it } from "vitest";
import { koreanOffsetInstant } from "./date-range";

describe("Korean dates supplied to the answer model", () => {
  it("preserves the instant while displaying an October 5 midnight deadline", () => {
    const stored = "2026-10-04T15:00:00.000Z";
    const displayed = koreanOffsetInstant(stored);
    expect(displayed).toBe("2026-10-05T00:00:00.000+09:00");
    expect(Date.parse(displayed!)).toBe(Date.parse(stored));
  });
  it("handles a year boundary", () => {
    expect(koreanOffsetInstant("2026-12-31T18:00:00Z")).toBe(
      "2027-01-01T03:00:00.000+09:00",
    );
  });
  it("keeps unknown dates unknown", () => {
    expect(koreanOffsetInstant(null)).toBeNull();
    expect(koreanOffsetInstant(undefined)).toBeNull();
  });
});
