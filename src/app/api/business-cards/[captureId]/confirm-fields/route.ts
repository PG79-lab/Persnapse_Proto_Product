import { confirmCardFieldsRequestSchema } from "../../../../../../card_recognition/contracts";
import { uuidSchema } from "../../../../../domain/workspace/contracts";
import { confirmBusinessCardFields } from "../../../../../server/application/business-card-service";
import { getServerEnv } from "../../../../../server/env";
import { readJsonBody } from "../../../../../server/http/request-body";
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
    uuidSchema.parse(captureId);
    const input = confirmCardFieldsRequestSchema.parse(
      await readJsonBody(request),
    );
    const environment = getServerEnv();
    return Response.json(
      await confirmBusinessCardFields({
        workspaceId: environment.APP_DEFAULT_WORKSPACE_ID,
        captureId,
        draft: input.draft,
      }),
    );
  } catch (error) {
    return businessCardErrorResponse(error);
  }
}
