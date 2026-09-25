import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { AssistantProvider } from "./assistant-provider";
import { parseServerEnv } from "../env";
const env = parseServerEnv({
  NEXT_PUBLIC_SUPABASE_URL: "https://example.test",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test",
  DATABASE_URL: "postgresql://test:test@localhost/test",
  APP_DEFAULT_WORKSPACE_ID: "00000000-0000-4000-8000-000000000001",
  OPENAI_API_KEY: "synthetic",
  VOYAGE_API_KEY: "synthetic",
});
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
describe("bounded AI provider", () => {
  it("reserves budget before any network request", async () => {
    const reserve = vi.fn().mockRejectedValue(new Error("BUDGET"));
    await expect(
      new AssistantProvider(env, reserve).embed("text", "query"),
    ).rejects.toThrow("BUDGET");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects incompatible embedding dimensions", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ data: [{ embedding: [1, 2] }] }),
    );
    await expect(
      new AssistantProvider(env, vi.fn()).embed("text", "query"),
    ).rejects.toThrow();
  });
  it("sets document/query role and records provider tokens", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        data: [{ embedding: Array(1024).fill(0.1) }],
        usage: { total_tokens: 12 },
      }),
    );
    const provider = new AssistantProvider(env, vi.fn());
    expect(await provider.embed("문서", "document")).toHaveLength(1024);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.input_type).toBe("document");
    expect(body.truncation).toBe(false);
    expect(provider.metrics[0].totalTokens).toBe(12);
  });
  it("never retries or silently substitutes a failed provider", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 429 }));
    await expect(
      new AssistantProvider(env, vi.fn()).embed("text", "query"),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("validates answer shape after structured output", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        output: [{ content: [{ type: "output_text", text: '{"answer":12}' }] }],
      }),
    );
    await expect(
      new AssistantProvider(env, vi.fn()).structured(
        "answer",
        "test",
        z.object({ answer: z.string() }).strict(),
        "instructions",
        {},
      ),
    ).rejects.toThrow();
  });
  it("uses store=false and caps output", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        output: [
          { content: [{ type: "output_text", text: '{"answer":"확인"}' }] },
        ],
      }),
    );
    await new AssistantProvider(env, vi.fn()).structured(
      "answer",
      "test",
      z.object({ answer: z.string() }).strict(),
      "instructions",
      {},
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.store).toBe(false);
    expect(body.max_output_tokens).toBe(2400);
  });
  it("rejects nonexistent reranker indices", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ data: [{ index: 2, relevance_score: 0.8 }] }),
    );
    await expect(
      new AssistantProvider(env, vi.fn()).rerank("q", ["doc"]),
    ).rejects.toThrow();
  });
});
