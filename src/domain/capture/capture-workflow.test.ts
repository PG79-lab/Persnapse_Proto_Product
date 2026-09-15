import { describe, expect, it } from "vitest";

import {
  captureCommitResultSchema,
  captureIdentityChoiceSchema,
  createTextCaptureRequestSchema,
} from "./capture-workflow";

describe("capture workflow contracts", () => {
  it("requires an explicit identity decision", () => {
    expect(
      captureIdentityChoiceSchema.safeParse({
        mode: "existing",
        personId: "00000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(true);
    expect(
      captureIdentityChoiceSchema.safeParse({ mode: "existing" }).success,
    ).toBe(false);
    expect(captureIdentityChoiceSchema.safeParse({}).success).toBe(false);
  });

  it("bounds raw capture text and requires a retry-safe key", () => {
    expect(
      createTextCaptureRequestSchema.safeParse({
        rawText: "김하늘님과 물류 실증 후속을 이야기했다.",
        idempotencyKey: "00000000-0000-4000-8000-000000000099",
      }).success,
    ).toBe(true);
    expect(
      createTextCaptureRequestSchema.safeParse({
        rawText: "짧음",
        idempotencyKey: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("rejects malformed persisted commit results", () => {
    expect(
      captureCommitResultSchema.safeParse({
        kind: "text_capture_v1",
        personId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
});
