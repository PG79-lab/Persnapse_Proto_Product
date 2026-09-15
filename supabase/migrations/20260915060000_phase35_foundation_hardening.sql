begin;

alter table public.capture_sessions
  add column draft_schema_version text not null default 'capture-draft-v1',
  add column model_draft jsonb not null default '{}'::jsonb,
  add column last_error_code text,
  add column last_error_at timestamptz,
  add column commit_result jsonb not null default '{}'::jsonb,
  add column committed_person_id uuid,
  add column committed_interaction_id uuid,
  add constraint capture_sessions_committed_person_fkey
    foreign key (workspace_id, committed_person_id)
    references public.persons(workspace_id, id)
    on delete set null (committed_person_id),
  add constraint capture_sessions_committed_interaction_fkey
    foreign key (workspace_id, committed_interaction_id)
    references public.interactions(workspace_id, id)
    on delete set null (committed_interaction_id),
  add constraint capture_sessions_commit_state_check check (
    (
      state = 'committed'
      and committed_at is not null
      and commit_result <> '{}'::jsonb
    )
    or (
      state <> 'committed'
      and committed_at is null
      and commit_result = '{}'::jsonb
      and committed_person_id is null
      and committed_interaction_id is null
    )
  ) not valid;

update public.capture_sessions
set commit_result = jsonb_build_object('kind', 'legacy_committed')
where state = 'committed'
  and commit_result = '{}'::jsonb;

alter table public.capture_sessions
  validate constraint capture_sessions_commit_state_check;

alter table public.ai_runs
  add column capture_session_id uuid,
  add column attempt integer not null default 1 check (attempt > 0),
  add column retry_of_ai_run_id uuid,
  add column metadata jsonb not null default '{}'::jsonb,
  add constraint ai_runs_capture_session_fkey
    foreign key (workspace_id, capture_session_id)
    references public.capture_sessions(workspace_id, id)
    on delete set null (capture_session_id),
  add constraint ai_runs_retry_of_fkey
    foreign key (workspace_id, retry_of_ai_run_id)
    references public.ai_runs(workspace_id, id)
    on delete set null (retry_of_ai_run_id);

create index ai_runs_capture_session_idx
  on public.ai_runs (workspace_id, capture_session_id, task, attempt desc)
  where capture_session_id is not null;

update public.ai_runs run
set capture_session_id = session.id
from public.capture_sessions session
where session.workspace_id = run.workspace_id
  and session.ai_run_id = run.id
  and run.capture_session_id is null;

alter table public.memory_documents
  add column embedding_status text not null default 'pending' check (
    embedding_status in ('pending', 'processing', 'ready', 'failed')
  ),
  add column embedding_attempts integer not null default 0 check (
    embedding_attempts >= 0
  ),
  add column embedding_error_code text,
  add column embedding_updated_at timestamptz;

update public.memory_documents
set embedding_dimensions = 1024
where embedding_dimensions is null;

alter table public.memory_documents
  drop constraint memory_documents_embedding_dimensions_check,
  alter column embedding type extensions.vector(1024)
    using embedding::extensions.vector(1024),
  alter column embedding_dimensions set default 1024,
  alter column embedding_dimensions set not null,
  add constraint memory_documents_embedding_dimensions_check check (
    embedding_dimensions = 1024
  ),
  add constraint memory_documents_embedding_ready_check check (
    embedding_status <> 'ready'
    or (
      embedding is not null
      and embedding_model is not null
      and embedding_updated_at is not null
    )
  );

drop function app_private.rebuild_memory_documents(uuid);

create function app_private.rebuild_person_memory_document(
  target_workspace_id uuid,
  target_person_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_document_id uuid := md5(target_person_id::text || ':person_profile')::uuid;
  projected_content text;
  projected_metadata jsonb;
begin
  select
    concat_ws(
      E'\n',
      '이름: ' || person.display_name,
      case when person.headline is not null then '소개: ' || person.headline end,
      case when affiliations.names is not null then '소속: ' || affiliations.names end,
      case when memories.items is not null then '확인된 기억: ' || memories.items end,
      case when interactions.items is not null then '확인된 상호작용: ' || interactions.items end,
      case when actions.items is not null then '확인된 행동: ' || actions.items end
    ),
    jsonb_build_object(
      'person_name', person.display_name,
      'projection_version', 3,
      'verification_policy', 'confirmed_only',
      'embedding_dimensions', 1024
    )
  into projected_content, projected_metadata
  from public.persons person
  left join lateral (
    select string_agg(
      organization.name || coalesce(' · ' || affiliation.title, ''),
      ', '
      order by affiliation.is_current desc, organization.name
    ) as names
    from public.affiliations affiliation
    join public.organizations organization
      on organization.workspace_id = affiliation.workspace_id
     and organization.id = affiliation.organization_id
    where affiliation.workspace_id = person.workspace_id
      and affiliation.person_id = person.id
      and affiliation.verification_status = 'confirmed'
  ) affiliations on true
  left join lateral (
    select string_agg(
      memory.body,
      ' | '
      order by memory.occurred_at desc nulls last, memory.created_at desc
    ) as items
    from public.memory_statements memory
    where memory.workspace_id = person.workspace_id
      and memory.person_id = person.id
      and memory.verification_status = 'confirmed'
  ) memories on true
  left join lateral (
    select string_agg(
      concat_ws(
        ' · ',
        to_char(interaction.occurred_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
        event.name,
        interaction.location,
        interaction.summary,
        interaction_topics.names
      ),
      ' | '
      order by interaction.occurred_at desc
    ) as items
    from public.interaction_participants participant
    join public.interactions interaction
      on interaction.workspace_id = participant.workspace_id
     and interaction.id = participant.interaction_id
    left join public.events event
      on event.workspace_id = interaction.workspace_id
     and event.id = interaction.event_id
    left join lateral (
      select string_agg(topic.name, ', ' order by topic.name) as names
      from public.interaction_topics interaction_topic
      join public.topics topic
        on topic.workspace_id = interaction_topic.workspace_id
       and topic.id = interaction_topic.topic_id
      where interaction_topic.workspace_id = interaction.workspace_id
        and interaction_topic.interaction_id = interaction.id
        and interaction_topic.verification_status = 'confirmed'
    ) interaction_topics on true
    where participant.workspace_id = person.workspace_id
      and participant.person_id = person.id
      and interaction.verification_status = 'confirmed'
  ) interactions on true
  left join lateral (
    select string_agg(
      concat_ws(
        ' · ',
        action.title,
        action.details,
        case
          when action.due_at is not null
          then '기한 ' || to_char(action.due_at at time zone 'Asia/Seoul', 'YYYY-MM-DD')
        end
      ),
      ' | '
      order by action.due_at asc nulls last, action.created_at desc
    ) as items
    from public.action_items action
    where action.workspace_id = person.workspace_id
      and action.person_id = person.id
      and action.verification_status = 'confirmed'
      and action.status <> 'dismissed'
  ) actions on true
  where person.workspace_id = target_workspace_id
    and person.id = target_person_id;

  if projected_content is null then
    return null;
  end if;

  insert into public.memory_documents (
    id,
    workspace_id,
    person_id,
    document_kind,
    content,
    content_hash,
    metadata,
    embedding_dimensions,
    embedding_status
  )
  values (
    target_document_id,
    target_workspace_id,
    target_person_id,
    'person_profile',
    projected_content,
    encode(extensions.digest(projected_content, 'sha256'), 'hex'),
    projected_metadata,
    1024,
    'pending'
  )
  on conflict (id) do update
  set content = excluded.content,
      content_hash = excluded.content_hash,
      metadata = excluded.metadata,
      embedding_model = null,
      embedding_dimensions = 1024,
      embedding = null,
      embedding_status = 'pending',
      embedding_attempts = 0,
      embedding_error_code = null,
      embedding_updated_at = null,
      updated_at = now()
  where public.memory_documents.content_hash is distinct from excluded.content_hash
     or public.memory_documents.metadata is distinct from excluded.metadata;

  return target_document_id;
end;
$$;

create function app_private.rebuild_memory_documents(target_workspace_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_person record;
  rebuilt_count integer := 0;
begin
  for target_person in
    select id
    from public.persons
    where workspace_id = target_workspace_id
    order by id
  loop
    perform app_private.rebuild_person_memory_document(
      target_workspace_id,
      target_person.id
    );
    rebuilt_count := rebuilt_count + 1;
  end loop;

  return rebuilt_count;
end;
$$;

do $$
declare
  target_workspace record;
begin
  for target_workspace in select id from public.workspaces
  loop
    perform app_private.rebuild_memory_documents(target_workspace.id);
  end loop;
end;
$$;

revoke all on function app_private.rebuild_person_memory_document(uuid, uuid) from public;
revoke all on function app_private.rebuild_memory_documents(uuid) from public;

commit;
