import { aiRateLimitResponse } from "../../../server/ai/rate-limit-response";
import { z } from "zod";
import { AiTaskExecutionError } from "../../../server/ai/runtime-router";
import {
  assertPrototypeAccess,
  PrototypeAccessError,
} from "../../../server/security/prototype-access";

import { executeRecall } from "../../../server/application/recall-service";
import { getServerEnv } from "../../../server/env";
import {
  readJsonBody,
  requestInputErrorResponse,
} from "../../../server/http/request-body";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    query: z.string().trim().min(2).max(500),
    referenceTime: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export async function POST(request: Request) {
  let inputValidated = false;
  try {
    assertPrototypeAccess(request);
    const input = requestSchema.parse(await readJsonBody(request));
    inputValidated = true;
    const environment = getServerEnv();
    const response = await executeRecall({
      workspaceId: environment.APP_DEFAULT_WORKSPACE_ID,
      queryText: input.query,
      referenceTime: input.referenceTime
        ? new Date(input.referenceTime)
        : undefined,
    });

    return Response.json(response, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const invalidInput = requestInputErrorResponse(error);
    if (invalidInput) return invalidInput;
    const limited = aiRateLimitResponse(error);
    if (limited) return limited;
    if (error instanceof PrototypeAccessError)
      return Response.json({ error: "Not Found" }, { status: 404 });
    if (error instanceof AiTaskExecutionError)
      return Response.json(
        { error: error.message, code: error.code },
        { status: 503 },
      );
    if (error instanceof z.ZodError && !inputValidated) {
      return Response.json(
        {
          error:
            "요청 형식을 확인해 주세요. 질문은 2자 이상 500자 이하로 입력해 주세요.",
        },
        { status: 400 },
      );
    }

    return Response.json(
      { error: "관계 기억 검색을 완료하지 못했습니다." },
      { status: 500 },
    );
  }
}
