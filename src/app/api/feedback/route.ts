import { z } from "zod";
import { getDatabase } from "../../../server/db/client";
import { getServerEnv } from "../../../server/env";
import {
  assertPrototypeAccess,
  PrototypeAccessError,
} from "../../../server/security/prototype-access";
export const runtime = "nodejs";
const schema = z
  .object({
    queryId: z.uuid(),
    kind: z.enum(["helpful", "not_helpful", "wrong_person"]),
    comment: z.string().trim().max(1000).nullable(),
    elapsedMs: z.number().int().min(0).max(300000).nullable(),
  })
  .strict();
export async function POST(request: Request) {
  try {
    assertPrototypeAccess(request);
    const input = schema.parse(await request.json());
    const workspaceId = getServerEnv().APP_DEFAULT_WORKSPACE_ID;
    const sql = getDatabase();
    const rows =
      await sql`insert into public.feedback(workspace_id, query_id, kind, comment)
      select ${workspaceId}, id, ${input.kind}, ${input.comment} from public.queries
      where workspace_id = ${workspaceId} and id = ${input.queryId} returning id`;
    if (!rows.length)
      return Response.json(
        { error: "평가할 답변을 찾지 못했습니다." },
        { status: 404 },
      );
    if (input.elapsedMs !== null)
      await sql`update public.queries
      set retrieval_trace = retrieval_trace || jsonb_build_object('clientElapsedMs', ${input.elapsedMs}::integer)
      where workspace_id = ${workspaceId} and id = ${input.queryId}`;
    return Response.json({ saved: true });
  } catch (error) {
    return Response.json(
      { error: "평가를 저장하지 못했습니다." },
      {
        status:
          error instanceof PrototypeAccessError
            ? 404
            : error instanceof z.ZodError
              ? 400
              : 500,
      },
    );
  }
}
