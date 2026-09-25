import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AiTaskExecutionError } from "./runtime-router";
import { CaptureStructuringError } from "../application/capture-service";
import { BusinessCardProcessingError } from "../application/business-card-service";
import { aiRateLimitResponse } from "./rate-limit-response";
import { captureErrorResponse } from "../../app/api/captures/response";
import { businessCardErrorResponse } from "../../app/api/business-cards/response";
it("returns 429 with wait metadata for recall", async () => {
  const r = aiRateLimitResponse(
    new AiTaskExecutionError("limited", "AI_RATE_LIMITED", false, 12),
  )!;
  expect(r.status).toBe(429);
  expect(r.headers.get("retry-after")).toBe("12");
  expect(await r.json()).toMatchObject({
    code: "AI_RATE_LIMITED",
    retryAfterSeconds: 12,
  });
});
it("preserves capture identity for retry after text or card context bursts", async () => {
  for (const r of [
    captureErrorResponse(
      new CaptureStructuringError("synthetic", "AI_RATE_LIMITED", 9),
    ),
    businessCardErrorResponse(
      new BusinessCardProcessingError("synthetic", "AI_RATE_LIMITED", 9),
    ),
  ]) {
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({
      captureId: "synthetic",
      recoverable: true,
      retryAfterSeconds: 9,
    });
  }
});
it("does not mislabel other provider failures", () => {
  expect(
    aiRateLimitResponse(
      new AiTaskExecutionError("failed", "AI_TIMEOUT", false),
    ),
  ).toBeNull();
});
