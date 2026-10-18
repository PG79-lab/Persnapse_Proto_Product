import { AssistantError } from "../../../../domain/assistant/contracts";
import {
  retryAssistantIndexJobs,
  runAssistantIndexBatch,
} from "../../../../server/application/assistant-index-worker";
import { getServerEnv } from "../../../../server/env";
import {
  assistantErrorResponse,
  assistantJson,
} from "../../../../server/http/assistant-response";
import { assertPrototypeAccess } from "../../../../server/security/prototype-access";
export const runtime = "nodejs";
export const maxDuration = 45;
export async function POST(request: Request) {
  try {
    assertPrototypeAccess(request);
    const env = getServerEnv();
    if (
      env.ASSISTANT_CONTEXT_ENABLED !== "on" ||
      env.ASSISTANT_INDEX_WORKER_ENABLED !== "on"
    )
      throw new AssistantError(
        "INDEX_WORKER_DISABLED",
        "자동 검색 복구 연결이 아직 설정되지 않았습니다. 현재 가능한 검색은 계속 사용할 수 있습니다.",
        503,
      );
    await retryAssistantIndexJobs(env.APP_DEFAULT_WORKSPACE_ID);
    return assistantJson(
      await runAssistantIndexBatch(env.APP_DEFAULT_WORKSPACE_ID),
    );
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
