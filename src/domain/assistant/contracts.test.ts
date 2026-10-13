import { describe, it, expect } from "vitest";
import {
  emptyContext,
  nextContext,
  validateSections,
  type AssistantPlan,
} from "./contracts";
import { buildContextPack, fuseCandidates, filterEvidence } from "./retrieval";
import type {
  RecallResponse,
  RecallCorpusPerson,
  RecallCorpusEvidence,
} from "../recall/types";
const plan: AssistantPlan = {
  ...emptyContext(),
  intent: "lookup",
  personName: null,
  conditions: [],
  sameInteraction: false,
  timeTarget: "interaction",
  actionKind: null,
  period: "none",
  fromDate: null,
  toDateExclusive: null,
  clarification: null,
};
const evidence = (
  id: string,
  meeting: string,
  date: string,
): RecallCorpusEvidence => ({
  id,
  type: "memory_statement",
  interactionId: meeting,
  text: id,
  occurredAt: date,
  verificationStatus: "confirmed",
  memoryStatementId: id,
  memoryDocumentId: null,
  actionStatus: null,
});
describe("assistant context and grounded retrieval", () => {
  it("does not select a person from several ranked results", () => {
    const response = {
      status: "resolved",
      results: [
        { personId: "a", displayName: "민수", evidence: [] },
        { personId: "b", displayName: "지수", evidence: [] },
      ],
    } as unknown as RecallResponse;
    const next = nextContext(plan, response);
    expect(next.personIds).toEqual([]);
    expect(next.choices).toHaveLength(2);
  });
  it("retains one validated subject but never guesses a meeting among several", () => {
    const response = {
      status: "resolved",
      results: [
        {
          personId: "a",
          displayName: "민수",
          evidence: [
            { type: "interaction", id: "m1" },
            { type: "interaction", id: "m2" },
          ],
        },
      ],
    } as unknown as RecallResponse;
    expect(nextContext(plan, response).personIds).toEqual(["a"]);
    expect(nextContext(plan, response).interactionId).toBeNull();
  });
  it("does not let sections cite unselected or obsolete evidence", () => {
    const section = {
      type: "interpretation" as const,
      title: "연결",
      text: "관련성",
      evidenceKeys: ["memory_statement:x"],
    };
    const corpus = [
      { evidence: [evidence("x", "m", "2026-10-13T00:00:00Z")] },
    ] as RecallCorpusPerson[];
    expect(() =>
      validateSections([section], corpus, {
        status: "resolved",
        results: [],
      } as unknown as RecallResponse),
    ).toThrow();
    expect(() =>
      validateSections([section], [], {
        status: "resolved",
        results: [{ evidence: corpus[0].evidence }],
      } as unknown as RecallResponse),
    ).toThrow();
  });
  it("applies independent due and meeting bounds in Korean time", () => {
    const e = {
      ...evidence("a", "m", "2026-10-09T15:00:00Z"),
      type: "action_item" as const,
      dueAt: "2026-10-15T15:00:00Z",
      actionStatus: "pending" as const,
    };
    const p = {
      ...plan,
      meetingRange: { from: "2026-10-10", toExclusive: "2026-10-11" },
      dueRange: { from: "2026-10-16", toExclusive: "2026-10-17" },
    };
    expect(filterEvidence(e, p)).toBe(true);
    expect(filterEvidence({ ...e, dueAt: "2026-10-16T15:00:00Z" }, p)).toBe(
      false,
    );
    expect(filterEvidence({ ...e, actionStatus: "completed" }, p)).toBe(false);
  });
  it("fuses ranks instead of incompatible raw scores and deduplicates", () => {
    const a = { key: "a", personIds: ["p"], content: "a", sourceKeys: ["a"] };
    const b = { ...a, key: "b" };
    expect(fuseCandidates([[a, a, b], [b]]).map((c) => c.key)).toEqual([
      "b",
      "a",
    ]);
  });
  it("keeps selected atomic facts and excludes another meeting when specified", () => {
    const person = {
      id: "p",
      evidence: [
        evidence("old", "m1", "2026-10-01T00:00:00Z"),
        evidence("target", "m2", "2026-10-02T00:00:00Z"),
      ],
      actions: [],
    } as unknown as RecallCorpusPerson;
    const pack = buildContextPack(
      [person],
      [
        {
          key: "x",
          personIds: ["p"],
          content: "",
          sourceKeys: ["memory_statement:target"],
        },
      ],
      { ...plan, interactionId: "m2" },
    );
    expect(pack.people[0].evidence.map((e) => e.id)).toEqual(["target"]);
  });
});
