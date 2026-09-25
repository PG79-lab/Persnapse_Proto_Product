import { z } from "zod";
import { getDatabase } from "../../../../server/db/client";
import { getServerEnv } from "../../../../server/env";
import { assertPrototypeAccess } from "../../../../server/security/prototype-access";
export const runtime = "nodejs";
const schema = z
  .object({ queryId: z.uuid(), elapsedMs: z.number().int().min(0).max(300000) })
  .strict();
export async function POST(request: Request) {
  try {
    assertPrototypeAccess(request);
    const input = schema.parse(await request.json());
    const workspaceId = getServerEnv().APP_DEFAULT_WORKSPACE_ID;
    await getDatabase()`update public.queries
      set retrieval_trace = retrieval_trace || jsonb_build_object('clientElapsedMs', ${input.elapsedMs}::integer)
      where workspace_id = ${workspaceId} and id = ${input.queryId}`;
    return Response.json({ recorded: true });
  } catch {
    return Response.json({ recorded: false }, { status: 400 });
  }
}
