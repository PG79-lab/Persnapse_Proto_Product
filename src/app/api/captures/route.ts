import { assertPrototypeAccess } from "../../../server/security/prototype-access";
import { createTextCaptureRequestSchema } from "../../../domain/capture/capture-workflow";
import { createAndStructureTextCapture } from "../../../server/application/capture-service";
import { getServerEnv } from "../../../server/env";
import { captureErrorResponse } from "./response";
import { readJsonBody } from "../../../server/http/request-body";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertPrototypeAccess(request);
    const input = createTextCaptureRequestSchema.parse(
      await readJsonBody(request),
    );
    const environment = getServerEnv();
    const capture = await createAndStructureTextCapture({
      workspaceId: environment.APP_DEFAULT_WORKSPACE_ID,
      ...input,
    });

    return Response.json(capture, { status: 201 });
  } catch (error) {
    return captureErrorResponse(error);
  }
}
