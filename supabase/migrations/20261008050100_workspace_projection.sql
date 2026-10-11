begin;
create or replace function app_private.rebuild_person_memory_document(
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
      and memory.archived_at is null
      and (memory.interaction_id is null or exists (select 1 from public.interactions i where i.workspace_id = memory.workspace_id and i.id = memory.interaction_id and i.archived_at is null))
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
      and interaction.archived_at is null
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
      and action.archived_at is null
      and (action.interaction_id is null or exists (select 1 from public.interactions i where i.workspace_id = action.workspace_id and i.id = action.interaction_id and i.archived_at is null))
  ) actions on true
  where person.workspace_id = target_workspace_id
    and person.id = target_person_id and person.archived_at is null;

  if projected_content is null then
    delete from public.memory_documents where workspace_id = target_workspace_id and person_id = target_person_id;
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


commit;
