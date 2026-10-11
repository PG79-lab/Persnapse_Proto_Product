import { z } from "zod";
import { createWorkspaceBriefing } from "../../../server/application/workspace-briefing";
import { aiRateLimitResponse } from "../../../server/ai/rate-limit-response";
import { readJsonBody } from "../../../server/http/request-body";
import {
  workspaceResponse,
  workspaceErrorResponse,
} from "../../../server/http/workspace-response";
import { assertPrototypeAccess } from "../../../server/security/prototype-access";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    assertPrototypeAccess(request);
    const input = z
      .object({ note: z.string().trim().max(2000) })
      .strict()
      .parse(await readJsonBody(request));
    return workspaceResponse(await createWorkspaceBriefing(input.note));
  } catch (error) {
    return aiRateLimitResponse(error) ?? workspaceErrorResponse(error);
  }
}
