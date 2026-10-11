import "server-only";
import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import type {
  WorkspaceMutation,
  WorkspaceOperation,
  WorkspaceState,
} from "../../domain/workspace/contracts";
import { kstInstant, kstDate } from "../../domain/workspace/dates";
import { WorkspaceError } from "../http/workspace-response";
import { getDatabase } from "./client";

type Tx = TransactionSql;
const tables = {
  person: "persons",
  meeting: "interactions",
  task: "workspace_tasks",
  action: "action_items",
  note: "memory_statements",
} as const;
const conflict = () =>
  new WorkspaceError(
    "VERSION_CONFLICT",
    "다른 기기에서 변경된 기록입니다. 최신 내용을 불러온 뒤 다시 확인해 주세요.",
    409,
  );

async function snapshot(tx: Tx, workspaceId: string): Promise<WorkspaceState> {
  const [
    people,
    meetings,
    participants,
    notes,
    tasks,
    actions,
    settings,
    mails,
  ] = await Promise.all([
    tx`select p.id,p.version,p.display_name as name,p.headline as job,p.relationship_status as status,
      p.importance,p.relationship_categories as "relationshipCategories",p.archived_at as "deletedAt",
      to_char(p.created_at at time zone 'Asia/Seoul','YYYY-MM-DD') as "createdAt",
      coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'displayAssetId',c.display_asset_id,'originalRetained',c.original_retained) order by c.created_at desc) from public.business_cards c where c.workspace_id=p.workspace_id and c.person_id=p.id),'[]'::jsonb) as "businessCards",
      (select o.name from public.affiliations a join public.organizations o on o.workspace_id=a.workspace_id and o.id=a.organization_id
        where a.workspace_id=p.workspace_id and a.person_id=p.id and a.is_current and a.verification_status='confirmed' order by a.updated_at desc,a.id limit 1) as company,
      (select value from public.person_attributes a where a.workspace_id=p.workspace_id and a.person_id=p.id and a.kind='email' and a.verification_status='confirmed' order by a.updated_at desc,a.id limit 1) as email,
      (select value from public.person_attributes a where a.workspace_id=p.workspace_id and a.person_id=p.id and a.kind='phone' and a.verification_status='confirmed' order by a.updated_at desc,a.id limit 1) as phone
      from public.persons p where p.workspace_id=${workspaceId} order by p.created_at,p.id`,
    tx`select i.id,i.version,i.archived_at as "deletedAt",coalesce(i.display_title,e.name,left(i.summary,150)) as name,
      i.summary as description,i.occurred_at as "occurredAt",to_char(i.occurred_at at time zone 'Asia/Seoul','YYYY-MM-DD') as date,
      i.place_type as "placeType",i.guests,i.event_url as "eventUrl",i.image_url as "imageUrl",i.image_source_url as "imageSourceUrl"
      from public.interactions i left join public.events e on e.workspace_id=i.workspace_id and e.id=i.event_id
      where i.workspace_id=${workspaceId} and i.verification_status='confirmed' order by i.occurred_at desc nulls last,i.id`,
    tx`select p.interaction_id as "meetingId",p.person_id as "personId",p.role from public.interaction_participants p
      join public.interactions i on i.workspace_id=p.workspace_id and i.id=p.interaction_id
      where p.workspace_id=${workspaceId} and i.verification_status='confirmed'`,
    tx`select m.id,m.version,m.person_id as "personId",m.body as text,m.archived_at as "deletedAt",
      to_char(m.occurred_at at time zone 'Asia/Seoul','YYYY-MM-DD') as date
      from public.memory_statements m where m.workspace_id=${workspaceId} and m.verification_status='confirmed'
      and (m.interaction_id is null or exists(select 1 from public.interactions i where i.workspace_id=m.workspace_id and i.id=m.interaction_id and i.archived_at is null and exists(select 1 from public.interaction_participants ip where ip.workspace_id=m.workspace_id and ip.interaction_id=m.interaction_id and ip.person_id=m.person_id)))
      order by m.created_at desc,m.id`,
    tx`select t.id,t.version,t.title as text,t.person_id as "personId",p.display_name as "personName",
      to_char(t.due_date,'YYYY-MM-DD') as date,left(t.due_time::text,5) as time,t.done,t.task_type as type,t.importance,
      t.archived_at as "deletedAt",to_char(t.created_at at time zone 'Asia/Seoul','YYYY-MM-DD') as "createdAt"
      from public.workspace_tasks t left join public.persons p on p.workspace_id=t.workspace_id and p.id=t.person_id
      where t.workspace_id=${workspaceId} order by t.created_at,t.id`,
    tx`select a.id,a.version,a.title as text,a.person_id as "personId",p.display_name as "personName",a.kind,
      to_char(a.due_at at time zone 'Asia/Seoul','YYYY-MM-DD') as date,
      case when a.due_has_time then to_char(a.due_at at time zone 'Asia/Seoul','HH24:MI') end as time,
      (a.status='completed') as done,a.ui_task_type as type,a.importance,a.archived_at as "deletedAt",
      to_char(a.created_at at time zone 'Asia/Seoul','YYYY-MM-DD') as "createdAt"
      from public.action_items a join public.persons p on p.workspace_id=a.workspace_id and p.id=a.person_id
      where a.workspace_id=${workspaceId} and a.verification_status='confirmed' and a.status<>'dismissed'
      and (a.interaction_id is null or exists(select 1 from public.interactions i where i.workspace_id=a.workspace_id and i.id=a.interaction_id and i.archived_at is null and exists(select 1 from public.interaction_participants ip where ip.workspace_id=a.workspace_id and ip.interaction_id=a.interaction_id and ip.person_id=a.person_id))) order by a.created_at,a.id`,
    tx`select persona,version from public.workspace_settings where workspace_id=${workspaceId}`,
    tx`select id,version,person_id as "personId",purpose,subject,body,reference,updated_at as "updatedAt",null as "deletedAt"
      from public.workspace_mail_drafts where workspace_id=${workspaceId} order by updated_at desc`,
  ]);
  // JSON conversion normalizes PostgreSQL Date objects at the HTTP boundary.
  return JSON.parse(
    JSON.stringify({
      people: people.map((p) => ({
        ...p,
        history: notes
          .filter((n) => n.personId === p.id)
          .map((note) => ({
            id: note.id,
            version: note.version,
            text: note.text,
            date: note.date,
            deletedAt: note.deletedAt,
          })),
      })),
      meetings,
      edges: participants.map((p) => ({
        id: `${p.meetingId}:${p.personId}`,
        meetingId: p.meetingId,
        personId: p.personId,
        deletedAt: null,
      })),
      personLinks: participants
        .filter((p) => p.role === "introduced_by")
        .flatMap((introducer) =>
          participants
            .filter(
              (p) =>
                p.meetingId === introducer.meetingId &&
                p.personId !== introducer.personId &&
                p.role === "contact",
            )
            .map((p) => ({
              id: `${p.meetingId}:${introducer.personId}:${p.personId}`,
              aId: introducer.personId,
              bId: p.personId,
              direction: "a-to-b",
            })),
        ),
      todos: [
        ...tasks.map((t) => ({ ...t, source: "task", kind: null })),
        ...actions.map((a) => ({ ...a, source: "action" })),
      ],
      persona: settings[0]?.persona,
      personaVersion: settings[0]?.version ?? 0,
      mailDrafts: mails,
      messages: [],
      appliedRequestIds: [],
      conflicts: [],
    }),
  ) as WorkspaceState;
}
export async function loadWorkspace(
  workspaceId: string,
): Promise<WorkspaceState> {
  return getDatabase().begin(
    "isolation level repeatable read read only",
    (tx) => snapshot(tx, workspaceId),
  );
}

async function requirePerson(tx: Tx, workspaceId: string, personId: string) {
  const rows =
    await tx`select id from public.persons where workspace_id=${workspaceId} and id=${personId} and archived_at is null for share`;
  if (!rows.length)
    throw new WorkspaceError(
      "PERSON_NOT_FOUND",
      "연결할 인맥이 없거나 삭제되었습니다.",
      404,
    );
}
async function checkVersion(
  tx: Tx,
  workspaceId: string,
  table: string,
  id: string,
  version: number | null,
  allowArchived = false,
) {
  const [row] =
    await tx`select *, to_jsonb(t.*) as before_value from ${tx(`public.${table}`)} t where workspace_id=${workspaceId} and id=${id} for update`;
  if (version === null) {
    if (row) throw conflict();
  } else if (!row)
    throw new WorkspaceError(
      "RECORD_NOT_FOUND",
      "기록을 찾을 수 없습니다.",
      404,
    );
  else if (row.version !== version || (!allowArchived && row.archived_at))
    throw conflict();
  return row;
}
async function audit(
  tx: Tx,
  workspaceId: string,
  requestId: string,
  entity: string,
  id: string,
  before: unknown,
) {
  await tx`insert into public.workspace_change_log(workspace_id,request_id,entity_type,entity_id,before_value)
    values(${workspaceId},${requestId},${entity},${id},${before == null ? null : tx.json(JSON.parse(JSON.stringify(before)))})`;
}

export async function mutateWorkspace(
  workspaceId: string,
  mutation: WorkspaceMutation,
): Promise<WorkspaceState> {
  const hash = createHash("sha256")
    .update(JSON.stringify(mutation.operations))
    .digest("hex");
  return getDatabase().begin(async (tx) => {
    const workspace =
      await tx`select id from public.workspaces where id=${workspaceId} for update`;
    if (!workspace.length)
      throw new WorkspaceError(
        "WORKSPACE_NOT_FOUND",
        "작업 공간을 찾을 수 없습니다.",
        404,
      );
    const [existing] =
      await tx`select payload_hash from public.workspace_mutations where workspace_id=${workspaceId} and request_id=${mutation.requestId}`;
    if (existing) {
      if (existing.payload_hash !== hash)
        throw new WorkspaceError(
          "IDEMPOTENCY_CONFLICT",
          "이전 저장 요청과 내용이 다릅니다.",
          409,
        );
      return snapshot(tx, workspaceId);
    }
    const affected = new Set<string>();
    for (const operation of mutation.operations)
      await applyOperation(
        tx,
        workspaceId,
        mutation.requestId,
        operation,
        affected,
      );
    for (const personId of affected)
      await tx`select app_private.rebuild_person_memory_document(${workspaceId}::uuid,${personId}::uuid)`;
    await tx`insert into public.workspace_mutations(workspace_id,request_id,payload_hash) values(${workspaceId},${mutation.requestId},${hash})`;
    return snapshot(tx, workspaceId);
  });
}

async function applyOperation(
  tx: Tx,
  workspaceId: string,
  requestId: string,
  op: WorkspaceOperation,
  affected: Set<string>,
) {
  if (op.type === "person.save") {
    const before = await checkVersion(
      tx,
      workspaceId,
      "persons",
      op.id,
      op.version,
    );
    await audit(
      tx,
      workspaceId,
      requestId,
      "person",
      op.id,
      before?.before_value,
    );
    const v = op.value;
    if (before)
      await tx`update public.persons set display_name=${v.name},normalized_name=${v.name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ")},headline=${v.job || null},relationship_status=${v.status},importance=${v.importance},relationship_categories=${v.relationshipCategories} where workspace_id=${workspaceId} and id=${op.id}`;
    else
      await tx`insert into public.persons(id,workspace_id,display_name,normalized_name,headline,relationship_status,importance,relationship_categories) values(${op.id},${workspaceId},${v.name},${v.name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ")},${v.job || null},${v.status},${v.importance},${v.relationshipCategories})`;
    for (const kind of ["email", "phone"] as const) {
      const value = v[kind] || null;
      const [current] =
        await tx`select value from public.person_attributes where workspace_id=${workspaceId} and person_id=${op.id} and kind=${kind} and verification_status='confirmed' order by updated_at desc,id limit 1`;
      if ((current?.value ?? null) === value) continue;
      await tx`update public.person_attributes set verification_status='rejected' where workspace_id=${workspaceId} and person_id=${op.id} and kind=${kind} and verification_status='confirmed'`;
      if (value)
        await tx`insert into public.person_attributes(workspace_id,person_id,kind,value,normalized_value,source_kind,verification_status) values(${workspaceId},${op.id},${kind},${value},${kind === "phone" ? value.replace(/[^\d+]/g, "") : value.toLowerCase()},'manual','confirmed')`;
    }
    const [current] =
      await tx`select a.id,o.name,a.title from public.affiliations a join public.organizations o on o.workspace_id=a.workspace_id and o.id=a.organization_id where a.workspace_id=${workspaceId} and a.person_id=${op.id} and a.is_current and a.verification_status='confirmed' order by a.updated_at desc,a.id limit 1`;
    if (
      (current?.name ?? null) !== (v.company || null) ||
      (current?.title ?? null) !== (v.job || null)
    ) {
      await tx`update public.affiliations set is_current=false where workspace_id=${workspaceId} and person_id=${op.id} and is_current`;
      if (v.company) {
        // Organization labels are reusable; person identity never resolves by name.
        let [org] =
          await tx`select id from public.organizations where workspace_id=${workspaceId} and normalized_name=${v.company.toLowerCase()} order by id limit 1`;
        if (!org)
          [org] =
            await tx`insert into public.organizations(workspace_id,name,normalized_name) values(${workspaceId},${v.company},${v.company.toLowerCase()}) returning id`;
        await tx`insert into public.affiliations(workspace_id,person_id,organization_id,title,source_kind,verification_status) values(${workspaceId},${op.id},${org.id},${v.job || null},'manual','confirmed')`;
      }
    }
    affected.add(op.id);
    return;
  }
  if (op.type === "meeting.save") {
    const before = await checkVersion(
      tx,
      workspaceId,
      "interactions",
      op.id,
      op.version,
    );
    const v = op.value;
    for (const id of new Set(v.personIds))
      await requirePerson(tx, workspaceId, id);
    const previous =
      await tx`select person_id from public.interaction_participants where workspace_id=${workspaceId} and interaction_id=${op.id}`;
    previous.forEach((p) => affected.add(p.person_id));
    v.personIds.forEach((id) => affected.add(id));
    await audit(
      tx,
      workspaceId,
      requestId,
      "meeting",
      op.id,
      before?.before_value,
    );
    const summary = v.description || v.name;
    if (before) {
      // Preserve the original instant when only non-date fields are edited.
      await tx`update public.interactions set display_title=${v.name},summary=${summary},
        occurred_at=case when to_char(occurred_at at time zone 'Asia/Seoul','YYYY-MM-DD') is not distinct from ${v.date} then occurred_at else ${kstInstant(v.date)}::timestamptz end,
        place_type=${v.placeType},guests=${[...new Set(v.guests)]},event_url=${v.eventUrl},image_url=${v.imageUrl},image_source_url=${v.imageSourceUrl}
        where workspace_id=${workspaceId} and id=${op.id}`;
      if (
        before.summary !== summary ||
        kstDate(before.occurred_at) !== v.date
      ) {
        // Old model-derived summaries may contradict a user's correction. Preserve, exclude, and rebuild.
        await tx`update public.memory_statements set archived_at=now() where workspace_id=${workspaceId} and interaction_id=${op.id} and source_kind='ai_inference' and archived_at is null`;
        await tx`update public.interaction_topics set verification_status='rejected' where workspace_id=${workspaceId} and interaction_id=${op.id} and source_kind='ai_inference'`;
      }
    } else
      await tx`insert into public.interactions(id,workspace_id,interaction_type,occurred_at,summary,display_title,place_type,guests,event_url,image_url,image_source_url,source_kind,verification_status)
      values(${op.id},${workspaceId},'meeting',${kstInstant(v.date)},${summary},${v.name},${v.placeType},${[...new Set(v.guests)]},${v.eventUrl},${v.imageUrl},${v.imageSourceUrl},'manual','confirmed')`;
    // Keep archived participants so restoring a person also restores its historical attendance.
    await tx`delete from public.interaction_participants ip using public.persons p where ip.workspace_id=${workspaceId} and ip.interaction_id=${op.id} and p.workspace_id=ip.workspace_id and p.id=ip.person_id and p.archived_at is null and not(ip.person_id=any(${v.personIds}::uuid[]))`;
    for (const id of new Set(v.personIds))
      await tx`insert into public.interaction_participants(workspace_id,interaction_id,person_id) values(${workspaceId},${op.id},${id}) on conflict do nothing`;
    return;
  }
  if (op.type === "task.save") {
    const table = op.source === "action" ? "action_items" : "workspace_tasks";
    if (op.source === "action" && op.version === null)
      throw new WorkspaceError(
        "INVALID_ACTION",
        "관계의 약속은 기록 검토에서 확정해 주세요.",
      );
    const before = await checkVersion(
      tx,
      workspaceId,
      table,
      op.id,
      op.version,
    );
    const v = op.value;
    if (v.personId) await requirePerson(tx, workspaceId, v.personId);
    await audit(
      tx,
      workspaceId,
      requestId,
      op.source,
      op.id,
      before?.before_value,
    );
    if (op.source === "action") {
      if (before!.person_id !== v.personId)
        throw new WorkspaceError(
          "ACTION_IDENTITY_CONFLICT",
          "저장된 약속의 인물은 변경할 수 없습니다.",
        );
      await tx`update public.action_items set title=${v.text},due_at=${kstInstant(v.date, v.time)},due_has_time=${!!v.time},status=${v.done ? "completed" : "pending"},completed_at=${v.done ? (before!.completed_at ?? new Date()) : null},ui_task_type=${v.type},importance=${v.importance}
        where workspace_id=${workspaceId} and id=${op.id}`;
      affected.add(v.personId!);
    } else if (before)
      await tx`update public.workspace_tasks set title=${v.text},person_id=${v.personId},due_date=${v.date},due_time=${v.time},done=${v.done},task_type=${v.type},importance=${v.importance} where workspace_id=${workspaceId} and id=${op.id}`;
    else
      await tx`insert into public.workspace_tasks(id,workspace_id,person_id,title,due_date,due_time,done,task_type,importance) values(${op.id},${workspaceId},${v.personId},${v.text},${v.date},${v.time},${v.done},${v.type},${v.importance})`;
    return;
  }
  if (op.type === "note.add") {
    await requirePerson(tx, workspaceId, op.personId);
    await checkVersion(tx, workspaceId, "memory_statements", op.id, null);
    await tx`insert into public.memory_statements(id,workspace_id,person_id,statement_type,body,source_kind,verification_status) values(${op.id},${workspaceId},${op.personId},'context',${op.text},'manual','confirmed')`;
    await audit(tx, workspaceId, requestId, "note", op.id, null);
    affected.add(op.personId);
    return;
  }
  if (op.type === "archive") {
    const table = tables[op.entity];
    const before = await checkVersion(
      tx,
      workspaceId,
      table,
      op.id,
      op.version,
      true,
    );
    await audit(
      tx,
      workspaceId,
      requestId,
      op.entity,
      op.id,
      before!.before_value,
    );
    await tx`update ${tx(`public.${table}`)} set archived_at=${op.archived ? new Date() : null} where workspace_id=${workspaceId} and id=${op.id}`;
    if (op.entity === "person") affected.add(op.id);
    else if (op.entity === "meeting") {
      const people =
        await tx`select person_id from public.interaction_participants where workspace_id=${workspaceId} and interaction_id=${op.id}`;
      people.forEach((p) => affected.add(p.person_id));
    } else if (op.entity !== "task" && before?.person_id)
      affected.add(before.person_id);
    return;
  }
  if (op.type === "persona.save") {
    const [before] =
      await tx`select persona,version from public.workspace_settings where workspace_id=${workspaceId} for update`;
    if ((before?.version ?? 0) !== op.version) throw conflict();
    await audit(
      tx,
      workspaceId,
      requestId,
      "persona",
      workspaceId,
      before?.persona,
    );
    await tx`insert into public.workspace_settings(workspace_id,persona) values(${workspaceId},${tx.json(op.value)}) on conflict(workspace_id) do update set persona=excluded.persona`;
    return;
  }
  if (op.type === "mail.save") {
    const before = await checkVersion(
      tx,
      workspaceId,
      "workspace_mail_drafts",
      op.id,
      op.version,
    );
    await requirePerson(tx, workspaceId, op.value.personId);
    await audit(
      tx,
      workspaceId,
      requestId,
      "mail",
      op.id,
      before?.before_value,
    );
    const v = op.value;
    if (before)
      await tx`update public.workspace_mail_drafts set person_id=${v.personId},purpose=${v.purpose},subject=${v.subject},body=${v.body},reference=${v.reference} where workspace_id=${workspaceId} and id=${op.id}`;
    else
      await tx`insert into public.workspace_mail_drafts(id,workspace_id,person_id,purpose,subject,body,reference) values(${op.id},${workspaceId},${v.personId},${v.purpose},${v.subject},${v.body},${v.reference})`;
  }
}
