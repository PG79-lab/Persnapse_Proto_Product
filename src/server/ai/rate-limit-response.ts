export function aiRateLimitResponse(error: unknown): Response | null {
  if (
    !error ||
    typeof error !== "object" ||
    !("code" in error) ||
    error.code !== "AI_RATE_LIMITED"
  )
    return null;
  const retry =
    "retryAfterSeconds" in error &&
    typeof error.retryAfterSeconds === "number" &&
    Number.isFinite(error.retryAfterSeconds)
      ? Math.min(60, Math.max(1, Math.ceil(error.retryAfterSeconds)))
      : 60;
  return Response.json(
    {
      error: `짧은 시간에 요청이 몰렸습니다. 약 ${retry}초 후 다시 시도해 주세요.`,
      code: "AI_RATE_LIMITED",
      retryAfterSeconds: retry,
      ...("captureId" in error
        ? { captureId: error.captureId, recoverable: true }
        : {}),
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retry),
        "Cache-Control": "private, no-store",
      },
    },
  );
}
