import { describe, expect, it } from "vitest";

import {
  assertCaptureSessionTransition,
  canTransitionCaptureSession,
} from "./capture-state";

describe("capture session state", () => {
  it("allows review, correction, failure recovery, and one final commit", () => {
    expect(canTransitionCaptureSession("draft", "review")).toBe(true);
    expect(canTransitionCaptureSession("review", "draft")).toBe(true);
    expect(canTransitionCaptureSession("review", "committed")).toBe(true);
    expect(canTransitionCaptureSession("failed", "review")).toBe(true);
  });

  it("keeps committed sessions terminal", () => {
    expect(canTransitionCaptureSession("committed", "review")).toBe(false);
    expect(() => assertCaptureSessionTransition("committed", "draft")).toThrow(
      "cannot transition",
    );
  });
});
