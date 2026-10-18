import "server-only";
import { getDatabase } from "./client";
import type { AssistantPlan } from "../../domain/assistant/contracts";
import type { MemoryCandidate } from "../../domain/assistant/retrieval";
import type {
  RecallCorpusPerson,
  RecallProvenance,
} from "../../domain/recall/types";

type CandidateRow = {
  kind: string;
  source_id: string;
  person_ids: string[];
  content: string;
};
const candidate = (r: CandidateRow): MemoryCandidate => ({
  key: r.kind + ":" + r.source_id,
  personIds: r.person_ids,
  content: r.content.slice(0, 4000),
  sourceKeys: [r.kind + ":" + r.source_id],
});
export async function listAssistantPeople(workspaceId: string) {
  return getDatabase()<
    { id: string; name: string }[]
  >`select id,display_name as name from public.persons where workspace_id=${workspaceId} and archived_at is null order by display_name,id`;
}
export async function validateContextSelection(
  workspaceId: string,
  personIds: string[],
  interactionId: string | null,
) {
  const sql = getDatabase();
  const people = await sql<
    { id: string }[]
  >`select id from public.persons where workspace_id=${workspaceId} and id=any(${personIds}::uuid[]) and archived_at is null`;
  if (people.length !== personIds.length) return false;
  if (interactionId) {
    const meetings =
      await sql`select i.id from public.interactions i where i.workspace_id=${workspaceId} and i.id=${interactionId}
      and i.archived_at is null and i.verification_status='confirmed' and (cardinality(${personIds}::uuid[])=0 or exists(
        select 1 from public.interaction_participants ip where ip.workspace_id=i.workspace_id and ip.interaction_id=i.id and ip.person_id=any(${personIds}::uuid[])))`;
    if (!meetings.length) return false;
  }
  return true;
}
export async function retrieveCanonicalCandidates(
  workspaceId: string,
  query: string,
  plan: AssistantPlan,
) {
  const sql = getDatabase();
  const words =
    query
      .normalize("NFKC")
      .toLocaleLowerCase("ko-KR")
      .match(/[\p{L}\p{N}]{2,}/gu)
      ?.slice(0, 12) ?? [];
  const tokens = [
    ...new Set(
      words.flatMap((word) => {
        const stem = word.replace(
          /(에서|에게|으로|이랑|하고|은|는|이|가|을|를|도|와|과|의)$/u,
          "",
        );
        return stem.length >= 2 ? [word, stem] : [word];
      }),
    ),
  ];
  const base = await sql<
    CandidateRow[]
  >`select c.kind,c.source_id,c.person_ids,c.content from app_private.assistant_canonical_units c
    where c.workspace_id=${workspaceId}
      and (cardinality(${plan.personIds}::uuid[])=0 or c.person_ids && ${plan.personIds}::uuid[])
      and (${plan.interactionId}::uuid is null or c.interaction_id=${plan.interactionId})
      and (${plan.actionKind}::text is null or (c.kind in ('action_item','workspace_task') and c.action_kind=${plan.actionKind}))
      and (${plan.purpose !== "prioritize"} or (c.kind in ('action_item','workspace_task') and c.action_status='pending'))
      and (${plan.meetingRange?.from ?? null}::date is null or (c.occurred_at>=(${plan.meetingRange?.from ?? null}::date::timestamp at time zone 'Asia/Seoul') and c.occurred_at<(${plan.meetingRange?.toExclusive ?? null}::date::timestamp at time zone 'Asia/Seoul')))
      and (${plan.dueRange?.from ?? null}::date is null or (c.kind in ('action_item','workspace_task') and c.action_status='pending' and c.due_at>=(${plan.dueRange?.from ?? null}::date::timestamp at time zone 'Asia/Seoul') and c.due_at<(${plan.dueRange?.toExclusive ?? null}::date::timestamp at time zone 'Asia/Seoul')))
      and (cardinality(${plan.personIds}::uuid[])>0 or ${plan.purpose === "prioritize"} or ${!!plan.actionKind} or (${plan.purpose === "summarize" && plan.conditions.length === 0}) or exists(
        select 1 from unnest(${tokens}::text[]) t where position(t in lower(c.content))>0))
    order by (c.kind in ('action_item','workspace_task') and c.action_status='pending') desc,
      (select count(*) from unnest(${tokens}::text[]) t where position(t in lower(c.content))>0) desc,
      c.due_at asc nulls last,c.occurred_at desc nulls last,c.source_id limit 25`;
  return {
    candidates: base.slice(0, 24).map(candidate),
    truncated: base.length > 24,
  };
}
export async function retrieveUnitVectors(
  workspaceId: string,
  vector: number[],
  model: string,
  plan: AssistantPlan,
) {
  const rows = await getDatabase()<
    CandidateRow[]
  >`select c.kind,c.source_id,c.person_ids,u.content
    from public.memory_search_units u join app_private.assistant_canonical_units c on c.workspace_id=u.workspace_id and c.kind=u.kind and c.source_id=u.source_id
    where u.workspace_id=${workspaceId} and u.embedding_status='ready' and u.embedding_model=${model}
      and (cardinality(${plan.personIds}::uuid[])=0 or c.person_ids && ${plan.personIds}::uuid[])
      and (${plan.interactionId}::uuid is null or c.interaction_id=${plan.interactionId})
      and (${plan.actionKind}::text is null or (c.kind in ('action_item','workspace_task') and c.action_kind=${plan.actionKind}))
      and (${plan.purpose !== "prioritize"} or (c.kind in ('action_item','workspace_task') and c.action_status='pending'))
      and (${plan.meetingRange?.from ?? null}::date is null or (c.occurred_at>=(${plan.meetingRange?.from ?? null}::date::timestamp at time zone 'Asia/Seoul') and c.occurred_at<(${plan.meetingRange?.toExclusive ?? null}::date::timestamp at time zone 'Asia/Seoul')))
      and (${plan.dueRange?.from ?? null}::date is null or (c.kind in ('action_item','workspace_task') and c.action_status='pending' and c.due_at>=(${plan.dueRange?.from ?? null}::date::timestamp at time zone 'Asia/Seoul') and c.due_at<(${plan.dueRange?.toExclusive ?? null}::date::timestamp at time zone 'Asia/Seoul')))
    order by u.embedding operator(extensions.<=>) ${JSON.stringify(vector)}::extensions.vector limit 24`;
  return rows.map(candidate);
}
export async function inspectUnitReadiness(workspaceId: string, model: string) {
  const [row] = await getDatabase()<
    { total: number; prepared: number }[]
  >`select count(*)::int as total,
    count(*) filter(where embedding_status='ready' and embedding_model=${model})::int as prepared
    from public.memory_search_units where workspace_id=${workspaceId}`;
  const [canonical] = await getDatabase()<
    { missing: number }[]
  >`select count(*)::int as missing from app_private.assistant_canonical_units c where workspace_id=${workspaceId}
    and not exists(select 1 from public.memory_search_units u where u.workspace_id=c.workspace_id and u.kind=c.kind and u.source_id=c.source_id)`;
  return { ...row, missingProjection: canonical.missing > 0 };
}
export async function attachAssistantProvenance(
  workspaceId: string,
  people: RecallCorpusPerson[],
) {
  const keys = people.flatMap((p) => p.evidence.map((e) => e.id));
  if (!keys.length) return;
  const rows = await getDatabase()<
    {
      entity_type: string;
      entity_id: string;
      source_kind: string;
      source_ref: string | null;
      captured_at: Date;
      raw_text: string | null;
    }[]
  >`
    select pr.entity_type,pr.entity_id,pr.source_kind,pr.source_ref,pr.captured_at,left(cs.raw_text,1600) as raw_text
    from public.provenance_records pr left join public.capture_sessions cs on cs.workspace_id=pr.workspace_id
      and pr.source_ref='capture_session:'||cs.id::text and cs.state='committed'
    where pr.workspace_id=${workspaceId} and pr.entity_id=any(${keys}::uuid[]) and pr.verification_status='confirmed'
    order by pr.captured_at desc limit 48`;
  for (const person of people)
    for (const evidence of person.evidence) {
      const kind =
        evidence.type === "person_profile" ? "person" : evidence.type;
      const seen = new Set<string>();
      evidence.provenance = rows
        .filter((r) => r.entity_type === kind && r.entity_id === evidence.id)
        .map((r): RecallProvenance => ({
          sourceKind: r.source_kind,
          sourceRef: r.source_ref,
          capturedAt: new Date(r.captured_at).toISOString(),
          originalText: r.raw_text,
        }))
        .filter((source) => {
          const key = JSON.stringify(source);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 2);
    }
}
