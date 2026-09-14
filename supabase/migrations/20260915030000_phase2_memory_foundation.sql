begin;

create schema if not exists extensions;
create schema if not exists app_private;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app_private.request_workspace_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'workspace_id', '')::uuid;
$$;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  locale text not null default 'ko-KR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task text not null,
  provider text not null,
  model text not null,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'mocked')),
  schema_version text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  input_units bigint check (input_units is null or input_units >= 0),
  output_units bigint check (output_units is null or output_units >= 0),
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, id)
);

create table public.capture_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  state text not null default 'draft' check (state in ('draft', 'review', 'committed', 'failed')),
  input_kind text not null check (input_kind in ('manual', 'business_card', 'note', 'voice', 'import')),
  raw_text text,
  structured_draft jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  ai_run_id uuid,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, ai_run_id)
    references public.ai_runs(workspace_id, id)
    on delete set null (ai_run_id)
);

create table public.source_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  capture_session_id uuid,
  asset_kind text not null check (asset_kind in ('image', 'audio', 'text', 'file')),
  storage_path text,
  mime_type text,
  sha256 text,
  original_filename text,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, capture_session_id)
    references public.capture_sessions(workspace_id, id)
    on delete set null (capture_session_id),
  check (storage_path is not null or asset_kind = 'text')
);

create table public.persons (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) > 0),
  normalized_name text not null check (length(btrim(normalized_name)) > 0),
  headline text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);

comment on column public.persons.normalized_name is
  'Search aid only. Duplicate names are valid and must never be merged automatically.';

create table public.person_attributes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid not null,
  kind text not null check (kind in ('email', 'phone', 'website', 'linkedin', 'other')),
  value text not null check (length(btrim(value)) > 0),
  normalized_value text,
  source_kind text not null check (source_kind in ('manual', 'business_card', 'note', 'voice', 'import', 'ai_inference', 'system')),
  verification_status text not null default 'draft' check (verification_status in ('draft', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, person_id)
    references public.persons(workspace_id, id)
    on delete cascade
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  normalized_name text not null check (length(btrim(normalized_name)) > 0),
  website text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table public.affiliations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid not null,
  organization_id uuid not null,
  title text,
  valid_from date,
  valid_to date,
  is_current boolean not null default true,
  source_kind text not null check (source_kind in ('manual', 'business_card', 'note', 'voice', 'import', 'ai_inference', 'system')),
  verification_status text not null default 'draft' check (verification_status in ('draft', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, person_id)
    references public.persons(workspace_id, id)
    on delete cascade,
  foreign key (workspace_id, organization_id)
    references public.organizations(workspace_id, id)
    on delete cascade,
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (ends_at is null or ends_at >= starts_at)
);

create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_id uuid,
  interaction_type text not null check (interaction_type in ('meeting', 'call', 'email', 'message', 'event', 'note')),
  occurred_at timestamptz not null,
  captured_at timestamptz not null default now(),
  location text,
  summary text not null check (length(btrim(summary)) > 0),
  source_kind text not null check (source_kind in ('manual', 'business_card', 'note', 'voice', 'import', 'ai_inference', 'system')),
  verification_status text not null default 'draft' check (verification_status in ('draft', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, event_id)
    references public.events(workspace_id, id)
    on delete set null (event_id)
);

create table public.interaction_participants (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  interaction_id uuid not null,
  person_id uuid not null,
  role text not null default 'contact' check (role in ('contact', 'introduced_by', 'mentioned')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, interaction_id, person_id),
  foreign key (workspace_id, interaction_id)
    references public.interactions(workspace_id, id)
    on delete cascade,
  foreign key (workspace_id, person_id)
    references public.persons(workspace_id, id)
    on delete cascade
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  normalized_name text not null check (length(btrim(normalized_name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, normalized_name)
);

create table public.interaction_topics (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  interaction_id uuid not null,
  topic_id uuid not null,
  source_kind text not null check (source_kind in ('manual', 'business_card', 'note', 'voice', 'import', 'ai_inference', 'system')),
  verification_status text not null default 'draft' check (verification_status in ('draft', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, interaction_id, topic_id),
  foreign key (workspace_id, interaction_id)
    references public.interactions(workspace_id, id)
    on delete cascade,
  foreign key (workspace_id, topic_id)
    references public.topics(workspace_id, id)
    on delete cascade
);

create table public.memory_statements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid,
  interaction_id uuid,
  statement_type text not null check (statement_type in ('fact', 'preference', 'interest', 'need', 'relationship', 'context')),
  body text not null check (length(btrim(body)) > 0),
  occurred_at timestamptz,
  source_kind text not null check (source_kind in ('manual', 'business_card', 'note', 'voice', 'import', 'ai_inference', 'system')),
  verification_status text not null default 'draft' check (verification_status in ('draft', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, person_id)
    references public.persons(workspace_id, id)
    on delete cascade,
  foreign key (workspace_id, interaction_id)
    references public.interactions(workspace_id, id)
    on delete set null (interaction_id),
  check (person_id is not null or interaction_id is not null)
);

create table public.action_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid not null,
  interaction_id uuid,
  kind text not null check (kind in ('commitment', 'follow_up', 'suggestion')),
  title text not null check (length(btrim(title)) > 0),
  details text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'dismissed')),
  due_at timestamptz,
  completed_at timestamptz,
  source_kind text not null check (source_kind in ('manual', 'business_card', 'note', 'voice', 'import', 'ai_inference', 'system')),
  verification_status text not null default 'draft' check (verification_status in ('draft', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, person_id)
    references public.persons(workspace_id, id)
    on delete cascade,
  foreign key (workspace_id, interaction_id)
    references public.interactions(workspace_id, id)
    on delete set null (interaction_id),
  check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create table public.provenance_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('person', 'person_attribute', 'organization', 'affiliation', 'event', 'interaction', 'memory_statement', 'action_item')),
  entity_id uuid not null,
  field_name text,
  source_kind text not null check (source_kind in ('manual', 'business_card', 'note', 'voice', 'import', 'ai_inference', 'system')),
  source_ref text,
  source_asset_id uuid,
  ai_run_id uuid,
  verification_status text not null default 'draft' check (verification_status in ('draft', 'confirmed', 'rejected')),
  confidence numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, source_asset_id)
    references public.source_assets(workspace_id, id)
    on delete set null (source_asset_id),
  foreign key (workspace_id, ai_run_id)
    references public.ai_runs(workspace_id, id)
    on delete set null (ai_run_id)
);

comment on column public.provenance_records.entity_id is
  'Polymorphic source target. Application and verification jobs enforce the entity_type mapping.';

create table public.memory_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid,
  interaction_id uuid,
  document_kind text not null check (document_kind in ('person_profile', 'interaction', 'memory_statement')),
  content text not null check (length(btrim(content)) > 0),
  content_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding_model text,
  embedding_dimensions integer check (embedding_dimensions is null or embedding_dimensions > 0),
  embedding extensions.vector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, person_id)
    references public.persons(workspace_id, id)
    on delete cascade,
  foreign key (workspace_id, interaction_id)
    references public.interactions(workspace_id, id)
    on delete cascade,
  check (person_id is not null or interaction_id is not null)
);

comment on table public.memory_documents is
  'Derived search projection. Canonical facts remain in normalized relational tables.';

create table public.queries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  query_text text not null check (length(btrim(query_text)) > 0),
  parsed_query jsonb not null default '{}'::jsonb,
  status text not null default 'received' check (status in ('received', 'searching', 'completed', 'failed')),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, id)
);

create table public.query_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  query_id uuid not null,
  person_id uuid not null,
  memory_statement_id uuid,
  memory_document_id uuid,
  rank integer not null check (rank > 0),
  score numeric,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, query_id, rank),
  foreign key (workspace_id, query_id)
    references public.queries(workspace_id, id)
    on delete cascade,
  foreign key (workspace_id, person_id)
    references public.persons(workspace_id, id)
    on delete cascade,
  foreign key (workspace_id, memory_statement_id)
    references public.memory_statements(workspace_id, id)
    on delete set null (memory_statement_id),
  foreign key (workspace_id, memory_document_id)
    references public.memory_documents(workspace_id, id)
    on delete set null (memory_document_id),
  check (memory_statement_id is not null or memory_document_id is not null)
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  query_id uuid,
  kind text not null check (kind in ('helpful', 'not_helpful', 'wrong_person', 'missing_context', 'other')),
  rating smallint check (rating is null or rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, query_id)
    references public.queries(workspace_id, id)
    on delete set null (query_id)
);

create index persons_workspace_normalized_name_idx
  on public.persons (workspace_id, normalized_name);
create index person_attributes_person_idx
  on public.person_attributes (workspace_id, person_id);
create index organizations_workspace_normalized_name_idx
  on public.organizations (workspace_id, normalized_name);
create index affiliations_person_current_idx
  on public.affiliations (workspace_id, person_id, is_current desc);
create index interactions_workspace_occurred_at_idx
  on public.interactions (workspace_id, occurred_at desc);
create index interaction_participants_person_idx
  on public.interaction_participants (workspace_id, person_id, interaction_id);
create index memory_statements_person_occurred_at_idx
  on public.memory_statements (workspace_id, person_id, occurred_at desc);
create index action_items_person_status_due_idx
  on public.action_items (workspace_id, person_id, status, due_at);
create index provenance_records_entity_idx
  on public.provenance_records (workspace_id, entity_type, entity_id);
create index memory_documents_person_idx
  on public.memory_documents (workspace_id, person_id, document_kind);
create index queries_workspace_created_at_idx
  on public.queries (workspace_id, created_at desc);
create index query_evidence_query_rank_idx
  on public.query_evidence (workspace_id, query_id, rank);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'capture_sessions',
    'persons',
    'person_attributes',
    'organizations',
    'affiliations',
    'events',
    'interactions',
    'topics',
    'memory_statements',
    'action_items',
    'memory_documents'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function app_private.set_updated_at()',
      table_name || '_set_updated_at',
      table_name
    );
  end loop;
end;
$$;

create or replace function app_private.rebuild_memory_documents(target_workspace_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  delete from public.memory_documents
  where workspace_id = target_workspace_id;

  with profile_content as (
    select
      p.id as person_id,
      concat_ws(
        E'\n',
        '이름: ' || p.display_name,
        case when p.headline is not null then '소개: ' || p.headline end,
        case when affiliations.names is not null then '소속: ' || affiliations.names end,
        case when memories.items is not null then '기억: ' || memories.items end,
        case when interactions.items is not null then '상호작용: ' || interactions.items end
      ) as content,
      jsonb_build_object(
        'person_name', p.display_name,
        'projection_version', 1
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
    ) affiliations on true
    left join lateral (
      select string_agg(ms.body, ' | ' order by ms.occurred_at desc nulls last, ms.created_at desc) as items
      from public.memory_statements ms
      where ms.workspace_id = p.workspace_id
        and ms.person_id = p.id
        and ms.verification_status <> 'rejected'
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
        and i.verification_status <> 'rejected'
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

alter table public.workspaces enable row level security;

create policy workspace_isolation
on public.workspaces
for all
to authenticated
using (id = app_private.request_workspace_id())
with check (id = app_private.request_workspace_id());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'ai_runs',
    'capture_sessions',
    'source_assets',
    'persons',
    'person_attributes',
    'organizations',
    'affiliations',
    'events',
    'interactions',
    'interaction_participants',
    'topics',
    'interaction_topics',
    'memory_statements',
    'action_items',
    'provenance_records',
    'memory_documents',
    'queries',
    'query_evidence',
    'feedback'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy workspace_isolation on public.%I for all to authenticated using (workspace_id = app_private.request_workspace_id()) with check (workspace_id = app_private.request_workspace_id())',
      table_name
    );
    execute format('revoke all on table public.%I from anon', table_name);
    execute format('revoke all on table public.%I from authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end;
$$;

revoke all on table public.workspaces from anon;
revoke all on table public.workspaces from authenticated;
grant select, insert, update, delete on table public.workspaces to authenticated;
grant all on table public.workspaces to service_role;

revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;
grant execute on function app_private.request_workspace_id() to authenticated;
revoke all on function app_private.set_updated_at() from public;
revoke all on function app_private.rebuild_memory_documents(uuid) from public;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on tables from authenticated;

commit;
