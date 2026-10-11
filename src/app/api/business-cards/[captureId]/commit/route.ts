import { uuidSchema } from "../../../../../domain/workspace/contracts";
import { commitBusinessCardRequestSchema } from "../../../../../domain/business-card/business-card-workflow";
import { commitReviewedBusinessCard } from "../../../../../server/application/business-card-service";
import { getServerEnv } from "../../../../../server/env";
import { assertPrototypeAccess } from "../../../../../server/security/prototype-access";
import { businessCardErrorResponse } from "../../response";
import { readJsonBody } from "../../../../../server/http/request-body";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ captureId: string }> },
) {
  try {
    assertPrototypeAccess(request);
    const { captureId } = await params;
    uuidSchema.parse(captureId);
    const input = commitBusinessCardRequestSchema.parse(
      await readJsonBody(request),
    );
    const environment = getServerEnv();
    const result = await commitReviewedBusinessCard({
      workspaceId: environment.APP_DEFAULT_WORKSPACE_ID,
      captureId,
      ...input,
    });
    return Response.json(result);
  } catch (error) {
    return businessCardErrorResponse(error);
  }
}
