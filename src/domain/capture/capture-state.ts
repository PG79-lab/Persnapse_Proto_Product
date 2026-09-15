export const captureSessionStates = [
  "draft",
  "review",
  "committed",
  "failed",
] as const;

export type CaptureSessionState = (typeof captureSessionStates)[number];

const allowedTransitions: Readonly<
  Record<CaptureSessionState, readonly CaptureSessionState[]>
> = {
  draft: ["review", "failed"],
  review: ["draft", "committed", "failed"],
  failed: ["draft", "review"],
  committed: [],
};

export function canTransitionCaptureSession(
  from: CaptureSessionState,
  to: CaptureSessionState,
): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertCaptureSessionTransition(
  from: CaptureSessionState,
  to: CaptureSessionState,
): void {
  if (!canTransitionCaptureSession(from, to)) {
    throw new Error(`Capture session cannot transition from ${from} to ${to}.`);
  }
}
