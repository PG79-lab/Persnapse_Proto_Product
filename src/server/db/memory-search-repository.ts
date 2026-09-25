import "server-only";
import { createAiAttemptRecorder } from "./ai-run-repository";
import { getDatabase } from "./client";
import { AssistantProvider } from "../ai/assistant-provider";
import { reserveAiCall } from "./ai-budget-repository";
import { getServerEnv } from "../env";
import { AiTaskExecutionError } from "../ai/runtime-router";
import {
  planDateRange,
  type QueryPlan,
} from "../../domain/recall/assistant-contract";

export async function indexPersonMemory(
  workspaceId: string,
  personId: string,
): Promise<void> {
  const env = getServerEnv();
  if (env.AI_ROUTING_MODE !== "live") return;
  const sql = getDatabase();
  const [doc] = await sql<
    { id: string; content: string; content_hash: string }[]
  >`
    update public.memory_documents
    set embedding_status = 'processing', embedding_updated_at = now(), embedding_attempts = embedding_attempts + 1
    where workspace_id = ${workspaceId} and person_id = ${personId} and document_kind = 'person_profile'
      and (embedding_status in ('pending','failed') or
           (embedding_status = 'ready' and embedding_model is distinct from ${env.VOYAGE_EMBEDDING_MODEL}) or
           (embedding_status = 'processing' and embedding_updated_at < now() - interval '2 minutes'))
    returning id, content, content_hash
  `;
  if (!doc) {
    const [current] = await sql<
      { ready: boolean }[]
    >`select (embedding_status = 'ready' and embedding_model = ${env.VOYAGE_EMBEDDING_MODEL}) as ready
      from public.memory_documents where workspace_id = ${workspaceId} and person_id = ${personId} and document_kind = 'person_profile'`;
    if (!current?.ready)
      throw new AiTaskExecutionError(
        "기억은 저장되었지만 검색 준비가 완료되지 않았습니다.",
        "SEARCH_NOT_READY",
        false,
      );
    return;
  }
  try {
    const provider = new AssistantProvider(
      env,
      (task) => reserveAiCall(workspaceId, task, env),
      createAiAttemptRecorder({ workspaceId, schemaVersion: "assistant-v1" }),
    );
    const vector = await provider.embed(doc.content, "document");
    const rows = await sql`update public.memory_documents
      set embedding = ${JSON.stringify(vector)}::extensions.vector, embedding_model = ${env.VOYAGE_EMBEDDING_MODEL},
          embedding_status = 'ready', embedding_updated_at = now(), embedding_error_code = null
      where workspace_id = ${workspaceId} and id = ${doc.id} and content_hash = ${doc.content_hash} and embedding_status = 'processing'
      returning id`;
    if (!rows.length)
      throw new AiTaskExecutionError(
        "저장 내용이 변경되어 검색을 다시 준비해야 합니다.",
        "SEARCH_STALE",
        false,
      );
  } catch (error) {
    await sql`update public.memory_documents set embedding_status = 'failed', embedding_error_code = 'INDEXING_FAILED'
      where workspace_id = ${workspaceId} and id = ${doc.id} and content_hash = ${doc.content_hash} and embedding_status = 'processing'`;
    throw error;
  }
}

export async function assertSearchReady(
  workspaceId: string,
  model: string,
): Promise<void> {
  const [row] = await getDatabase()<{ incomplete: number }[]>`
    select count(*)::int as incomplete from public.persons person
    left join public.memory_documents doc on doc.workspace_id = person.workspace_id and doc.person_id = person.id and doc.document_kind = 'person_profile'
    where person.workspace_id = ${workspaceId}
      and (doc.id is null or doc.embedding_status <> 'ready' or doc.embedding_model is distinct from ${model})
  `;
  if (row.incomplete)
    throw new AiTaskExecutionError(
      "저장된 기억의 검색 준비가 아직 완료되지 않았습니다. 기억은 보존되어 있습니다.",
      "SEARCH_NOT_READY",
      false,
    );
}

export async function retrieveMemoryCandidates(
  workspaceId: string,
  vector: number[],
  model: string,
  plan: QueryPlan,
  reference: Date,
) {
  const range = planDateRange(plan, reference);
  const sql = getDatabase();
  return sql<{ person_id: string; content: string }[]>`
    with semantic as (
      select person_id, content, embedding OPERATOR(extensions.<=>) ${JSON.stringify(vector)}::extensions.vector as distance
      from public.memory_documents where workspace_id = ${workspaceId} and document_kind = 'person_profile'
        and embedding_status = 'ready' and embedding_model = ${model}
      order by distance limit 24
    ), explicit_candidates as (
      select doc.person_id, doc.content, -1::double precision as distance
      from public.memory_documents doc join public.persons p on p.workspace_id = doc.workspace_id and p.id = doc.person_id
      where doc.workspace_id = ${workspaceId} and doc.document_kind = 'person_profile'
        and doc.embedding_status = 'ready' and doc.embedding_model = ${model}
        and ((${plan.personName}::text is not null and p.display_name = ${plan.personName}) or
          (${plan.intent === "action"} and exists (
            select 1 from public.action_items a where a.workspace_id = doc.workspace_id and a.person_id = doc.person_id
              and a.status = 'pending' and a.verification_status = 'confirmed'
              and (${range === null || plan.timeTarget !== "action_due"} or
                (a.due_at >= ${range?.from ?? null}::timestamptz and a.due_at < ${range?.to ?? null}::timestamptz))
          )))
      order by doc.person_id limit 24
    )
    select person_id, content from (select * from semantic union all select * from explicit_candidates) candidates
    group by person_id, content order by min(distance), person_id limit 32
  `;
}
