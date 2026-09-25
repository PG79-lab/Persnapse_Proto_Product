import { describe, expect, it } from "vitest";
import { parseRecallQuery } from "./query-parser";
import { buildRecallResponse } from "./ranker";
import type { RecallCorpusPerson } from "./types";
const reference = new Date("2026-09-22T03:00:00Z");
function fixture(dueAt: string | null = null): RecallCorpusPerson {
  return {
    id: "p",
    displayName: "검토용 가상인물",
    normalizedName: "검토용 가상인물",
    headline: "식품 포장 담당",
    organizations: ["합성 제조사"],
    documentId: null,
    documentContent: "서울 공장에서 식품 포장 공정 검토",
    evidence: [
      {
        id: "i",
        type: "interaction",
        text: "서울 공장에서 식품 포장 공정 검토",
        occurredAt: "2026-08-15T03:00:00Z",
        verificationStatus: "confirmed",
        memoryStatementId: null,
        memoryDocumentId: null,
        actionStatus: null,
      },
      {
        id: "a",
        type: "action_item",
        text: "포장 샘플 전달",
        occurredAt: "2026-08-15T03:00:00Z",
        dueAt,
        verificationStatus: "confirmed",
        memoryStatementId: null,
        memoryDocumentId: null,
        actionStatus: "pending",
      },
    ],
    actions: [
      {
        id: "a",
        title: "포장 샘플 전달",
        details: null,
        dueAt,
        status: "pending",
      },
    ],
  };
}
describe("handoff counterexamples", () => {
  for (const query of [
    "지난달 제주에서 만난 양자컴퓨팅 투자자",
    "양자컴퓨팅 투자자에게 연락해야 할 사람",
  ]) {
    it("does not manufacture relevance from bonuses: " + query, () => {
      expect(
        buildRecallResponse(
          query,
          parseRecallQuery(query, reference),
          [fixture()],
          1,
        ).status,
      ).toBe("no_result");
    });
  }
  it("does not return next month's commitment as today's task", () => {
    const query = "오늘 내가 무엇을 해야하지?";
    expect(
      buildRecallResponse(
        query,
        parseRecallQuery(query, reference),
        [fixture("2026-10-20T03:00:00Z")],
        1,
      ).status,
    ).toBe("no_result");
  });
  it("still retrieves a supported explicit packaging question", () => {
    const query = "식품 포장 공정 검토한 사람";
    expect(
      buildRecallResponse(
        query,
        parseRecallQuery(query, reference),
        [fixture()],
        1,
      ).results[0].personId,
    ).toBe("p");
  });
  it("returns a real task due today instead of refusing every action query", () => {
    const query = "오늘 내가 무엇을 해야하지?";
    expect(
      buildRecallResponse(
        query,
        parseRecallQuery(query, reference),
        [fixture(reference.toISOString())],
        1,
      ).results[0].storedActions[0].id,
    ).toBe("a");
  });
});
