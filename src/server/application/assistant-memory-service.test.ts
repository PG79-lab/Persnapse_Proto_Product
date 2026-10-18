import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  emptyContext,
  type AssistantPlan,
} from "../../domain/assistant/contracts";
const mocks = vi.hoisted(() => ({
  structured: vi.fn(),
  embed: vi.fn(),
  rerank: vi.fn(),
  canonical: vi.fn(),
  vectors: vi.fn(),
  readiness: vi.fn(),
  corpus: vi.fn(),
  mode: "live",
}));
vi.mock("server-only", () => ({}));
vi.mock("../ai/assistant-provider", () => ({
  AssistantProvider: class {
    metrics = [];
    structured = mocks.structured;
    embed = mocks.embed;
    rerank = mocks.rerank;
  },
}));
vi.mock("../env", () => ({
  getServerEnv: () => ({
    AI_ROUTING_MODE: mocks.mode,
    OPENAI_STRUCTURING_MODEL: "structure",
    OPENAI_MAIN_AGENT_MODEL: "main",
    VOYAGE_EMBEDDING_MODEL: "embedding",
  }),
}));
vi.mock("../db/ai-budget-repository", () => ({ reserveAiCall: vi.fn() }));
vi.mock("../db/ai-run-repository", () => ({
  createAiAttemptRecorder: () => vi.fn(),
}));
vi.mock("../db/assistant-search-repository", () => ({
  listAssistantPeople: async () => [
    { id: "20000000-0000-4000-8000-000000000001", name: "민수" },
  ],
  validateContextSelection: async () => true,
  retrieveCanonicalCandidates: mocks.canonical,
  retrieveUnitVectors: mocks.vectors,
  inspectUnitReadiness: mocks.readiness,
  attachAssistantProvenance: async () => {},
}));
vi.mock("../db/recall-repository", () => ({ loadRecallCorpus: mocks.corpus }));
import {
  executeAssistantMemory,
  localAssistantPlan,
} from "./assistant-memory-service";
const p = "20000000-0000-4000-8000-000000000001";
const plan: AssistantPlan = {
  ...emptyContext(),
  intent: "analysis",
  personName: "민수",
  personIds: [p],
  conditions: [],
  sameInteraction: false,
  timeTarget: "interaction",
  actionKind: null,
  period: "none",
  fromDate: null,
  toDateExclusive: null,
  clarification: null,
  purpose: "summarize",
};
const raw = {
  status: "resolved",
  answer: "민수의 진행 상황입니다.",
  analysis: "",
  clarification: null,
  people: [
    {
      personId: p,
      reason: "기록",
      evidenceKeys: ["memory_statement:f"],
      conditionEvidence: [],
      suggestion: null,
    },
  ],
  sections: [
    {
      type: "fact",
      title: "관심사",
      text: "AI 도입 관심",
      evidenceKeys: ["memory_statement:f"],
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.mode = "live";
  mocks.structured.mockResolvedValueOnce(plan).mockResolvedValueOnce(raw);
  mocks.canonical.mockResolvedValue({
    candidates: [
      {
        key: "memory_statement:f",
        personIds: [p],
        content: "AI 관심",
        sourceKeys: ["memory_statement:f"],
      },
    ],
    truncated: false,
  });
  mocks.readiness.mockResolvedValue({
    prepared: 0,
    total: 10,
    missingProjection: false,
  });
  mocks.corpus.mockResolvedValue([
    {
      id: p,
      displayName: "민수",
      headline: null,
      organizations: [],
      documentContent: "",
      actions: [],
      evidence: [
        {
          id: "f",
          type: "memory_statement",
          text: "AI 도입 관심",
          occurredAt: null,
          verificationStatus: "confirmed",
          memoryStatementId: "f",
          memoryDocumentId: null,
          actionStatus: null,
        },
      ],
    },
  ]);
});
describe("assistant memory orchestration", () => {
  it("answers from current records even when every vector is pending", async () => {
    const result = await executeAssistantMemory({
      workspaceId: "w",
      query: "민수 진행 상황",
    });
    expect(result.response.status).toBe("resolved");
    expect(result.coverage.status).toBe("limited");
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(result.sections[0].type).toBe("fact");
  });
  it("clarifies before retrieval and billable answer generation", async () => {
    mocks.structured
      .mockReset()
      .mockResolvedValue({ ...plan, clarification: "어느 만남인가요?" });
    const result = await executeAssistantMemory({
      workspaceId: "w",
      query: "그때 이야기",
    });
    expect(result.response.status).toBe("ambiguous");
    expect(mocks.canonical).not.toHaveBeenCalled();
    expect(mocks.structured).toHaveBeenCalledTimes(1);
  });
  it("does not interpret missing results as an exhaustive absence", async () => {
    mocks.canonical.mockResolvedValue({ candidates: [], truncated: false });
    const result = await executeAssistantMemory({
      workspaceId: "w",
      query: "민수 관심사",
    });
    expect(result.response.answer).toContain("확인 가능한 검색 범위");
  });
  it("rejects a polished section with invented source keys", async () => {
    mocks.structured
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce({
        ...raw,
        sections: [
          { ...raw.sections[0], evidenceKeys: ["memory_statement:invented"] },
        ],
      });
    await expect(
      executeAssistantMemory({ workspaceId: "w", query: "민수 상황" }),
    ).rejects.toMatchObject({ code: "AI_EVIDENCE_INVALID" });
  });
  it("falls back to keyword records on vector outage without hiding degraded coverage", async () => {
    mocks.readiness.mockResolvedValue({
      prepared: 8,
      total: 10,
      missingProjection: false,
    });
    mocks.embed.mockRejectedValue(
      Object.assign(new Error("outage"), { code: "AI_HTTP_503" }),
    );
    const result = await executeAssistantMemory({
      workspaceId: "w",
      query: "민수 상황",
    });
    expect(result.response.status).toBe("resolved");
    expect(result.coverage.reasons.some((r) => r.includes("지연"))).toBe(true);
  });
  it("provides only records when answer provider fails", async () => {
    mocks.structured
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockRejectedValueOnce(
        Object.assign(new Error("outage"), { code: "AI_REQUEST_FAILED" }),
      );
    const result = await executeAssistantMemory({
      workspaceId: "w",
      query: "민수 상황",
    });
    expect(result.sections).toEqual([]);
    expect(result.response.answer).toContain("근거 목록");
  });
  it("local reference resolution never picks the first of multiple choices", () => {
    const context = {
      ...emptyContext(),
      choices: [
        { id: p, name: "민수" },
        { id: "q", name: "지수" },
      ],
    };
    expect(
      localAssistantPlan("그 사람에게 연락 준비", context, []).clarification,
    ).toBeTruthy();
    expect(
      localAssistantPlan("그 사람에게 연락 준비", context, [], {
        personIds: [p],
      }).personIds,
    ).toEqual([p]);
  });
  it("distinguishes an explicit comparison of two people from duplicate names", () => {
    const people = [
      { id: p, name: "민수" },
      { id: "20000000-0000-4000-8000-000000000002", name: "지수" },
    ];
    const comparison = localAssistantPlan(
      "민수와 지수 관심사 비교",
      emptyContext(),
      people,
    );
    expect(comparison.personIds).toHaveLength(2);
    expect(comparison.clarification).toBeNull();
    const duplicate = localAssistantPlan("민수 관심사", emptyContext(), [
      { id: p, name: "민수" },
      { id: people[1].id, name: "민수" },
    ]);
    expect(duplicate.clarification).toContain("동명이인");
  });
  it("prepares a future meeting from past evidence instead of filtering to future records", async () => {
    mocks.structured
      .mockReset()
      .mockResolvedValueOnce({
        ...plan,
        purpose: "prepare",
        timeTarget: "interaction",
        period: "range",
        fromDate: "2027-01-01",
        toDateExclusive: "2027-01-02",
        meetingRange: { from: "2027-01-01", toExclusive: "2027-01-02" },
      })
      .mockResolvedValueOnce(raw);
    await executeAssistantMemory({
      workspaceId: "w",
      query: "민수와 다음 만남을 준비해줘",
    });
    const actual = mocks.canonical.mock.calls[0][2];
    expect(actual.meetingRange).toBeNull();
    expect(actual.period).toBe("none");
  });
  it("treats shortening instructions as output format, not evidence conditions", async () => {
    mocks.structured
      .mockReset()
      .mockResolvedValueOnce({
        ...plan,
        purpose: "prepare",
        conditions: [{ text: "질문 세 개", scope: "interaction" }],
        actionKind: "commitment",
        sameInteraction: true,
      })
      .mockResolvedValueOnce(raw);
    await executeAssistantMemory({
      workspaceId: "w",
      query: "확인할 질문 세 개로 줄여줘",
      context: { ...emptyContext(), personIds: [p], purpose: "prepare" },
    });
    const actual = mocks.canonical.mock.calls[0][2];
    expect(actual.conditions).toEqual([]);
    expect(actual.actionKind).toBeNull();
    expect(actual.sameInteraction).toBe(false);
  });
  it("rejects facts that changed while the answer was being generated", async () => {
    const original = await mocks.corpus();
    mocks.corpus
      .mockReset()
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce([{ ...original[0], evidence: [] }]);
    await expect(
      executeAssistantMemory({ workspaceId: "w", query: "민수 상황" }),
    ).rejects.toMatchObject({ code: "AI_EVIDENCE_STALE" });
  });
});
