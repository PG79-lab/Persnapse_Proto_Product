export function aiRateLimitResponse(error: unknown): Response | null {
  if (
    !error ||
    typeof error !== "object" ||
    !("code" in error) ||
    !["AI_RATE_LIMITED", "AI_PROVIDER_RATE_LIMITED"].includes(
      String(error.code),
    )
  )
    return null;
  const providerLimited = error.code === "AI_PROVIDER_RATE_LIMITED";
  const retry =
    "retryAfterSeconds" in error &&
    typeof error.retryAfterSeconds === "number" &&
    Number.isFinite(error.retryAfterSeconds)
      ? Math.min(
          providerLimited ? 3600 : 60,
          Math.max(1, Math.ceil(error.retryAfterSeconds)),
        )
      : 60;
  return Response.json(
    {
      error: providerLimited
        ? `AI 제공자의 호출 제한에 도달했습니다. 약 ${retry}초 후 다시 시도해 주세요.`
        : `짧은 시간에 요청이 몰렸습니다. 약 ${retry}초 후 다시 시도해 주세요.`,
      code: providerLimited ? "AI_PROVIDER_RATE_LIMITED" : "AI_RATE_LIMITED",
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
