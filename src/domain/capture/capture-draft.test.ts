import { describe, expect, it } from "vitest";

import { captureDraftV1Schema } from "./capture-draft";

const validDraft = {
  schemaVersion: "capture-draft-v1",
  identityHint: {
    displayName: "김민준",
    organizationName: "한울 모빌리티",
    title: "사업개발 리드",
  },
  interaction: {
    interactionType: "event",
    occurredAt: "2026-09-03T10:00:00+09:00",
    summary: "부산 물류 실증과 제안서 전달을 논의했다.",
    location: "코엑스",
    eventName: "스마트 물류 포럼",
  },
  topics: ["물류 실증"],
  memories: [
    {
      statementType: "context",
      body: "부산에서 실증 파트너를 찾고 있다.",
      occurredAt: "2026-09-03T10:00:00+09:00",
    },
  ],
  actions: [
    {
      kind: "commitment",
      title: "파일럿 제안서 전달",
      details: null,
      dueAt: null,
    },
  ],
  inferredFields: ["identityHint.title"],
} as const;

describe("capture draft v1 contract", () => {
  it("accepts a bounded, editable relationship-memory draft", () => {
    expect(captureDraftV1Schema.parse(validDraft)).toEqual(validDraft);
  });

  it("rejects unknown fields and unbounded candidate collections", () => {
    expect(
      captureDraftV1Schema.safeParse({ ...validDraft, rawProviderOutput: {} })
        .success,
    ).toBe(false);
    expect(
      captureDraftV1Schema.safeParse({
        ...validDraft,
        topics: Array.from({ length: 13 }, (_, index) => `topic-${index}`),
      }).success,
    ).toBe(false);
  });
});
