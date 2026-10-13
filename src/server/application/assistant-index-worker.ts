import "server-only";
import { randomUUID } from "node:crypto";
import { getDatabase } from "../db/client";
import { getServerEnv } from "../env";
import { reserveAiCall } from "../db/ai-budget-repository";
import { AssistantProvider } from "../ai/assistant-provider";
import { createAiAttemptRecorder } from "../db/ai-run-repository";
export type IndexJob = {
  id: string;
  unit_id: string;
  content_hash: string;
  content: string;
  attempts: number;
  lease_token: string;
};
export function retryPolicy(
  code: string,
  attempt: number,
  retryAfter?: number,
) {
  if (code === "AI_RATE_LIMITED")
    return {
      status: "pending" as const,
      delay: Math.max(60, retryAfter ?? 60),
      refund: true,
    };
  const retryable =
    ["AI_REQUEST_FAILED", "AI_PROVIDER_RATE_LIMITED"].includes(code) ||
    /^AI_HTTP_5\d\d$/.test(code);
  return {
    status: retryable && attempt < 3 ? ("failed" as const) : ("dead" as const),
    delay: Math.max([30, 120, 600][Math.min(2, attempt - 1)], retryAfter ?? 0),
    refund: false,
  };
}
export async function reconcileIndexModel(workspaceId: string, model: string) {
  await getDatabase().begin(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${"assistant-projection:" + workspaceId},0))`;
    await sql`update public.memory_search_units set embedding=null,embedding_model=null,embedding_status='pending'
      where workspace_id=${workspaceId} and embedding_model is not null and embedding_model<>${model}`;
    await sql`insert into public.memory_index_jobs(workspace_id,unit_id,content_hash,target_model)
      select workspace_id,id,content_hash,${model} from public.memory_search_units where workspace_id=${workspaceId} and embedding_status='pending'
      on conflict(workspace_id,unit_id) do update set content_hash=excluded.content_hash,target_model=excluded.target_model,
        status='pending',attempts=0,lease_token=null,lease_until=null,error_code=null,next_attempt_at=now()
      where public.memory_index_jobs.content_hash<>excluded.content_hash or public.memory_index_jobs.target_model is distinct from excluded.target_model`;
    await sql`update public.memory_index_jobs set status='dead',lease_token=null,lease_until=null,error_code='LEASE_RETRY_EXHAUSTED'
      where workspace_id=${workspaceId} and status='processing' and lease_until<=now() and attempts>=3`;
    await sql`update public.memory_search_units u set embedding_status='failed'
      where u.workspace_id=${workspaceId} and u.embedding_status='processing' and exists(
        select 1 from public.memory_index_jobs j where j.workspace_id=u.workspace_id and j.unit_id=u.id and j.status='dead')`;
  });
}
export async function claimIndexJob(
  workspaceId: string,
  model: string,
): Promise<IndexJob | null> {
  const token = randomUUID();
  return getDatabase().begin(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${"assistant-projection:" + workspaceId},0))`;
    const [job] = await sql<
      IndexJob[]
    >`with candidate as (select j.id from public.memory_index_jobs j
      join public.memory_search_units u on u.workspace_id=j.workspace_id and u.id=j.unit_id and u.content_hash=j.content_hash
      where j.workspace_id=${workspaceId} and j.target_model=${model} and j.attempts<3 and j.next_attempt_at<=now()
        and (j.status in ('pending','failed') or (j.status='processing' and j.lease_until<=now()))
      order by j.next_attempt_at,j.id for update of j skip locked limit 1)
      update public.memory_index_jobs j set status='processing',lease_token=${token},lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now()
      from candidate c where j.id=c.id returning j.id,j.unit_id,j.content_hash,j.attempts,j.lease_token`;
    if (!job) return null;
    const [unit] = await sql<
      { content: string }[]
    >`update public.memory_search_units set embedding_status='processing'
      where workspace_id=${workspaceId} and id=${job.unit_id} and content_hash=${job.content_hash} returning content`;
    return unit ? { ...job, content: unit.content } : null;
  });
}
export async function finishIndexJob(
  workspaceId: string,
  model: string,
  job: IndexJob,
  vector: number[],
) {
  return getDatabase().begin(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${"assistant-projection:" + workspaceId},0))`;
    const lease =
      await sql`select id from public.memory_index_jobs where workspace_id=${workspaceId} and id=${job.id}
      and lease_token=${job.lease_token} and content_hash=${job.content_hash} and target_model=${model} and status='processing' and lease_until>now() for update`;
    if (!lease.length) return false;
    const updated =
      await sql`update public.memory_search_units set embedding=${JSON.stringify(vector)}::extensions.vector,
      embedding_model=${model},embedding_status='ready',updated_at=now()
      where workspace_id=${workspaceId} and id=${job.unit_id} and content_hash=${job.content_hash} returning id`;
    if (!updated.length) return false;
    await sql`update public.memory_index_jobs set status='done',lease_token=null,lease_until=null,error_code=null,updated_at=now()
      where workspace_id=${workspaceId} and id=${job.id} and lease_token=${job.lease_token}`;
    return true;
  });
}
export async function failIndexJob(
  workspaceId: string,
  job: IndexJob,
  code: string,
  retryAfter?: number,
) {
  const policy = retryPolicy(code, job.attempts, retryAfter);
  await getDatabase().begin(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${"assistant-projection:" + workspaceId},0))`;
    const rows =
      await sql`update public.memory_index_jobs set status=${policy.status},error_code=${code},lease_token=null,lease_until=null,
      attempts=attempts-${policy.refund ? 1 : 0},next_attempt_at=now()+${policy.delay}*interval '1 second',updated_at=now()
      where workspace_id=${workspaceId} and id=${job.id} and lease_token=${job.lease_token} and content_hash=${job.content_hash} returning id`;
    if (rows.length)
      await sql`update public.memory_search_units set embedding_status='failed'
      where workspace_id=${workspaceId} and id=${job.unit_id} and content_hash=${job.content_hash}`;
  });
}
export async function retryAssistantIndexJobs(workspaceId: string) {
  await getDatabase().begin(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${"assistant-projection:" + workspaceId},0))`;
    await sql`update public.memory_index_jobs set status='pending',attempts=0,next_attempt_at=now(),error_code=null,
      lease_token=null,lease_until=null where workspace_id=${workspaceId} and id in(
      select id from public.memory_index_jobs where workspace_id=${workspaceId} and status in ('dead','failed')
      order by next_attempt_at,id limit 10)`;
  });
}
export async function runAssistantIndexBatch(workspaceId: string) {
  const env = getServerEnv();
  if (
    env.ASSISTANT_INDEX_WORKER_ENABLED !== "on" ||
    env.AI_ROUTING_MODE !== "live"
  )
    return { enabled: false, attempted: 0, completed: 0, failed: 0 };
  await reconcileIndexModel(workspaceId, env.VOYAGE_EMBEDDING_MODEL);
  const provider = new AssistantProvider(
    env,
    () => reserveAiCall(workspaceId, "assistant_index_embedding", env),
    createAiAttemptRecorder({
      workspaceId,
      schemaVersion: "assistant-index-v1",
    }),
  );
  const result = { enabled: true, attempted: 0, completed: 0, failed: 0 };
  const started = Date.now();
  while (result.attempted < 10 && Date.now() - started < 20000) {
    const job = await claimIndexJob(workspaceId, env.VOYAGE_EMBEDDING_MODEL);
    if (!job) break;
    result.attempted++;
    try {
      if (
        await finishIndexJob(
          workspaceId,
          env.VOYAGE_EMBEDDING_MODEL,
          job,
          await provider.embed(job.content, "document"),
        )
      )
        result.completed++;
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? String(error.code)
          : "INDEX_FAILED";
      const retry =
        error instanceof Error && "retryAfterSeconds" in error
          ? Number(error.retryAfterSeconds)
          : undefined;
      await failIndexJob(workspaceId, job, code, retry);
      result.failed++;
      if (
        [
          "AI_RATE_LIMITED",
          "AI_PROVIDER_RATE_LIMITED",
          "AI_CONFIGURATION_ERROR",
        ].includes(code)
      )
        break;
    }
  }
  return result;
}
