import { assertPrototypeAccess } from "../../../../server/security/prototype-access";
import { uuidSchema } from "../../../../domain/workspace/contracts";
import { getTextCapture } from "../../../../server/application/capture-service";
import { getServerEnv } from "../../../../server/env";
import { captureErrorResponse } from "../response";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ captureId: string }> },
) {
  try {
    assertPrototypeAccess(request);
    const { captureId } = await context.params;
    uuidSchema.parse(captureId);
    const environment = getServerEnv();
    const capture = await getTextCapture(
      environment.APP_DEFAULT_WORKSPACE_ID,
      captureId,
    );

    if (!capture) {
      return Response.json(
        { error: "Capture를 찾을 수 없습니다.", code: "CAPTURE_NOT_FOUND" },
        { status: 404 },
      );
    }

    return Response.json(capture);
  } catch (error) {
    return captureErrorResponse(error);
  }
}
