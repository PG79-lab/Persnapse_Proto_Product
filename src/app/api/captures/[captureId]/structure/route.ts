import { assertPrototypeAccess } from "../../../../../server/security/prototype-access";
import { uuidSchema } from "../../../../../domain/workspace/contracts";
import { structureTextCapture } from "../../../../../server/application/capture-service";
import { getServerEnv } from "../../../../../server/env";
import { captureErrorResponse } from "../../response";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ captureId: string }> },
) {
  try {
    assertPrototypeAccess(request);
    const { captureId } = await context.params;
    uuidSchema.parse(captureId);
    const environment = getServerEnv();
    const capture = await structureTextCapture({
      workspaceId: environment.APP_DEFAULT_WORKSPACE_ID,
      captureId,
    });

    return Response.json(capture);
  } catch (error) {
    return captureErrorResponse(error);
  }
}
