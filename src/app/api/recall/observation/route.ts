import { z } from "zod";
import { getDatabase } from "../../../../server/db/client";
import { getServerEnv } from "../../../../server/env";
import {
  readJsonBody,
  requestInputErrorResponse,
} from "../../../../server/http/request-body";
import {
  assertPrototypeAccess,
  PrototypeAccessError,
} from "../../../../server/security/prototype-access";
export const runtime = "nodejs";
const schema = z
  .object({ queryId: z.uuid(), elapsedMs: z.number().int().min(0).max(300000) })
  .strict();
export async function POST(request: Request) {
  try {
    assertPrototypeAccess(request);
    const input = schema.parse(await readJsonBody(request));
    const workspaceId = getServerEnv().APP_DEFAULT_WORKSPACE_ID;
    const rows = await getDatabase()`update public.queries
      set retrieval_trace = (case when jsonb_typeof(retrieval_trace) = 'object' then retrieval_trace
        else jsonb_build_object('legacyTrace', retrieval_trace) end) || jsonb_build_object('clientElapsedMs', ${input.elapsedMs}::integer)
      where workspace_id = ${workspaceId} and id = ${input.queryId} returning id`;
    if (!rows.length)
      return Response.json(
        { recorded: false, error: "기록할 답변을 찾지 못했습니다." },
        { status: 404, headers: { "Cache-Control": "private, no-store" } },
      );
    return Response.json(
      { recorded: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const invalidInput = requestInputErrorResponse(error);
    if (invalidInput) return invalidInput;
    return Response.json(
      { recorded: false, error: "응답 시간 기록을 저장하지 못했습니다." },
      {
        status:
          error instanceof PrototypeAccessError
            ? 404
            : error instanceof z.ZodError
              ? 400
              : 500,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
