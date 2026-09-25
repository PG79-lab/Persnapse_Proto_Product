import { describe, expect, it } from "vitest";
import { evaluateOcrCostPolicy } from "./ocr-cost-policy";
const now = new Date("2026-09-22T03:00:00Z");
const snapshot = {
  latestReservationAt: new Date(now.getTime() - 2000),
  oldestRecentReservationAt: new Date(now.getTime() - 59000),
  recentReservations: 19,
};
describe("OCR burst-only policy", () => {
  it("allows the 20th request without a daily or monthly budget", () => {
    expect(evaluateOcrCostPolicy(snapshot, now)).toEqual({ allowed: true });
  });
  it("blocks the 21st request until the oldest slot expires", () => {
    expect(
      evaluateOcrCostPolicy({ ...snapshot, recentReservations: 20 }, now),
    ).toEqual({
      allowed: false,
      code: "OCR_RATE_LIMITED",
      retryAfterSeconds: 1,
    });
  });
  it("retains the one-second burst spacing", () => {
    expect(
      evaluateOcrCostPolicy(
        { ...snapshot, latestReservationAt: new Date(now.getTime() - 200) },
        now,
      ),
    ).toEqual({
      allowed: false,
      code: "OCR_RATE_LIMITED",
      retryAfterSeconds: 1,
    });
  });
  it("allows an empty rolling window", () => {
    expect(
      evaluateOcrCostPolicy(
        {
          latestReservationAt: null,
          oldestRecentReservationAt: null,
          recentReservations: 0,
        },
        now,
      ),
    ).toEqual({ allowed: true });
  });
});
