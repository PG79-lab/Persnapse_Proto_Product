import { getServerEnv } from "../../../../server/env";
import {
  assertPrototypeAccess,
  PrototypeAccessError,
} from "../../../../server/security/prototype-access";
import {
  transcribeAudio,
  TranscriptionError,
} from "../../../../server/ai/openai-transcription-adapter";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_BODY = 4_000_000;
const MAX_AUDIO = 3_900_000;
const headers = { "Cache-Control": "private, no-store" };

function errorResponse(error: unknown) {
  if (error instanceof PrototypeAccessError)
    return Response.json(
      { error: "이 환경에서는 사용할 수 없습니다.", code: "STT_ACCESS_DENIED" },
      { status: 403, headers },
    );
  if (error instanceof TranscriptionError)
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status, headers },
    );
  return Response.json(
    { error: "음성 변환 서버 설정을 확인해 주세요.", code: "STT_UNAVAILABLE" },
    { status: 503, headers },
  );
}

export async function GET(request: Request) {
  try {
    assertPrototypeAccess(request);
    const env = getServerEnv();
    return Response.json(
      {
        configured:
          Boolean(env.OPENAI_API_KEY) &&
          env.OPENAI_TRANSCRIPTION_MODEL === "gpt-transcribe",
        model: env.OPENAI_TRANSCRIPTION_MODEL,
      },
      { headers },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

// Bound streamed bodies too: Content-Length can be absent or misleading.
async function readForm(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
    throw new TranscriptionError(
      "음성 업로드 형식이 올바르지 않습니다.",
      400,
      "STT_INVALID_INPUT",
    );
  const reader = request.body?.getReader();
  if (!reader)
    throw new TranscriptionError(
      "녹음 파일이 없습니다.",
      400,
      "STT_INVALID_INPUT",
    );
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw new TranscriptionError(
          "음성이 너무 큽니다. 짧게 녹음해 주세요.",
          413,
          "STT_TOO_LARGE",
        );
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(new Blob(chunks), {
      headers: { "Content-Type": request.headers.get("content-type")! },
    }).formData();
  } catch {
    throw new TranscriptionError(
      "녹음 파일을 읽지 못했습니다.",
      400,
      "STT_INVALID_INPUT",
    );
  }
}

export async function POST(request: Request) {
  try {
    assertPrototypeAccess(request);
    const origin = request.headers.get("origin");
    // Next can expose the backend URL when a gateway forwards a browser request.
    const url = new URL(request.url);
    const protocol =
      request.headers.get("x-forwarded-proto") === "https"
        ? "https:"
        : url.protocol;
    const browserOrigin = `${protocol}//${request.headers.get("host") ?? url.host}`;
    if (
      request.headers.get("x-persnapse-stt") !== "1" ||
      (origin && origin !== browserOrigin)
    )
      throw new TranscriptionError(
        "잘못된 음성 변환 요청입니다.",
        403,
        "STT_ACCESS_DENIED",
      );
    const env = getServerEnv();
    if (!env.OPENAI_API_KEY)
      throw new TranscriptionError(
        "서버에 OpenAI API 키를 설정해 주세요.",
        503,
        "STT_KEY_MISSING",
      );
    const form = await readForm(request);
    const audio = form.get("audio");
    const language = form.get("language") ?? "ko";
    const hints = form.get("hints") ?? "";
    if (
      !(audio instanceof File) ||
      !audio.size ||
      audio.size > MAX_AUDIO ||
      !/\.(webm|m4a|mp4|wav|mp3|mpeg|mpga)$/i.test(audio.name) ||
      !["ko", "ko-en", "auto"].includes(String(language)) ||
      typeof hints !== "string" ||
      hints.length > 1000
    )
      throw new TranscriptionError(
        "지원되는 녹음 파일과 언어를 확인해 주세요.",
        400,
        "STT_INVALID_INPUT",
      );
    const keywords = hints
      .split(/[,\r\n]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (
      keywords.length > 30 ||
      keywords.some((value) => /[<>]/.test(value) || value.length > 100)
    )
      throw new TranscriptionError(
        "용어는 30개 이내, 각 100자 이내로 입력해 주세요. < > 문자는 사용할 수 없습니다.",
        400,
        "STT_INVALID_INPUT",
      );
    const result = await transcribeAudio({
      audio,
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_TRANSCRIPTION_MODEL,
      language: language as "ko" | "ko-en" | "auto",
      keywords,
      signal: request.signal,
    });
    return Response.json(result, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
