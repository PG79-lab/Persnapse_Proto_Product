-- Additive assistant sessions, canonical search units and a durable bounded queue.
begin;

create table public.assistant_sessions (
  id uuid primary key, workspace_id uuid not null references public.workspaces(id) on delete cascade,
  version integer not null default 0 check(version >= 0), context jsonb not null default '{}',
  lease_token uuid, lease_until timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id,id)
);
create table public.assistant_turns (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
  session_id uuid not null, request_id uuid not null, payload_hash text not null,
  message text not null check(length(message) between 2 and 500),
  status text not null check(status in ('processing','succeeded','failed','unknown')),
  response jsonb, error_code text, error_message text,
  created_at timestamptz not null default now(), completed_at timestamptz,
  unique(workspace_id,id), unique(workspace_id,session_id,request_id),
  foreign key(workspace_id,session_id) references public.assistant_sessions(workspace_id,id) on delete cascade
);
create index assistant_turns_session_time on public.assistant_turns(workspace_id,session_id,created_at);

-- Canonical view is also the live structured/keyword fallback while vectors are pending.
create view app_private.assistant_canonical_units with (security_invoker=true) as
select p.workspace_id, 'person_profile'::text as kind, p.id as source_id, null::uuid as interaction_id,
  array[p.id] as person_ids,
  concat_ws(E'\n',p.display_name,p.headline,p.notes,
    (select string_agg(o.name || coalesce(' · '||a.title,''),' · ' order by a.is_current desc,o.name)
      from public.affiliations a join public.organizations o on o.workspace_id=a.workspace_id and o.id=a.organization_id
      where a.workspace_id=p.workspace_id and a.person_id=p.id and a.verification_status='confirmed')) as content,
  null::timestamptz as occurred_at, null::timestamptz as due_at,
  null::text as action_kind,null::text as action_status
from public.persons p where p.archived_at is null
union all
select i.workspace_id,'interaction',i.id,i.id,ps.ids,
  concat_ws(E'\n',ps.names,to_char(i.occurred_at at time zone 'Asia/Seoul','YYYY-MM-DD'),e.name,i.location,i.summary,
    (select string_agg(t.name,' · ' order by t.name) from public.interaction_topics it
      join public.topics t on t.workspace_id=it.workspace_id and t.id=it.topic_id
      where it.workspace_id=i.workspace_id and it.interaction_id=i.id and it.verification_status='confirmed')),
  i.occurred_at,null::timestamptz,null::text,null::text
from public.interactions i
left join public.events e on e.workspace_id=i.workspace_id and e.id=i.event_id
join lateral (select array_agg(p.id order by p.id) as ids,string_agg(p.display_name,' · ' order by p.id) as names
  from public.interaction_participants ip join public.persons p on p.workspace_id=ip.workspace_id and p.id=ip.person_id
  where ip.workspace_id=i.workspace_id and ip.interaction_id=i.id and p.archived_at is null) ps on cardinality(ps.ids)>0
where i.archived_at is null and i.verification_status='confirmed'
union all
select m.workspace_id,'memory_statement',m.id,m.interaction_id,ps.ids,
  concat_ws(E'\n',ps.names,m.body),coalesce(i.occurred_at,m.occurred_at),null::timestamptz,null::text,null::text
from public.memory_statements m left join public.interactions i on i.workspace_id=m.workspace_id and i.id=m.interaction_id
join lateral (select array_agg(p.id order by p.id) as ids,string_agg(p.display_name,' · ' order by p.id) as names
  from public.persons p where p.workspace_id=m.workspace_id and p.archived_at is null
    and (p.id=m.person_id or (m.person_id is null and exists(select 1 from public.interaction_participants ip
      where ip.workspace_id=m.workspace_id and ip.interaction_id=m.interaction_id and ip.person_id=p.id)))) ps on cardinality(ps.ids)>0
where m.archived_at is null and m.verification_status='confirmed'
  and (m.interaction_id is null or (i.archived_at is null and i.verification_status='confirmed'
    and (m.person_id is null or exists(select 1 from public.interaction_participants ip
      where ip.workspace_id=m.workspace_id and ip.interaction_id=m.interaction_id and ip.person_id=m.person_id))))
union all
select a.workspace_id,'action_item',a.id,a.interaction_id,array[p.id],
  concat_ws(E'\n',p.display_name,a.kind,a.status,to_char(a.due_at at time zone 'Asia/Seoul','YYYY-MM-DD'),a.title,a.details),
  i.occurred_at,a.due_at,a.kind,a.status
from public.action_items a join public.persons p on p.workspace_id=a.workspace_id and p.id=a.person_id
left join public.interactions i on i.workspace_id=a.workspace_id and i.id=a.interaction_id
where a.archived_at is null and a.verification_status='confirmed' and a.status<>'dismissed' and p.archived_at is null
  and (a.interaction_id is null or (i.archived_at is null and i.verification_status='confirmed' and exists(
    select 1 from public.interaction_participants ip where ip.workspace_id=a.workspace_id
      and ip.interaction_id=a.interaction_id and ip.person_id=a.person_id)))
union all
select t.workspace_id,'workspace_task',t.id,null::uuid,array[p.id],
  concat_ws(E'\n',p.display_name,'사용자 업무 (약속 아님)',case when t.done then 'completed' else 'pending' end,
    t.title,to_char(t.due_date,'YYYY-MM-DD'),to_char(t.due_time,'HH24:MI')),
  null::timestamptz,(t.due_date+coalesce(t.due_time,time '00:00')) at time zone 'Asia/Seoul',
  'follow_up',case when t.done then 'completed' else 'pending' end
from public.workspace_tasks t join public.persons p on p.workspace_id=t.workspace_id and p.id=t.person_id
where t.archived_at is null and p.archived_at is null;

create table public.memory_search_units (
  id uuid primary key, workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check(kind in ('person_profile','interaction','memory_statement','action_item','workspace_task')),
  person_source_id uuid, interaction_source_id uuid, memory_source_id uuid, action_source_id uuid, task_source_id uuid,
  source_id uuid not null, chunk_index integer not null check(chunk_index>=0), projection_version integer not null default 1,
  content text not null check(length(content) between 1 and 4000), content_hash text not null,
  embedding extensions.vector(1024), embedding_model text,
  embedding_status text not null default 'pending' check(embedding_status in ('pending','processing','ready','failed')),
  updated_at timestamptz not null default now(),
  unique(workspace_id,id), unique(workspace_id,kind,source_id,chunk_index,projection_version),
  check(num_nonnulls(person_source_id,interaction_source_id,memory_source_id,action_source_id,task_source_id)=1),
  check((kind='person_profile' and source_id=person_source_id) or (kind='interaction' and source_id=interaction_source_id)
     or (kind='memory_statement' and source_id=memory_source_id) or (kind='action_item' and source_id=action_source_id)
     or (kind='workspace_task' and source_id=task_source_id)),
  check(embedding_status<>'ready' or (embedding is not null and embedding_model is not null)),
  foreign key(workspace_id,person_source_id) references public.persons(workspace_id,id) on delete cascade,
  foreign key(workspace_id,interaction_source_id) references public.interactions(workspace_id,id) on delete cascade,
  foreign key(workspace_id,memory_source_id) references public.memory_statements(workspace_id,id) on delete cascade,
  foreign key(workspace_id,action_source_id) references public.action_items(workspace_id,id) on delete cascade,
  foreign key(workspace_id,task_source_id) references public.workspace_tasks(workspace_id,id) on delete cascade
);
create table public.memory_search_unit_people (
  workspace_id uuid not null, unit_id uuid not null, person_id uuid not null,
  primary key(workspace_id,unit_id,person_id),
  foreign key(workspace_id,unit_id) references public.memory_search_units(workspace_id,id) on delete cascade,
  foreign key(workspace_id,person_id) references public.persons(workspace_id,id) on delete cascade
);
create index memory_search_units_source on public.memory_search_units(workspace_id,kind,source_id);
create index memory_search_unit_people_person on public.memory_search_unit_people(workspace_id,person_id);

create table public.memory_index_jobs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, unit_id uuid not null,
  content_hash text not null, target_model text,
  status text not null default 'pending' check(status in ('pending','processing','done','failed','dead')),
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  lease_token uuid, lease_until timestamptz, error_code text, updated_at timestamptz not null default now(),
  unique(workspace_id,unit_id),
  foreign key(workspace_id,unit_id) references public.memory_search_units(workspace_id,id) on delete cascade
);
create index memory_index_jobs_due on public.memory_index_jobs(workspace_id,status,next_attempt_at);

-- Statement-level refresh: avoid editing shared capture/workspace/card commit functions.
-- MVP rebuild scope is a workspace; unchanged units retain vectors and produce no new jobs.
create function app_private.refresh_assistant_units(w uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('assistant-projection:'||w::text,0));
  delete from public.memory_search_units u where u.workspace_id=w and not exists(
    select 1 from app_private.assistant_canonical_units c where c.workspace_id=w and c.kind=u.kind and c.source_id=u.source_id
      and u.chunk_index < greatest(1,ceil(length(c.content)/4000.0)::integer));
  insert into public.memory_search_units(id,workspace_id,kind,source_id,chunk_index,content,content_hash,
    person_source_id,interaction_source_id,memory_source_id,action_source_id,task_source_id)
  select md5(w::text||':'||c.kind||':'||c.source_id::text||':'||chunk::text||':1')::uuid,w,c.kind,c.source_id,chunk,
    substring(c.content from chunk*4000+1 for 4000),
    encode(extensions.digest(substring(c.content from chunk*4000+1 for 4000),'sha256'),'hex'),
    case when c.kind='person_profile' then c.source_id end, case when c.kind='interaction' then c.source_id end,
    case when c.kind='memory_statement' then c.source_id end,case when c.kind='action_item' then c.source_id end,
    case when c.kind='workspace_task' then c.source_id end
  from app_private.assistant_canonical_units c cross join lateral generate_series(0,greatest(0,ceil(length(c.content)/4000.0)::integer-1)) chunk
  where c.workspace_id=w and length(c.content)>0
  on conflict(id) do update set content=excluded.content,content_hash=excluded.content_hash,
    embedding=null,embedding_model=null,embedding_status='pending',updated_at=now()
  where public.memory_search_units.content_hash is distinct from excluded.content_hash;
  delete from public.memory_search_unit_people p where p.workspace_id=w and not exists(
    select 1 from public.memory_search_units u join app_private.assistant_canonical_units c
      on c.workspace_id=u.workspace_id and c.kind=u.kind and c.source_id=u.source_id
    where u.workspace_id=w and u.id=p.unit_id and p.person_id=any(c.person_ids));
  insert into public.memory_search_unit_people(workspace_id,unit_id,person_id)
  select w,u.id,pid from public.memory_search_units u join app_private.assistant_canonical_units c
    on c.workspace_id=u.workspace_id and c.kind=u.kind and c.source_id=u.source_id
  cross join lateral unnest(c.person_ids) pid where u.workspace_id=w on conflict do nothing;
  insert into public.memory_index_jobs(workspace_id,unit_id,content_hash)
  select w,u.id,u.content_hash from public.memory_search_units u where u.workspace_id=w and u.embedding_status='pending'
  on conflict(workspace_id,unit_id) do update set content_hash=excluded.content_hash,status='pending',attempts=0,
    lease_token=null,lease_until=null,error_code=null,next_attempt_at=now(),updated_at=now()
  where public.memory_index_jobs.content_hash is distinct from excluded.content_hash;
end; $$;

create function app_private.assistant_projection_changed() returns trigger
language plpgsql security invoker set search_path='' as $$
declare w uuid;
begin
  if tg_op='UPDATE' then
    for w in select workspace_id from new_rows union select workspace_id from old_rows loop
      perform app_private.refresh_assistant_units(w);
    end loop;
  else
    for w in select distinct workspace_id from changed_rows loop perform app_private.refresh_assistant_units(w); end loop;
  end if;
  return null;
end; $$;

do $$ declare t text; begin
  foreach t in array array['persons','interactions','interaction_participants','memory_statements','action_items','workspace_tasks','events','topics','interaction_topics','organizations','affiliations'] loop
    execute format('create trigger assistant_project_insert after insert on public.%I referencing new table as changed_rows for each statement execute function app_private.assistant_projection_changed()',t);
    execute format('create trigger assistant_project_update after update on public.%I referencing old table as old_rows new table as new_rows for each statement execute function app_private.assistant_projection_changed()',t);
    execute format('create trigger assistant_project_delete after delete on public.%I referencing old table as changed_rows for each statement execute function app_private.assistant_projection_changed()',t);
  end loop;
end $$;

-- App-only storage; do not expose conversations or queue management via REST roles.
do $$ declare t text; begin
  foreach t in array array['assistant_sessions','assistant_turns','memory_search_units','memory_search_unit_people','memory_index_jobs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
revoke all on app_private.assistant_canonical_units from public,anon,authenticated;
grant select on app_private.assistant_canonical_units to service_role;
revoke all on function app_private.refresh_assistant_units(uuid) from public;
revoke all on function app_private.assistant_projection_changed() from public;
grant execute on function app_private.refresh_assistant_units(uuid) to service_role;
grant execute on function app_private.assistant_projection_changed() to service_role;
-- Backfill deliberately explicit and bounded: scripts/ai/assistant-worker.ts --backfill.
alter table public.query_evidence drop constraint query_evidence_source_entity_type_check;
alter table public.query_evidence add constraint query_evidence_source_entity_type_check check(
  source_entity_type in ('person_profile','affiliation','event','interaction','memory_statement','action_item','workspace_task'));
commit;
