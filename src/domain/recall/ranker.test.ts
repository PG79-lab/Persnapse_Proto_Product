import { describe, expect, it } from "vitest";

import { parseRecallQuery } from "./query-parser";
import { buildRecallResponse } from "./ranker";
import type { RecallCorpusPerson } from "./types";

function person(
  id: string,
  displayName: string,
  organization: string,
  evidenceText: string,
): RecallCorpusPerson {
  return {
    id,
    displayName,
    normalizedName: displayName,
    headline: organization,
    organizations: [organization],
    documentId: `document-${id}`,
    documentContent: `${displayName} ${organization} ${evidenceText}`,
    evidence: [
      {
        id: `memory-${id}`,
        type: "memory_statement",
        text: evidenceText,
        occurredAt: "2026-09-03T00:00:00.000Z",
        verificationStatus: "confirmed",
        memoryStatementId: `memory-${id}`,
        memoryDocumentId: null,
        actionStatus: null,
      },
    ],
    actions: [],
  };
}

describe("recall ranker", () => {
  it("does not collapse people who share the same name", () => {
    const query = parseRecallQuery("김민준", new Date("2026-09-15T00:00:00Z"));
    const response = buildRecallResponse(
      "김민준",
      query,
      [
        person("one", "김민준", "한울 모빌리티", "부산 물류 실증"),
        person("two", "김민준", "한울 모빌리티 랩", "경로 최적화 연구"),
      ],
      1,
    );

    expect(response.status).toBe("ambiguous");
    expect(response.results).toHaveLength(2);
  });

  it("ranks a qualified duplicate name by confirmed context", () => {
    const text = "한울 모빌리티 랩에서 경로 최적화를 연구하는 김민준";
    const query = parseRecallQuery(text, new Date("2026-09-15T00:00:00Z"));
    const response = buildRecallResponse(
      text,
      query,
      [
        person("one", "김민준", "한울 모빌리티", "부산 물류 실증"),
        person("two", "김민준", "한울 모빌리티 랩", "경로 최적화 연구"),
      ],
      1,
    );

    expect(response.status).toBe("resolved");
    expect(response.results[0]?.personId).toBe("two");
    expect(response.results[0]?.evidence[0]?.verificationStatus).toBe(
      "confirmed",
    );
  });

  it("returns no result when confirmed memory has no matching context", () => {
    const text = "고대 악기 복원 연주 전문가";
    const query = parseRecallQuery(text, new Date("2026-09-15T00:00:00Z"));
    const response = buildRecallResponse(
      text,
      query,
      [
        person("one", "김민준", "한울 모빌리티", "부산 물류 실증"),
        person("two", "이서연", "브릿지 벤처스", "투자 검토 기준"),
      ],
      1,
    );

    expect(response.status).toBe("no_result");
    expect(response.results).toEqual([]);
    expect(response.answer).toContain("찾지 못했습니다");
  });
});
