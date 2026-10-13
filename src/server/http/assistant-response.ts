import { z } from "zod";
import { AssistantError } from "../../domain/assistant/contracts";
import { AiTaskExecutionError } from "../ai/runtime-router";
import { aiRateLimitResponse } from "../ai/rate-limit-response";
import { PrototypeAccessError } from "../security/prototype-access";
import { requestInputErrorResponse } from "./request-body";
export function assistantJson(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export function assistantErrorResponse(error: unknown) {
  const malformed = requestInputErrorResponse(error);
  if (malformed) return malformed;
  const limited = aiRateLimitResponse(error);
  if (limited) return limited;
  if (error instanceof PrototypeAccessError)
    return assistantJson({ error: "Not Found" }, 404);
  if (error instanceof AssistantError)
    return assistantJson(
      { error: error.message, code: error.code },
      error.status,
    );
  if (error instanceof z.ZodError)
    return assistantJson(
      { error: "요청 형식과 대상을 확인해 주세요.", code: "INVALID_INPUT" },
      400,
    );
  if (error instanceof AiTaskExecutionError)
    return assistantJson({ error: error.message, code: error.code }, 503);
  return assistantJson(
    {
      error: "어시스턴트 연결을 확인하지 못했습니다.",
      code: "ASSISTANT_FAILED",
    },
    500,
  );
}
