import { getServerEnv } from "../../../../server/env";
import { assertPrototypeAccess } from "../../../../server/security/prototype-access";

export const runtime = "nodejs";
export const maxDuration = 20;
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string) =>
  Response.json({ error }, { status, headers });

export async function POST(request: Request) {
  try {
    assertPrototypeAccess(request);
  } catch {
    return fail(403, "이 환경에서는 실시간 전사를 사용할 수 없습니다.");
  }
  const url = new URL(request.url);
  const protocol =
    request.headers.get("x-forwarded-proto") === "https"
      ? "https:"
      : url.protocol;
  const origin = request.headers.get("origin");
  if (
    request.headers.get("x-persnapse-stt") !== "1" ||
    (origin &&
      origin !== `${protocol}//${request.headers.get("host") ?? url.host}`)
  )
    return fail(403, "잘못된 실시간 전사 요청입니다.");
  let input: { language?: unknown; hints?: unknown };
  try {
    const reader = request.body?.getReader();
    if (!reader) return fail(400, "실시간 전사 설정을 확인해 주세요.");
    let bytes = 0;
    let text = "";
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > 4096) {
          await reader.cancel();
          return fail(413, "설정이 너무 깁니다.");
        }
        text += decoder.decode(part.value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
    input = JSON.parse(text + decoder.decode());
    if (!input || typeof input !== "object" || Array.isArray(input))
      return fail(400, "실시간 전사 설정을 확인해 주세요.");
  } catch {
    return fail(400, "실시간 전사 설정을 확인해 주세요.");
  }
  const language = input.language ?? "ko",
    hints = input.hints ?? "";
  if (
    !["ko", "ko-en", "auto"].includes(String(language)) ||
    typeof hints !== "string" ||
    hints.length > 1000
  )
    return fail(400, "언어 또는 인식 용어를 확인해 주세요.");
  const keywords = hints
    .split(/[,\r\n]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    keywords.length > 30 ||
    keywords.some((value) => value.length > 100 || /[<>]/.test(value))
  )
    return fail(400, "용어는 30개 이내, 각 100자 이내로 입력해 주세요.");
  try {
    const env = getServerEnv();
    if (!env.OPENAI_API_KEY)
      return fail(503, "서버에 OpenAI API 키를 설정해 주세요.");
    const transcription = {
      model: "gpt-live-transcribe",
      ...(language === "auto"
        ? {}
        : { languages: language === "ko-en" ? ["ko", "en"] : ["ko"] }),
      ...(keywords.length ? { keywords } : {}),
    };
    const response = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expires_after: { anchor: "created_at", seconds: 60 },
          session: {
            type: "transcription",
            audio: {
              input: {
                format: { type: "audio/pcm", rate: 24000 },
                transcription,
                turn_detection: null,
              },
            },
          },
        }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
      },
    );
    if (!response.ok)
      return fail(
        response.status === 429 ? 429 : 502,
        "실시간 전사 연결을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    const payload = await response.json();
    if (typeof payload.value !== "string" || !payload.value)
      return fail(502, "실시간 전사 연결 응답을 읽지 못했습니다.");
    return Response.json(
      {
        token: payload.value,
        expiresAt: payload.expires_at,
        model: "gpt-live-transcribe",
      },
      { headers },
    );
  } catch {
    return fail(503, "실시간 전사 서버 연결을 확인해 주세요.");
  }
}
