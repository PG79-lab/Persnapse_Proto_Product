import { aiRateLimitResponse } from "../../../server/ai/rate-limit-response";
import { z } from "zod";
import { requestInputErrorResponse } from "../../../server/http/request-body";

import {
  BusinessCardCostLimitError,
  BusinessCardImageError,
  BusinessCardProcessingError,
} from "../../../server/application/business-card-service";
import {
  CaptureIdentityConflictError,
  CaptureNotFoundError,
  CaptureStateConflictError,
} from "../../../server/db/capture-repository";
import { PrototypeAccessError } from "../../../server/security/prototype-access";
import { RequestBodyTooLargeError } from "../../../server/security/request-body-limit";

function costLimitMessage(code: BusinessCardCostLimitError["code"]): string {
  if (code === "OCR_DUPLICATE_IN_PROGRESS") {
    return "같은 명함을 이미 인식하고 있습니다. 잠시 후 결과를 확인해 주세요.";
  }
  if (code === "OCR_DUPLICATE_REQUEST") {
    return "이미 처리한 OCR 요청입니다. 같은 요청을 반복 전송하지 않았습니다.";
  }
  return "짧은 시간에 명함 인식 요청이 몰렸습니다. 잠시 후 다시 시도해 주세요.";
}

function processingMessage(code: string): string {
  if (code === "AI_TIMEOUT") {
    return "명함 인식이 12초 안에 완료되지 않았습니다. 같은 이미지로 다시 시도해 주세요.";
  }
  if (code === "CLOVA_NO_FIELDS_DETECTED") {
    return "명함에서 사용할 수 있는 글자를 찾지 못했습니다. 더 밝고 선명하게 다시 촬영해 주세요.";
  }
  if (
    code === "CLOVA_INFERENCE_FAILURE" ||
    code === "CLOVA_IMAGE_FORMAT_UNSUPPORTED"
  ) {
    return "Clova가 이 명함 이미지를 처리하지 못했습니다. JPEG 또는 PNG로 다시 시도해 주세요.";
  }
  if (code.includes("HTTP_401") || code.includes("CODE_0002")) {
    return "Clova OCR 인증에 실패했습니다. 서버의 Secret Key 설정을 확인해 주세요.";
  }
  if (
    code === "AI_CONFIGURATION_ERROR" ||
    code.startsWith("CLOVA_INVOKE_URL")
  ) {
    return "Clova OCR 서버 설정이 완료되지 않았습니다. Invoke URL과 Secret Key를 확인해 주세요.";
  }
  if (
    code === "CLOVA_NETWORK_ERROR" ||
    code === "CLOVA_INFERENCE_ERROR" ||
    code.includes("HTTP_429") ||
    code.includes("CODE_0023") ||
    code.includes("CODE_0025") ||
    /CLOVA_HTTP_5\d\d/u.test(code)
  ) {
    return "Clova OCR에 일시적으로 연결하지 못했습니다. 잠시 후 같은 이미지로 다시 시도해 주세요.";
  }
  return "명함 처리를 완료하지 못했습니다. 이미지와 Draft는 보존되었으며 다시 시도할 수 있습니다.";
}

function publicProcessingCode(code: string): string {
  if (code === "AI_TIMEOUT") return "BUSINESS_CARD_OCR_TIMEOUT";
  if (code === "CLOVA_NO_FIELDS_DETECTED") return code;
  if (
    code === "CLOVA_INFERENCE_FAILURE" ||
    code === "CLOVA_IMAGE_FORMAT_UNSUPPORTED"
  ) {
    return "BUSINESS_CARD_IMAGE_REJECTED";
  }
  if (code.includes("HTTP_401") || code.includes("CODE_0002")) {
    return "CLOVA_AUTHENTICATION_FAILED";
  }
  if (
    code === "AI_CONFIGURATION_ERROR" ||
    code.startsWith("CLOVA_INVOKE_URL")
  ) {
    return "CLOVA_CONFIGURATION_ERROR";
  }
  if (code === "OCR_GUARD_UNAVAILABLE") return code;
  if (
    code.includes("HTTP_429") ||
    code.includes("CODE_0023") ||
    code.includes("CODE_0025")
  ) {
    return "CLOVA_PROVIDER_LIMIT_REACHED";
  }
  if (
    code === "CLOVA_NETWORK_ERROR" ||
    code === "CLOVA_INFERENCE_ERROR" ||
    /CLOVA_HTTP_5\d\d/u.test(code)
  ) {
    return "CLOVA_TEMPORARILY_UNAVAILABLE";
  }
  return "BUSINESS_CARD_OCR_FAILED";
}

export function businessCardErrorResponse(error: unknown): Response {
  const invalidInput = requestInputErrorResponse(error);
  if (invalidInput) return invalidInput;
  const limited = aiRateLimitResponse(error);
  if (limited) return limited;
  if (error instanceof PrototypeAccessError) {
    return Response.json(
      {
        error: "보호된 MVP Preview 환경에서만 명함 기능을 사용할 수 있습니다.",
        code: "PROTOTYPE_ACCESS_DENIED",
      },
      { status: 403 },
    );
  }
  if (error instanceof z.ZodError) {
    return Response.json(
      {
        error: "명함 입력 또는 검토 값을 다시 확인해 주세요.",
        code: "BUSINESS_CARD_VALIDATION_ERROR",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }
  if (error instanceof RequestBodyTooLargeError) {
    return Response.json(
      { error: error.message, code: "BUSINESS_CARD_PAYLOAD_TOO_LARGE" },
      { status: 413 },
    );
  }
  if (error instanceof BusinessCardImageError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: 400 },
    );
  }
  if (error instanceof BusinessCardCostLimitError) {
    return Response.json(
      {
        error: costLimitMessage(error.code),
        code: error.code,
        captureId: error.captureId,
        retryAfterSeconds: error.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          "Cache-Control": "private, no-store",
          "Retry-After": String(error.retryAfterSeconds),
        },
      },
    );
  }
  if (error instanceof CaptureNotFoundError) {
    return Response.json(
      { error: "명함 Capture를 찾을 수 없습니다.", code: "CAPTURE_NOT_FOUND" },
      { status: 404 },
    );
  }
  if (
    error instanceof CaptureStateConflictError ||
    error instanceof CaptureIdentityConflictError
  ) {
    return Response.json(
      {
        error: "현재 명함 상태 또는 선택한 Person을 다시 확인해 주세요.",
        code: "BUSINESS_CARD_CONFLICT",
      },
      { status: 409 },
    );
  }
  if (error instanceof BusinessCardProcessingError) {
    const providerLimited =
      error.code.includes("HTTP_429") ||
      error.code.includes("CODE_0023") ||
      error.code.includes("CODE_0025");
    return Response.json(
      {
        error: processingMessage(error.code),
        code: publicProcessingCode(error.code),
        captureId: error.captureId,
        recoverable: true,
      },
      {
        status: providerLimited
          ? 429
          : error.code === "AI_CONFIGURATION_ERROR" ||
              error.code === "OCR_GUARD_UNAVAILABLE" ||
              error.code.startsWith("CLOVA_INVOKE_URL")
            ? 503
            : 502,
        headers: providerLimited
          ? { "Cache-Control": "private, no-store", "Retry-After": "2" }
          : undefined,
      },
    );
  }

  return Response.json(
    {
      error: "명함 작업을 완료하지 못했습니다.",
      code: "BUSINESS_CARD_INTERNAL_ERROR",
    },
    { status: 500 },
  );
}
