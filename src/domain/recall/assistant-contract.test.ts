import { describe, expect, it } from "vitest";
import {
  type AssistantAnswer,
  type QueryPlan,
  planDateRange,
  validateAssistantAnswer,
} from "./assistant-contract";
import type { RecallCorpusPerson } from "./types";

const reference = new Date("2026-09-22T03:00:00Z");
const plan: QueryPlan = {
  intent: "lookup",
  personName: null,
  conditions: [
    { text: "대전에서 만남", scope: "interaction" },
    { text: "양자컴퓨팅 논의", scope: "interaction" },
  ],
  sameInteraction: true,
  timeTarget: "interaction",
  actionKind: null,
  period: "yesterday",
  fromDate: null,
  toDateExclusive: null,
  clarification: null,
};
const person: RecallCorpusPerson = {
  id: "p1",
  displayName: "가상인물",
  normalizedName: "가상인물",
  headline: null,
  organizations: [],
  documentId: null,
  documentContent: "",
  evidence: [
    {
      id: "meeting1",
      type: "interaction",
      interactionId: "meeting1",
      text: "대전에서 양자컴퓨팅 논의",
      occurredAt: "2026-09-21T03:00:00Z",
      verificationStatus: "confirmed",
      memoryStatementId: null,
      memoryDocumentId: null,
      actionStatus: null,
    },
  ],
  actions: [],
};
const answer: AssistantAnswer = {
  status: "resolved",
  answer: "가상인물입니다.",
  analysis: "관련 논의를 이어갈 수 있습니다.",
  clarification: null,
  people: [
    {
      personId: "p1",
      reason: "대전에서 양자컴퓨팅을 논의했습니다.",
      evidenceKeys: ["interaction:meeting1"],
      conditionEvidence: [
        { conditionIndex: 0, evidenceKeys: ["interaction:meeting1"] },
        { conditionIndex: 1, evidenceKeys: ["interaction:meeting1"] },
      ],
      suggestion: {
        title: "논의한 주제로 연락 검토",
        rationale: "관련 논의 기록이 있습니다.",
        evidenceKeys: ["interaction:meeting1"],
      },
    },
  ],
};
describe("grounded assistant contract", () => {
  it("accepts supported same-meeting evidence and preserves canonical excerpt", () => {
    const result = validateAssistantAnswer(
      answer,
      plan,
      [person],
      "질문",
      reference,
      "test",
    );
    expect(result.results[0].evidence[0].excerpt).toBe(person.evidence[0].text);
    expect(result.results[0].suggestion?.type).toBe("ai_suggestion");
  });
  it("rejects a fabricated evidence ID", () => {
    const raw = structuredClone(answer);
    raw.people[0].evidenceKeys = ["interaction:invented"];
    expect(() =>
      validateAssistantAnswer(raw, plan, [person], "질문", reference, "test"),
    ).toThrow();
  });
  it("rejects an evidence ID belonging to another person", () => {
    const other = {
      ...person,
      id: "p2",
      evidence: [{ ...person.evidence[0], id: "other" }],
    };
    const raw = structuredClone(answer);
    raw.people[0].evidenceKeys = ["interaction:other"];
    expect(() =>
      validateAssistantAnswer(
        raw,
        plan,
        [person, other],
        "질문",
        reference,
        "test",
      ),
    ).toThrow();
  });
  it("rejects conditions supported by different meetings", () => {
    const p = structuredClone(person);
    p.evidence.push({
      ...p.evidence[0],
      id: "meeting2",
      interactionId: "meeting2",
      text: "서울에서 양자컴퓨팅 논의",
    });
    const raw = structuredClone(answer);
    raw.people[0].evidenceKeys.push("interaction:meeting2");
    raw.people[0].conditionEvidence[1].evidenceKeys = ["interaction:meeting2"];
    expect(() =>
      validateAssistantAnswer(raw, plan, [p], "질문", reference, "test"),
    ).toThrow();
  });
  it("rejects an omitted required condition", () => {
    const raw = structuredClone(answer);
    raw.people[0].conditionEvidence.pop();
    expect(() =>
      validateAssistantAnswer(raw, plan, [person], "질문", reference, "test"),
    ).toThrow();
  });
  it("rejects an encounter outside the requested calendar date", () => {
    const p = structuredClone(person);
    p.evidence[0].occurredAt = reference.toISOString();
    expect(() =>
      validateAssistantAnswer(answer, plan, [p], "질문", reference, "test"),
    ).toThrow();
  });
  it("does not substitute encounter time for an action deadline", () => {
    expect(() =>
      validateAssistantAnswer(
        answer,
        { ...plan, timeTarget: "action_due" },
        [person],
        "질문",
        reference,
        "test",
      ),
    ).toThrow();
  });
  it("rejects suggestions citing unselected sources", () => {
    const raw = structuredClone(answer);
    raw.people[0].suggestion!.evidenceKeys = ["action_item:missing"];
    expect(() =>
      validateAssistantAnswer(raw, plan, [person], "질문", reference, "test"),
    ).toThrow();
  });
  it("does not publish invented analysis on a no-result answer", () => {
    const result = validateAssistantAnswer(
      {
        ...answer,
        status: "no_result",
        people: [],
        analysis: "새로운 투자자 소개",
      },
      plan,
      [],
      "질문",
      reference,
      "test",
    );
    expect(result.analysis).toBe("");
    expect(result.results).toEqual([]);
  });
  it("uses Korean midnight across UTC day and month boundaries", () => {
    expect(
      planDateRange(
        { ...plan, period: "today" },
        new Date("2026-09-30T16:00:00Z"),
      )?.from,
    ).toBe("2026-09-30T15:00:00.000Z");
    expect(
      planDateRange(
        { ...plan, period: "last_month" },
        new Date("2026-01-01T00:00:00Z"),
      )?.from,
    ).toBe("2025-11-30T15:00:00.000Z");
  });
  it("requires clarification for a duplicate name alone", () => {
    expect(() =>
      validateAssistantAnswer(
        answer,
        { ...plan, conditions: [], personName: person.displayName },
        [person, { ...person, id: "p2" }],
        "가상인물",
        reference,
        "test",
      ),
    ).toThrow();
  });
  it("does not use an interaction summary or saved suggestion as proof of a promise", () => {
    const p = structuredClone(person);
    p.evidence.push({
      ...p.evidence[0],
      id: "proposal",
      type: "action_item",
      actionKind: "suggestion",
      actionStatus: "pending",
    });
    const raw = structuredClone(answer);
    raw.people[0].evidenceKeys.push("action_item:proposal");
    expect(() =>
      validateAssistantAnswer(
        raw,
        { ...plan, actionKind: "commitment" },
        [p],
        "약속한 사람",
        reference,
        "test",
      ),
    ).toThrow();
  });
  it("retains action kind in the API result and only returns the requested kind", () => {
    const p = structuredClone(person);
    for (const kind of ["commitment", "suggestion"] as const) {
      p.actions.push({
        id: kind,
        kind,
        title: "합성 행동",
        details: null,
        dueAt: null,
        status: "pending",
        interactionId: "meeting1",
      });
      p.evidence.push({
        ...p.evidence[0],
        id: kind,
        type: "action_item",
        actionKind: kind,
        actionStatus: "pending",
      });
    }
    const raw = structuredClone(answer);
    raw.people[0].evidenceKeys.push(
      "action_item:commitment",
      "action_item:suggestion",
    );
    const result = validateAssistantAnswer(
      raw,
      { ...plan, actionKind: "commitment" },
      [p],
      "약속한 사람",
      reference,
      "test",
    );
    expect(result.results[0].storedActions).toEqual([
      expect.objectContaining({
        kind: "commitment",
        type: "stored",
        executes: false,
      }),
    ]);
  });
});
