import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ sql: vi.fn(), database: vi.fn() }));
vi.mock("./client", () => ({ getDatabase: mocks.database }));
import { reserveAiCall } from "./ai-budget-repository";
import { parseServerEnv } from "../env";
const env = parseServerEnv({
  NEXT_PUBLIC_SUPABASE_URL: "https://example.test",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic",
  DATABASE_URL: "postgresql://test:test@localhost/test",
  APP_DEFAULT_WORKSPACE_ID: "00000000-0000-4000-8000-000000000001",
  AI_ROUTING_MODE: "live",
  AI_LIVE_DAILY_CALL_LIMIT: "0",
  AI_LIVE_MONTHLY_CALL_LIMIT: "0",
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.database.mockReturnValue({
    begin: (fn: (sql: unknown) => Promise<void>) => fn(mocks.sql),
  });
});
it("requires explicit live mode", async () => {
  await expect(
    reserveAiCall(env.APP_DEFAULT_WORKSPACE_ID, "embedding", {
      ...env,
      AI_ROUTING_MODE: "mock",
    }),
  ).rejects.toMatchObject({ code: "AI_LIVE_DISABLED" });
  expect(mocks.database).not.toHaveBeenCalled();
});
it("ignores obsolete cumulative limits and allows a quiet window", async () => {
  mocks.sql
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ recent: 0, retry_after: 1 }])
    .mockResolvedValueOnce([]);
  await reserveAiCall(env.APP_DEFAULT_WORKSPACE_ID, "mainAgent", env);
  expect(mocks.sql).toHaveBeenCalledTimes(3);
  expect(mocks.sql.mock.calls[1][0].join(" ")).toContain(
    "interval '60 seconds'",
  );
  expect(mocks.sql.mock.calls[1][0].join(" ")).not.toContain("date_trunc");
});
it("allows the 60th request and blocks the 61st without reserving", async () => {
  mocks.sql
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ recent: 59, retry_after: 9 }])
    .mockResolvedValueOnce([]);
  await reserveAiCall(env.APP_DEFAULT_WORKSPACE_ID, "mainAgent", env);
  mocks.sql.mockClear();
  mocks.sql
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ recent: 60, retry_after: 9 }]);
  await expect(
    reserveAiCall(env.APP_DEFAULT_WORKSPACE_ID, "mainAgent", env),
  ).rejects.toMatchObject({
    code: "AI_RATE_LIMITED",
    retryAfterSeconds: 9,
    retryable: false,
  });
  expect(mocks.sql).toHaveBeenCalledTimes(2);
});
it("fails closed when the shared ledger cannot be read", async () => {
  mocks.sql
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(
    reserveAiCall(env.APP_DEFAULT_WORKSPACE_ID, "embedding", env),
  ).rejects.toThrow("storage unavailable");
  expect(mocks.sql).toHaveBeenCalledTimes(2);
});
