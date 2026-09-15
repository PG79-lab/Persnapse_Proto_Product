import { z } from "zod";

import { captureDraftV1Schema } from "../../../../../domain/capture/capture-draft";
import { searchCaptureIdentityCandidates } from "../../../../../server/application/capture-service";
import { getServerEnv } from "../../../../../server/env";
import { captureErrorResponse } from "../../response";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    draft: captureDraftV1Schema,
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ captureId: string }> },
) {
  try {
    const { captureId } = await context.params;
    const { draft } = requestSchema.parse(await request.json());
    const environment = getServerEnv();
    const identityCandidates = await searchCaptureIdentityCandidates(
      environment.APP_DEFAULT_WORKSPACE_ID,
      captureId,
      draft,
    );

    return Response.json({ identityCandidates });
  } catch (error) {
    return captureErrorResponse(error);
  }
}
