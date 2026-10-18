import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { retryPolicy } from "./assistant-index-worker";
describe("index retry policy", () => {
  it("caps transient retries and respects provider Retry-After", () => {
    expect(retryPolicy("AI_HTTP_503", 1)).toMatchObject({
      status: "failed",
      delay: 30,
    });
    expect(retryPolicy("AI_PROVIDER_RATE_LIMITED", 2, 600)).toMatchObject({
      status: "failed",
      delay: 600,
    });
    expect(retryPolicy("AI_REQUEST_FAILED", 3).status).toBe("dead");
  });
  it("does not loop on invalid credentials, schema or input", () => {
    for (const code of [
      "AI_CONFIGURATION_ERROR",
      "AI_HTTP_401",
      "AI_SCHEMA_INVALID",
      "AI_INPUT_TOO_LONG",
    ])
      expect(retryPolicy(code, 1).status).toBe("dead");
  });
  it("pauses without consuming a provider attempt at the local budget limit", () => {
    expect(retryPolicy("AI_RATE_LIMITED", 1, 3600)).toEqual({
      status: "pending",
      delay: 3600,
      refund: true,
    });
  });
});
