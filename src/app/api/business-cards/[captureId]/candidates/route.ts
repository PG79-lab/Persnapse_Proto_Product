import { uuidSchema } from "../../../../../domain/workspace/contracts";
import { z } from "zod";

import { businessCardDraftV1Schema } from "../../../../../domain/business-card/business-card-draft";
import { searchBusinessCardCandidates } from "../../../../../server/application/business-card-service";
import { getServerEnv } from "../../../../../server/env";
import { assertPrototypeAccess } from "../../../../../server/security/prototype-access";
import { businessCardErrorResponse } from "../../response";
import { readJsonBody } from "../../../../../server/http/request-body";

const requestSchema = z.object({ draft: businessCardDraftV1Schema }).strict();

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ captureId: string }> },
) {
  try {
    assertPrototypeAccess(request);
    const { captureId } = await params;
    uuidSchema.parse(captureId);
    const { draft } = requestSchema.parse(await readJsonBody(request));
    const environment = getServerEnv();
    const identityCandidates = await searchBusinessCardCandidates(
      environment.APP_DEFAULT_WORKSPACE_ID,
      captureId,
      draft,
    );
    return Response.json({ identityCandidates });
  } catch (error) {
    return businessCardErrorResponse(error);
  }
}
