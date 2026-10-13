import { turnRequestSchema } from "../../../../domain/assistant/contracts";
import { executeAssistantTurn } from "../../../../server/application/assistant-service";
import { getServerEnv } from "../../../../server/env";
import {
  assistantErrorResponse,
  assistantJson,
} from "../../../../server/http/assistant-response";
import { readJsonBody } from "../../../../server/http/request-body";
import { assertPrototypeAccess } from "../../../../server/security/prototype-access";
export const runtime = "nodejs";
export const maxDuration = 90;
export async function POST(request: Request) {
  try {
    assertPrototypeAccess(request);
    const result = await executeAssistantTurn(
      getServerEnv().APP_DEFAULT_WORKSPACE_ID,
      turnRequestSchema.parse(await readJsonBody(request)),
    );
    return assistantJson(result, "schemaVersion" in result ? 200 : 202);
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
