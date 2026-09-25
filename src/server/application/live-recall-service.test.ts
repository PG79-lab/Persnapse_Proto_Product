import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryPlan } from "../../domain/recall/assistant-contract";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  structured: vi.fn(),
  embed: vi.fn(),
  rerank: vi.fn(),
  ready: vi.fn(),
  retrieve: vi.fn(),
  corpus: vi.fn(),
}));
vi.mock("../ai/assistant-provider", () => ({
  AssistantProvider: class {
    metrics = [];
    structured = mocks.structured;
    embed = mocks.embed;
    rerank = mocks.rerank;
  },
}));
vi.mock("../db/ai-run-repository", () => ({
  createAiAttemptRecorder: () => vi.fn(),
}));
vi.mock("../db/ai-budget-repository", () => ({ reserveAiCall: vi.fn() }));
vi.mock("../db/memory-search-repository", () => ({
  assertSearchReady: mocks.ready,
  retrieveMemoryCandidates: mocks.retrieve,
}));
vi.mock("../db/recall-repository", () => ({ loadRecallCorpus: mocks.corpus }));
vi.mock("../env", () => ({
  getServerEnv: () => ({
    VOYAGE_EMBEDDING_MODEL: "test-embedding",
    OPENAI_STRUCTURING_MODEL: "test-structure",
    OPENAI_MAIN_AGENT_MODEL: "test-main",
  }),
}));
import { executeLiveRecall } from "./live-recall-service";
const plan: QueryPlan = {
  intent: "lookup",
  personName: null,
  conditions: [],
  sameInteraction: false,
  timeTarget: "interaction",
  period: "none",
  fromDate: null,
  toDateExclusive: null,
  clarification: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.ready.mockResolvedValue(undefined);
  mocks.structured.mockResolvedValueOnce(plan);
  mocks.embed.mockResolvedValue([0.1]);
  mocks.retrieve.mockResolvedValue([{ person_id: "p1", content: "가상 기록" }]);
  mocks.rerank.mockResolvedValue([0]);
  mocks.corpus.mockResolvedValue([
    {
      id: "p1",
      displayName: "가상인물",
      normalizedName: "가상인물",
      headline: null,
      organizations: [],
      documentId: null,
      documentContent: "",
      actions: [],
      evidence: [
        {
          id: "i1",
          type: "interaction",
          interactionId: "i1",
          text: "대전 양자컴퓨팅 논의",
          occurredAt: "2026-10-04T15:00:00.000Z",
          verificationStatus: "confirmed",
          memoryStatementId: null,
          memoryDocumentId: null,
          actionStatus: null,
        },
      ],
    },
  ]);
});
describe("live Recall wiring without paid calls", () => {
  it("connects query understanding, semantic retrieval and grounded reasoning", async () => {
    mocks.structured.mockResolvedValueOnce({
      status: "resolved",
      answer: "가상인물입니다.",
      analysis: "논의 기록",
      clarification: null,
      people: [
        {
          personId: "p1",
          reason: "대전 논의",
          evidenceKeys: ["interaction:i1"],
          conditionEvidence: [],
          suggestion: null,
        },
      ],
    });
    const result = await executeLiveRecall(
      "workspace",
      "대전에서 이야기한 사람",
      new Date("2026-09-22T03:00:00Z"),
    );
    expect(result.mode).toBe("live");
    expect(result.results[0].evidence[0].excerpt).toContain("양자컴퓨팅");
    expect(mocks.structured).toHaveBeenCalledTimes(2);
    expect(
      mocks.structured.mock.calls[1][4].people[0].evidence[0].occurredAt,
    ).toBe("2026-10-05T00:00:00.000+09:00");
    expect(mocks.embed).toHaveBeenCalledTimes(1);
    expect(mocks.rerank).toHaveBeenCalledTimes(1);
    expect(mocks.corpus).toHaveBeenCalledWith("workspace", ["p1"]);
  });
  it("blocks all model calls when the index is incomplete", async () => {
    mocks.ready.mockRejectedValue(new Error("SEARCH_NOT_READY"));
    await expect(executeLiveRecall("w", "query", new Date())).rejects.toThrow(
      "SEARCH_NOT_READY",
    );
    expect(mocks.structured).not.toHaveBeenCalled();
  });
  it("does not spend retrieval/reasoning calls on clarification", async () => {
    mocks.structured.mockReset().mockResolvedValue({
      ...plan,
      clarification: "어느 행사를 말씀하시나요?",
    });
    const result = await executeLiveRecall("w", "그 행사 사람", new Date());
    expect(result.status).toBe("ambiguous");
    expect(mocks.embed).not.toHaveBeenCalled();
  });
  it("rejects invented evidence instead of presenting a polished answer", async () => {
    mocks.structured.mockResolvedValueOnce({
      status: "resolved",
      answer: "정답",
      analysis: "",
      clarification: null,
      people: [
        {
          personId: "p1",
          reason: "근거",
          evidenceKeys: ["interaction:made-up"],
          conditionEvidence: [],
          suggestion: null,
        },
      ],
    });
    await expect(
      executeLiveRecall("w", "query", new Date()),
    ).rejects.toMatchObject({ code: "AI_EVIDENCE_INVALID" });
  });
});
