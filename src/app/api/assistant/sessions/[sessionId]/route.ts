import { z } from "zod";
import { AssistantError } from "../../../../../domain/assistant/contracts";
import { loadAssistantSession } from "../../../../../server/db/assistant-session-repository";
import { getServerEnv } from "../../../../../server/env";
import {
  assistantErrorResponse,
  assistantJson,
} from "../../../../../server/http/assistant-response";
import { assertPrototypeAccess } from "../../../../../server/security/prototype-access";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  try {
    assertPrototypeAccess(request);
    const env = getServerEnv();
    if (env.ASSISTANT_CONTEXT_ENABLED !== "on")
      throw new AssistantError(
        "ASSISTANT_DISABLED",
        "맥락 어시스턴트가 아직 활성화되지 않았습니다.",
        503,
      );
    return assistantJson(
      await loadAssistantSession(
        env.APP_DEFAULT_WORKSPACE_ID,
        z.uuid().parse((await ctx.params).sessionId),
      ),
    );
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
