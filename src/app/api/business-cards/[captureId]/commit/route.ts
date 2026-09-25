import { commitBusinessCardRequestSchema } from "../../../../../domain/business-card/business-card-workflow";
import { commitReviewedBusinessCard } from "../../../../../server/application/business-card-service";
import { getServerEnv } from "../../../../../server/env";
import { assertPrototypeAccess } from "../../../../../server/security/prototype-access";
import { businessCardErrorResponse } from "../../response";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ captureId: string }> },
) {
  try {
    assertPrototypeAccess(request);
    const { captureId } = await params;
    const input = commitBusinessCardRequestSchema.parse(await request.json());
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
