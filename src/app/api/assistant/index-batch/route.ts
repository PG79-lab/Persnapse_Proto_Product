import { timingSafeEqual } from "node:crypto";
import { runAssistantIndexBatch } from "../../../../server/application/assistant-index-worker";
import { getServerEnv } from "../../../../server/env";
import {
  assistantErrorResponse,
  assistantJson,
} from "../../../../server/http/assistant-response";
import { cleanupAssistantHistory } from "../../../../server/db/assistant-maintenance-repository";
export const runtime = "nodejs";
export const maxDuration = 45;
export async function POST(request: Request) {
  try {
    const env = getServerEnv();
    const expected = env.ASSISTANT_WORKER_SECRET;
    const supplied = request.headers.get("authorization") ?? "";
    if (
      !expected ||
      expected.length < 32 ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(`Bearer ${expected}`) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(`Bearer ${expected}`))
    )
      return assistantJson({ error: "Not Found" }, 404);
    if (env.ASSISTANT_CONTEXT_ENABLED !== "on")
      return assistantJson({ enabled: false });
    const cleanup = await cleanupAssistantHistory(env.APP_DEFAULT_WORKSPACE_ID);
    return assistantJson({
      ...(await runAssistantIndexBatch(env.APP_DEFAULT_WORKSPACE_ID)),
      cleanup,
    });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
