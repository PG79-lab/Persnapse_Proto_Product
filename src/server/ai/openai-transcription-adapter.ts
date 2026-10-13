import "server-only";

export class TranscriptionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

export async function transcribeAudio(input: {
  audio: File;
  apiKey: string;
  model: string;
  language: "ko" | "ko-en" | "auto";
  keywords: string[];
  signal?: AbortSignal;
}) {
  if (input.model !== "gpt-transcribe") {
    throw new TranscriptionError(
      "STT 모델 설정을 gpt-transcribe로 확인해 주세요.",
      503,
      "STT_MODEL_UNSUPPORTED",
    );
  }
  const body = new FormData();
  body.set("file", input.audio);
  body.set("model", input.model);
  if (input.language !== "auto") body.append("languages[]", "ko");
  if (input.language === "ko-en") body.append("languages[]", "en");
  for (const keyword of input.keywords) body.append("keywords[]", keyword);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body,
      signal: AbortSignal.any([
        AbortSignal.timeout(45_000),
        ...(input.signal ? [input.signal] : []),
      ]),
    });
  } catch {
    throw new TranscriptionError(
      "음성 변환 연결이 중단됐습니다. 다시 시도해 주세요.",
      504,
      "STT_CONNECTION_FAILED",
    );
  }
  if (!response.ok) {
    throw new TranscriptionError(
      response.status === 429
        ? "음성 변환 요청이 많습니다. 잠시 후 다시 시도해 주세요."
        : "음성을 변환하지 못했습니다. 서버의 OpenAI 설정과 음성을 확인해 주세요.",
      response.status === 429 ? 429 : 502,
      "STT_PROVIDER_FAILED",
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !("text" in payload) ||
    typeof payload.text !== "string"
  ) {
    throw new TranscriptionError(
      "음성 변환 응답을 읽지 못했습니다.",
      502,
      "STT_INVALID_RESPONSE",
    );
  }
  if (!payload.text.trim())
    throw new TranscriptionError(
      "인식된 말이 없습니다. 다시 녹음해 주세요.",
      422,
      "STT_EMPTY_TRANSCRIPT",
    );
  return {
    text: payload.text.trim(),
    model: input.model,
    provider: "openai" as const,
  };
}
