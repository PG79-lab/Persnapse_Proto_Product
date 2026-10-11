import { uuidSchema } from "../../../../../domain/workspace/contracts";
import { prepareBusinessCardReviewRequestSchema } from "../../../../../domain/business-card/business-card-workflow";
import { prepareBusinessCardReview } from "../../../../../server/application/business-card-service";
import { getServerEnv } from "../../../../../server/env";
import { assertPrototypeAccess } from "../../../../../server/security/prototype-access";
import { businessCardErrorResponse } from "../../response";
import { readJsonBody } from "../../../../../server/http/request-body";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ captureId: string }> },
) {
  try {
    assertPrototypeAccess(request);
    const { captureId } = await params;
    uuidSchema.parse(captureId);
    const input = prepareBusinessCardReviewRequestSchema.parse(
      await readJsonBody(request),
    );
    const environment = getServerEnv();
    const card = await prepareBusinessCardReview({
      workspaceId: environment.APP_DEFAULT_WORKSPACE_ID,
      captureId,
      cardDraft: input.draft,
      contextNote: input.contextNote,
      referenceTime: input.referenceTime,
    });
    return Response.json(card);
  } catch (error) {
    return businessCardErrorResponse(error);
  }
}
