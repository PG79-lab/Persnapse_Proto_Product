import { describe, expect, it } from "vitest";

import { parseRecallQuery } from "./query-parser";

describe("recall query parser", () => {
  it("resolves last month against an explicit reference time", () => {
    const parsed = parseRecallQuery(
      "지난달 동남아 시장 리서치를 공유한 사람",
      new Date("2026-09-15T12:00:00+09:00"),
    );

    expect(parsed.dateRange).toEqual({
      from: "2026-07-31T15:00:00.000Z",
      to: "2026-08-31T15:00:00.000Z",
      label: "지난달",
    });
    expect(parsed.intents).toContain("time");
    expect(parsed.terms).toContain("동남아");
  });

  it("detects action intent and removes generic words", () => {
    const parsed = parseRecallQuery(
      "내가 제안서를 보내기로 한 사람",
      new Date("2026-09-15T00:00:00Z"),
    );

    expect(parsed.intents).toContain("action");
    expect(parsed.terms).toContain("제안서");
    expect(parsed.terms).not.toContain("사람");
  });
});
