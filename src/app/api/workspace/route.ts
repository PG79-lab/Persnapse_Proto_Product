import { mutationSchema } from "../../../domain/workspace/contracts";
import {
  loadWorkspace,
  mutateWorkspace,
} from "../../../server/db/workspace-repository";
import { getServerEnv } from "../../../server/env";
import { readJsonBody } from "../../../server/http/request-body";
import {
  WorkspaceError,
  workspaceErrorResponse,
  workspaceResponse,
} from "../../../server/http/workspace-response";
import { assertPrototypeAccess } from "../../../server/security/prototype-access";

export const runtime = "nodejs";
export const maxDuration = 60;
function capabilities() {
  const env = getServerEnv();
  return {
    assistantContext: env.ASSISTANT_CONTEXT_ENABLED === "on",
    aiMode: env.AI_ROUTING_MODE,
    ocrMode: env.BUSINESS_CARD_OCR_MODE,
    storage: "server",
  } as const;
}
export async function GET(request: Request) {
  try {
    assertPrototypeAccess(request);
    const state = await loadWorkspace(getServerEnv().APP_DEFAULT_WORKSPACE_ID);
    return workspaceResponse({
      state,
      capabilities: capabilities(),
      loadedAt: new Date().toISOString(),
    });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    assertPrototypeAccess(request);
    // Bound actual bytes even when the client does not send Content-Length.
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 256_000)
      throw new WorkspaceError(
        "BODY_TOO_LARGE",
        "한 번에 저장할 내용이 너무 큽니다.",
        413,
      );
    const mutation = mutationSchema.parse(
      await readJsonBody(
        new Request("http://localhost/body", { method: "POST", body }),
      ),
    );
    const state = await mutateWorkspace(
      getServerEnv().APP_DEFAULT_WORKSPACE_ID,
      mutation,
    );
    return workspaceResponse({
      state,
      capabilities: capabilities(),
      loadedAt: new Date().toISOString(),
    });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
