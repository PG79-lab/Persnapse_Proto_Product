import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  embed: vi.fn(),
  mode: "live",
}));
vi.mock("./client", () => ({ getDatabase: () => mocks.sql }));
vi.mock("../env", () => ({
  getServerEnv: () => ({
    AI_ROUTING_MODE: mocks.mode,
    VOYAGE_EMBEDDING_MODEL: "test-model",
  }),
}));
vi.mock("../ai/assistant-provider", () => ({
  AssistantProvider: class {
    embed = mocks.embed;
  },
}));
vi.mock("./ai-budget-repository", () => ({ reserveAiCall: vi.fn() }));
vi.mock("./ai-run-repository", () => ({
  createAiAttemptRecorder: () => vi.fn(),
}));
import {
  assertSearchReady,
  getSearchPreparationStatus,
  indexPersonMemory,
  listRetryableMemoryPeople,
} from "./memory-search-repository";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.mode = "live";
});
describe("search index recovery boundaries", () => {
  it("counts ready, missing and actively processing records without claiming completeness", async () => {
    mocks.sql.mockResolvedValue([{ total: 5, prepared: 2, processing: 1 }]);
    expect(
      await getSearchPreparationStatus("w1", "test-model", "live"),
    ).toEqual({
      mode: "live",
      ready: false,
      total: 5,
      prepared: 2,
      processing: 1,
      remaining: 3,
      retryable: 2,
    });
  });
  it("an incomplete index blocks live recall before a provider call", async () => {
    mocks.sql.mockResolvedValue([{ incomplete: 1 }]);
    await expect(assertSearchReady("w1", "test-model")).rejects.toMatchObject({
      code: "SEARCH_NOT_READY",
    });
    expect(mocks.embed).not.toHaveBeenCalled();
  });
  it("an active lease in another request makes no duplicate embedding call", async () => {
    mocks.sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ready: false }]);
    await expect(indexPersonMemory("w1", "p1")).rejects.toMatchObject({
      code: "SEARCH_NOT_READY",
    });
    expect(mocks.embed).not.toHaveBeenCalled();
  });
  it("a completed document makes a repeated preparation a no-op", async () => {
    mocks.sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ready: true }]);
    await indexPersonMemory("w1", "p1");
    expect(mocks.embed).not.toHaveBeenCalled();
  });
  it("a failed provider does not publish ready and leaves the document retryable", async () => {
    mocks.sql
      .mockResolvedValueOnce([
        {
          id: "d1",
          content: "synthetic confirmed memory",
          content_hash: "hash1",
        },
      ])
      .mockResolvedValueOnce([]);
    mocks.embed.mockRejectedValue(new Error("provider failed"));
    await expect(indexPersonMemory("w1", "p1")).rejects.toThrow(
      "provider failed",
    );
    expect(mocks.sql.mock.calls[1][0].join("")).toContain(
      "embedding_status = 'failed'",
    );
    expect(mocks.sql.mock.calls[1]).toContain("hash1");
  });
  it("a concurrent content change rejects a stale vector instead of overwriting the new document", async () => {
    mocks.sql
      .mockResolvedValueOnce([
        { id: "d1", content: "synthetic", content_hash: "hash1" },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.embed.mockResolvedValue(Array.from({ length: 1024 }, () => 0.1));
    await expect(indexPersonMemory("w1", "p1")).rejects.toMatchObject({
      code: "SEARCH_STALE",
    });
    expect(mocks.sql.mock.calls[1]).toContain("hash1");
  });
  it("retry targets remain workspace scoped and exclude the active two-minute lease", async () => {
    mocks.sql.mockResolvedValue([{ person_id: "p1" }]);
    expect(await listRetryableMemoryPeople("w1", "test-model", 2)).toEqual([
      "p1",
    ]);
    expect(mocks.sql.mock.calls[0]).toContain("w1");
    expect(mocks.sql.mock.calls[0]).toContain(2);
    expect(mocks.sql.mock.calls[0][0].join("")).toContain(
      "interval '2 minutes'",
    );
  });
});
