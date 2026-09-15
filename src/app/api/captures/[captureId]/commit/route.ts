import { commitTextCaptureRequestSchema } from "../../../../../domain/capture/capture-workflow";
import { commitReviewedTextCapture } from "../../../../../server/application/capture-service";
import { getServerEnv } from "../../../../../server/env";
import { captureErrorResponse } from "../../response";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ captureId: string }> },
) {
  try {
    const { captureId } = await context.params;
    const input = commitTextCaptureRequestSchema.parse(await request.json());
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
