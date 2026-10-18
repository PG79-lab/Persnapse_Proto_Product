import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "./client";
import {
  AssistantError,
  contextSchema,
  emptyContext,
  type AssistantContext,
  type AssistantResponse,
  type TurnRequest,
} from "../../domain/assistant/contracts";

type SessionRow = {
  version: number;
  context: unknown;
  updated_at: Date;
  lease_token: string | null;
  lease_until: Date | null;
};
export type StoredTurn = {
  id: string;
  message: string;
  request_id: string;
  status: "processing" | "succeeded" | "failed" | "unknown";
  response: AssistantResponse | null;
  error_code: string | null;
  error_message: string | null;
};
export type Reservation =
  | {
      kind: "reserved";
      turnId: string;
      version: number;
      context: AssistantContext;
      recent: StoredTurn[];
    }
  | { kind: "existing"; turn: StoredTurn };
function currentContext(row: SessionRow): AssistantContext {
  if (Date.now() - new Date(row.updated_at).getTime() > 7 * 86400000)
    return emptyContext();
  const parsed = contextSchema.safeParse(row.context);
  return parsed.success ? parsed.data : emptyContext();
}
export async function reserveAssistantTurn(
  workspaceId: string,
  input: TurnRequest,
): Promise<Reservation> {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        message: input.message,
        selection: input.contextSelection ?? null,
      }),
    )
    .digest("hex");
  return getDatabase().begin(async (sql) => {
    await sql`insert into public.assistant_sessions(id,workspace_id) values(${input.sessionId},${workspaceId}) on conflict(id) do nothing`;
    const [session] = await sql<
      SessionRow[]
    >`select * from public.assistant_sessions
      where workspace_id=${workspaceId} and id=${input.sessionId} for update`;
    if (!session)
      throw new AssistantError(
        "SESSION_NOT_FOUND",
        "대화를 찾을 수 없습니다.",
        404,
      );
    if (
      session.lease_until &&
      new Date(session.lease_until).getTime() <= Date.now()
    ) {
      await sql`update public.assistant_turns set status='unknown',error_code='TURN_RESULT_UNKNOWN',
        error_message='이전 응답의 완료 여부를 확인할 수 없습니다. 자동으로 다시 실행하지 않았습니다.',completed_at=now()
        where workspace_id=${workspaceId} and id=${session.lease_token} and status='processing'`;
      await sql`update public.assistant_sessions set lease_token=null,lease_until=null where workspace_id=${workspaceId} and id=${input.sessionId}`;
      session.lease_token = null;
    }
    const [existing] = await sql<
      (StoredTurn & { payload_hash: string })[]
    >`select * from public.assistant_turns
      where workspace_id=${workspaceId} and session_id=${input.sessionId} and request_id=${input.requestId}`;
    if (existing) {
      if (existing.payload_hash !== hash)
        throw new AssistantError(
          "IDEMPOTENCY_CONFLICT",
          "동일한 요청 ID의 내용이 다릅니다.",
        );
      return { kind: "existing", turn: existing };
    }
    if (session.lease_token)
      throw new AssistantError(
        "SESSION_BUSY",
        "이 대화의 이전 응답이 진행 중입니다. 잠시 후 확인해 주세요.",
      );
    if (session.version !== input.expectedVersion)
      throw new AssistantError(
        "SESSION_VERSION_CONFLICT",
        "다른 창에서 대화가 변경됐습니다. 대화를 새로 불러와 주세요.",
      );
    const turnId = randomUUID();
    await sql`insert into public.assistant_turns(id,workspace_id,session_id,request_id,payload_hash,message,status)
      values(${turnId},${workspaceId},${input.sessionId},${input.requestId},${hash},${input.message},'processing')`;
    await sql`update public.assistant_sessions set lease_token=${turnId},lease_until=now()+interval '90 seconds'
      where workspace_id=${workspaceId} and id=${input.sessionId}`;
    const recent = await sql<
      StoredTurn[]
    >`select id,message,request_id,status,response,error_code,error_message
      from public.assistant_turns where workspace_id=${workspaceId} and session_id=${input.sessionId} and status='succeeded'
        and created_at > now()-interval '7 days' order by created_at desc,id desc limit 6`;
    return {
      kind: "reserved",
      turnId,
      version: session.version,
      context: currentContext(session),
      recent: recent.reverse(),
    };
  });
}
export async function completeAssistantTurn(
  workspaceId: string,
  response: AssistantResponse,
) {
  await getDatabase().begin(async (sql) => {
    const rows =
      await sql`update public.assistant_sessions set context=${sql.json(response.context)},version=version+1,
      lease_token=null,lease_until=null,updated_at=now() where workspace_id=${workspaceId} and id=${response.sessionId}
      and lease_token=${response.turnId} and version=${response.version - 1} and lease_until > now() returning id`;
    if (!rows.length)
      throw new AssistantError(
        "TURN_RESULT_UNKNOWN",
        "대화 상태가 변경돼 응답을 반영하지 못했습니다.",
      );
    await sql`update public.assistant_turns set status='succeeded',response=${sql.json(JSON.parse(JSON.stringify(response)))},completed_at=now()
      where workspace_id=${workspaceId} and id=${response.turnId} and status='processing'`;
  });
}
export async function failAssistantTurn(
  workspaceId: string,
  sessionId: string,
  turnId: string,
  code: string,
  message: string,
) {
  await getDatabase().begin(async (sql) => {
    await sql`select id from public.assistant_sessions where workspace_id=${workspaceId} and id=${sessionId} for update`;
    await sql`update public.assistant_turns set status='failed',error_code=${code},error_message=${message},completed_at=now()
      where workspace_id=${workspaceId} and id=${turnId} and status='processing'`;
    await sql`update public.assistant_sessions set lease_token=null,lease_until=null
      where workspace_id=${workspaceId} and id=${sessionId} and lease_token=${turnId}`;
  });
}
export async function loadAssistantSession(
  workspaceId: string,
  sessionId: string,
) {
  return getDatabase().begin(async (sql) => {
    const [row] = await sql<
      SessionRow[]
    >`select * from public.assistant_sessions where workspace_id=${workspaceId} and id=${sessionId} for update`;
    if (!row)
      throw new AssistantError(
        "SESSION_NOT_FOUND",
        "대화를 찾을 수 없습니다.",
        404,
      );
    if (
      row.lease_token &&
      row.lease_until &&
      new Date(row.lease_until).getTime() <= Date.now()
    ) {
      await sql`update public.assistant_turns set status='unknown',error_code='TURN_RESULT_UNKNOWN',
        error_message='완료 여부가 불명확해 자동 재실행하지 않았습니다.',completed_at=now()
        where workspace_id=${workspaceId} and id=${row.lease_token} and status='processing'`;
      await sql`update public.assistant_sessions set lease_token=null,lease_until=null where workspace_id=${workspaceId} and id=${sessionId}`;
    }
    const turns = await sql<
      StoredTurn[]
    >`select id,message,request_id,status,response,error_code,error_message from public.assistant_turns
      where workspace_id=${workspaceId} and session_id=${sessionId} and created_at > now()-interval '30 days'
      order by created_at desc,id desc limit 20`;
    return {
      sessionId,
      version: row.version,
      context: currentContext(row),
      turns: turns.reverse(),
    };
  });
}
