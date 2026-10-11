import { PrototypeAccessError } from "../../../server/security/prototype-access";
import { aiRateLimitResponse } from "../../../server/ai/rate-limit-response";
import { z } from "zod";
import { requestInputErrorResponse } from "../../../server/http/request-body";

import { CaptureStructuringError } from "../../../server/application/capture-service";
import {
  CaptureIdentityConflictError,
  CaptureNotFoundError,
  CaptureStateConflictError,
} from "../../../server/db/capture-repository";

export function captureErrorResponse(error: unknown): Response {
  if (error instanceof PrototypeAccessError)
    return Response.json({ error: "Not Found" }, { status: 404 });
  const invalidInput = requestInputErrorResponse(error);
  if (invalidInput) return invalidInput;
  const limited = aiRateLimitResponse(error);
  if (limited) return limited;
  if (error instanceof z.ZodError) {
    return Response.json(
      {
        error: "입력 또는 구조화 결과를 다시 확인해 주세요.",
        code: "CAPTURE_VALIDATION_ERROR",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  if (error instanceof CaptureNotFoundError) {
    return Response.json(
      { error: "Capture를 찾을 수 없습니다.", code: "CAPTURE_NOT_FOUND" },
      { status: 404 },
    );
  }

  if (
    error instanceof CaptureStateConflictError ||
    error instanceof CaptureIdentityConflictError
  ) {
    return Response.json(
      {
        error: "현재 Capture 상태 또는 선택한 Person을 다시 확인해 주세요.",
        code: "CAPTURE_CONFLICT",
      },
      { status: 409 },
    );
  }

  if (error instanceof CaptureStructuringError) {
    return Response.json(
      {
        error:
          "맥락 구조화를 완료하지 못했습니다. 원문은 보존되었으며 다시 시도할 수 있습니다.",
        code: error.code,
        captureId: error.captureId,
        recoverable: true,
      },
      { status: error.code === "AI_CONFIGURATION_ERROR" ? 503 : 502 },
    );
  }

  return Response.json(
    {
      error: "Capture 작업을 완료하지 못했습니다.",
      code: "CAPTURE_INTERNAL_ERROR",
    },
    { status: 500 },
  );
}
