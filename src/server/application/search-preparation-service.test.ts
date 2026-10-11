import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  mode: "live" as "live" | "mock",
  status: vi.fn(),
  people: vi.fn(),
  rebuild: vi.fn(),
  index: vi.fn(),
}));
vi.mock("../env", () => ({
  getServerEnv: () => ({
    AI_ROUTING_MODE: mocks.mode,
    VOYAGE_EMBEDDING_MODEL: "test-model",
  }),
}));
vi.mock("../db/capture-repository", () => ({
  rebuildPersonMemoryDocument: mocks.rebuild,
}));
vi.mock("../db/memory-search-repository", () => ({
  getSearchPreparationStatus: mocks.status,
  listRetryableMemoryPeople: mocks.people,
  indexPersonMemory: mocks.index,
}));
import { AiTaskExecutionError } from "../ai/runtime-router";
import {
  inspectSearchPreparation,
  prepareSearch,
} from "./search-preparation-service";
const remaining = {
  mode: "live",
  ready: false,
  total: 3,
  prepared: 1,
  remaining: 2,
  retryable: 2,
  processing: 0,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.mode = "live";
  mocks.status.mockResolvedValue(remaining);
  mocks.people.mockResolvedValue(["p1", "p2"]);
  mocks.index.mockResolvedValue(undefined);
  mocks.rebuild.mockResolvedValue(undefined);
});
describe("search preparation with explicit bounded work", () => {
  it("status inspection never indexes or generates an answer", async () => {
    expect(await inspectSearchPreparation("w1")).toEqual(remaining);
    expect(mocks.status).toHaveBeenCalledWith("w1", "test-model", "live");
    expect(mocks.index).not.toHaveBeenCalled();
    expect(mocks.rebuild).not.toHaveBeenCalled();
  });
  it("mock mode never prepares real embeddings or rewrites projections", async () => {
    mocks.mode = "mock";
    const result = await prepareSearch("w1");
    expect(result.attemptedCount).toBe(0);
    expect(mocks.people).not.toHaveBeenCalled();
    expect(mocks.index).not.toHaveBeenCalled();
    expect(mocks.rebuild).not.toHaveBeenCalled();
  });
  it("prepares two people sequentially in the server workspace and reports fresh readiness", async () => {
    mocks.status.mockResolvedValue({
      ...remaining,
      ready: true,
      prepared: 3,
      remaining: 0,
      retryable: 0,
    });
    const result = await prepareSearch("w1");
    expect(mocks.people).toHaveBeenCalledWith("w1", "test-model", 2);
    expect(mocks.rebuild.mock.calls).toEqual([
      ["w1", "p1"],
      ["w1", "p2"],
    ]);
    expect(mocks.index.mock.calls).toEqual([
      ["w1", "p1"],
      ["w1", "p2"],
    ]);
    expect(mocks.index.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rebuild.mock.invocationCallOrder[1],
    );
    expect(result).toMatchObject({
      attemptedCount: 2,
      completedCount: 2,
      failureCount: 0,
      status: { ready: true },
    });
  });
  it("one provider failure preserves completed work and never changes canonical memories", async () => {
    mocks.index.mockRejectedValueOnce(new Error("provider failed"));
    expect(await prepareSearch("w1")).toMatchObject({
      attemptedCount: 2,
      completedCount: 1,
      failureCount: 1,
      status: { ready: false },
    });
    expect(mocks.index).toHaveBeenCalledTimes(2);
  });
  it("a burst limit stops the batch and returns a bounded retry delay", async () => {
    mocks.index.mockRejectedValueOnce({
      code: "AI_RATE_LIMITED",
      retryAfterSeconds: 8.2,
    });
    expect(await prepareSearch("w1")).toMatchObject({
      attemptedCount: 1,
      completedCount: 0,
      retryAfterSeconds: 9,
    });
    expect(mocks.index).toHaveBeenCalledTimes(1);
    expect(mocks.rebuild).toHaveBeenCalledTimes(1);
  });
  it("another worker's active lease causes no automatic duplicate attempt", async () => {
    mocks.index.mockRejectedValueOnce(
      new AiTaskExecutionError("busy", "SEARCH_NOT_READY", false),
    );
    expect(await prepareSearch("w1")).toMatchObject({
      attemptedCount: 1,
      retryAfterSeconds: 2,
    });
    expect(mocks.index).toHaveBeenCalledTimes(1);
  });
  it("a provider cooldown stops the batch instead of spending another attempt", async () => {
    mocks.index.mockRejectedValueOnce(
      new AiTaskExecutionError(
        "limited",
        "AI_PROVIDER_RATE_LIMITED",
        false,
        125,
      ),
    );
    expect(await prepareSearch("w1")).toMatchObject({
      attemptedCount: 1,
      completedCount: 0,
      failureCount: 1,
      retryAfterSeconds: 125,
    });
    expect(mocks.index).toHaveBeenCalledTimes(1);
  });
  it("ready documents are not indexed again on a repeated submission", async () => {
    mocks.people.mockResolvedValue([]);
    mocks.status.mockResolvedValue({
      ...remaining,
      ready: true,
      prepared: 3,
      remaining: 0,
      retryable: 0,
    });
    expect(await prepareSearch("w1")).toMatchObject({
      attemptedCount: 0,
      completedCount: 0,
      status: { ready: true },
    });
    expect(mocks.index).not.toHaveBeenCalled();
    expect(mocks.rebuild).not.toHaveBeenCalled();
  });
});
