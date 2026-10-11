import { uuidSchema } from "../../../../../../domain/workspace/contracts";
import { deleteBusinessCardOriginal } from "../../../../../../server/application/business-card-service";
import { getServerEnv } from "../../../../../../server/env";
import { assertPrototypeAccess } from "../../../../../../server/security/prototype-access";
import { businessCardErrorResponse } from "../../../response";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ businessCardId: string }> },
) {
  try {
    assertPrototypeAccess(request);
    const { businessCardId } = await params;
    uuidSchema.parse(businessCardId);
    const environment = getServerEnv();
    const status = await deleteBusinessCardOriginal(
      environment.APP_DEFAULT_WORKSPACE_ID,
      businessCardId,
    );
    return Response.json({ status });
  } catch (error) {
    return businessCardErrorResponse(error);
  }
}
