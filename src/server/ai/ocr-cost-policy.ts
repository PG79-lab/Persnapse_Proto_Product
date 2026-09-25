export const clovaOcrCostPolicy = Object.freeze({
  minimumIntervalMs: 1_000,
  windowMs: 60_000,
  burstLimit: 20,
  reservationLeaseMs: 2 * 60_000,
});
export type OcrCostLimitCode = "OCR_RATE_LIMITED";
export type OcrCostDecision =
  | { allowed: true }
  | { allowed: false; code: OcrCostLimitCode; retryAfterSeconds: number };
export interface OcrUsageSnapshot {
  latestReservationAt: Date | null;
  recentReservations: number;
  oldestRecentReservationAt: Date | null;
}
export function evaluateOcrCostPolicy(
  snapshot: OcrUsageSnapshot,
  now = new Date(),
): OcrCostDecision {
  const burstWait =
    snapshot.recentReservations >= clovaOcrCostPolicy.burstLimit
      ? Math.max(
          1,
          clovaOcrCostPolicy.windowMs -
            (now.getTime() -
              (snapshot.oldestRecentReservationAt?.getTime() ?? now.getTime())),
        )
      : 0;
  const intervalWait = snapshot.latestReservationAt
    ? Math.max(
        0,
        clovaOcrCostPolicy.minimumIntervalMs -
          (now.getTime() - snapshot.latestReservationAt.getTime()),
      )
    : 0;
  const wait = Math.max(burstWait, intervalWait);
  return wait > 0
    ? {
        allowed: false,
        code: "OCR_RATE_LIMITED",
        retryAfterSeconds: Math.min(60, Math.max(1, Math.ceil(wait / 1000))),
      }
    : { allowed: true };
}
