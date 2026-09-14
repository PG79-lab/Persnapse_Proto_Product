begin;

create table public.golden_query_cases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  category text not null check (
    category in (
      'event',
      'topic',
      'place',
      'time',
      'organization',
      'interaction',
      'action',
      'identity_ambiguity'
    )
  ),
  label text not null check (length(btrim(label)) > 0),
  query_text text not null check (length(btrim(query_text)) > 0),
  reference_time timestamptz not null,
  expectation_status text not null default 'resolved' check (
    expectation_status in ('resolved', 'ambiguous', 'no_result')
  ),
  expected_person_ids uuid[] not null default '{}'::uuid[],
  expected_evidence_ids uuid[] not null default '{}'::uuid[],
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (
    expectation_status = 'no_result'
    or cardinality(expected_person_ids) > 0
  )
);

alter table public.queries
  add column reference_time timestamptz not null default now(),
  add column parser_version text not null default 'structured-v1',
  add column retrieval_version text not null default 'hybrid-v1',
  add column evaluation_case_id uuid,
  add column ai_run_id uuid,
  add column answer_status text check (
    answer_status in ('resolved', 'ambiguous', 'no_result', 'failed')
  ),
  add column answer_text text,
  add column response_payload jsonb not null default '{}'::jsonb,
  add column retrieval_trace jsonb not null default '{}'::jsonb,
  add constraint queries_workspace_id_evaluation_case_id_fkey
    foreign key (workspace_id, evaluation_case_id)
    references public.golden_query_cases(workspace_id, id)
    on delete set null (evaluation_case_id),
  add constraint queries_workspace_id_ai_run_id_fkey
    foreign key (workspace_id, ai_run_id)
    references public.ai_runs(workspace_id, id)
    on delete set null (ai_run_id);

alter table public.query_evidence
  add column source_entity_type text,
  add column source_entity_id uuid,
  add column evidence_excerpt text,
  add column source_occurred_at timestamptz,
  add column verification_status text not null default 'confirmed' check (
    verification_status in ('draft', 'confirmed', 'rejected')
  );

update public.query_evidence evidence
set source_entity_type = case
      when evidence.memory_statement_id is not null then 'memory_statement'
      else 'person_profile'
    end,
    source_entity_id = coalesce(evidence.memory_statement_id, evidence.memory_document_id),
    evidence_excerpt = coalesce(memory.body, document.content, evidence.reason),
    source_occurred_at = memory.occurred_at,
    verification_status = coalesce(memory.verification_status, 'confirmed')
from public.query_evidence current_evidence
left join public.memory_statements memory
  on memory.workspace_id = current_evidence.workspace_id
 and memory.id = current_evidence.memory_statement_id
left join public.memory_documents document
  on document.workspace_id = current_evidence.workspace_id
 and document.id = current_evidence.memory_document_id
where evidence.id = current_evidence.id;

alter table public.query_evidence
  alter column source_entity_type set not null,
  alter column source_entity_id set not null,
  alter column evidence_excerpt set not null,
  add constraint query_evidence_source_entity_type_check check (
    source_entity_type in (
      'person_profile',
      'affiliation',
      'event',
      'interaction',
      'memory_statement',
      'action_item'
    )
  ),
  drop constraint query_evidence_check,
  add constraint query_evidence_source_check check (
    memory_statement_id is not null
    or memory_document_id is not null
    or length(btrim(evidence_excerpt)) > 0
  );

create index golden_query_cases_workspace_category_idx
  on public.golden_query_cases (workspace_id, category, is_active);
create index queries_evaluation_case_idx
  on public.queries (workspace_id, evaluation_case_id, created_at desc);
create index memory_documents_content_fts_idx
  on public.memory_documents
  using gin (to_tsvector('simple', content));

drop function app_private.rebuild_memory_documents(uuid);

create function app_private.rebuild_memory_documents(target_workspace_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  delete from public.memory_documents
  where workspace_id = target_workspace_id
    and document_kind = 'person_profile';

  with profile_content as (
    select
      p.id as person_id,
      concat_ws(
        E'\n',
        '이름: ' || p.display_name,
        case when p.headline is not null then '소개: ' || p.headline end,
        case when affiliations.names is not null then '소속: ' || affiliations.names end,
        case when memories.items is not null then '확인된 기억: ' || memories.items end,
        case when interactions.items is not null then '확인된 상호작용: ' || interactions.items end
      ) as content,
      jsonb_build_object(
        'person_name', p.display_name,
        'projection_version', 2,
        'verification_policy', 'confirmed_only'
      ) as metadata
    from public.persons p
    left join lateral (
      select string_agg(
        o.name || coalesce(' · ' || a.title, ''),
        ', '
        order by a.is_current desc, o.name
      ) as names
      from public.affiliations a
      join public.organizations o
        on o.workspace_id = a.workspace_id
       and o.id = a.organization_id
      where a.workspace_id = p.workspace_id
        and a.person_id = p.id
        and a.verification_status = 'confirmed'
    ) affiliations on true
    left join lateral (
      select string_agg(
        ms.body,
        ' | '
        order by ms.occurred_at desc nulls last, ms.created_at desc
      ) as items
      from public.memory_statements ms
      where ms.workspace_id = p.workspace_id
        and ms.person_id = p.id
        and ms.verification_status = 'confirmed'
    ) memories on true
    left join lateral (
      select string_agg(
        to_char(i.occurred_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') || ' ' || i.summary,
        ' | '
        order by i.occurred_at desc
      ) as items
      from public.interaction_participants ip
      join public.interactions i
        on i.workspace_id = ip.workspace_id
       and i.id = ip.interaction_id
      where ip.workspace_id = p.workspace_id
        and ip.person_id = p.id
        and i.verification_status = 'confirmed'
    ) interactions on true
    where p.workspace_id = target_workspace_id
  )
  insert into public.memory_documents (
    id,
    workspace_id,
    person_id,
    document_kind,
    content,
    content_hash,
    metadata
  )
  select
    md5(person_id::text || ':person_profile')::uuid,
    target_workspace_id,
    person_id,
    'person_profile',
    content,
    encode(extensions.digest(content, 'sha256'), 'hex'),
    metadata
  from profile_content;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

do $$
declare
  workspace record;
begin
  for workspace in select id from public.workspaces
  loop
    perform app_private.rebuild_memory_documents(workspace.id);
  end loop;
end;
$$;

create trigger golden_query_cases_set_updated_at
before update on public.golden_query_cases
for each row execute function app_private.set_updated_at();

alter table public.golden_query_cases enable row level security;

create policy workspace_isolation
on public.golden_query_cases
for all
to authenticated
using (workspace_id = app_private.request_workspace_id())
with check (workspace_id = app_private.request_workspace_id());

revoke all on table public.golden_query_cases from anon;
revoke all on table public.golden_query_cases from authenticated;
grant select, insert, update, delete on table public.golden_query_cases to authenticated;
grant all on table public.golden_query_cases to service_role;

revoke all on function app_private.rebuild_memory_documents(uuid) from public;

commit;
