import { assertPrototypeAccess } from "../../../../../server/security/prototype-access";
import { uuidSchema } from "../../../../../domain/workspace/contracts";
import { commitTextCaptureRequestSchema } from "../../../../../domain/capture/capture-workflow";
import { commitReviewedTextCapture } from "../../../../../server/application/capture-service";
import { getServerEnv } from "../../../../../server/env";
import { captureErrorResponse } from "../../response";
import { readJsonBody } from "../../../../../server/http/request-body";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ captureId: string }> },
) {
  try {
    assertPrototypeAccess(request);
    const { captureId } = await context.params;
    uuidSchema.parse(captureId);
    const input = commitTextCaptureRequestSchema.parse(
      await readJsonBody(request),
    );
    const environment = getServerEnv();
    const result = await commitReviewedTextCapture({
      workspaceId: environment.APP_DEFAULT_WORKSPACE_ID,
      captureId,
      ...input,
    });

    return Response.json(result);
  } catch (error) {
    return captureErrorResponse(error);
  }
}
