begin;

-- Additive changes: existing canonical records and evidence IDs are retained.
alter table public.persons
  add column version integer not null default 1,
  add column archived_at timestamptz,
  add column relationship_status text not null default 'unclassified' check (relationship_status in ('success','pending','failed','unclassified')),
  add column importance smallint not null default 3 check (importance between 1 and 5),
  add column relationship_categories text[] not null default '{}' check (relationship_categories <@ array['project','work','networking','customer']::text[]);
alter table public.interactions
  add column version integer not null default 1,
  add column archived_at timestamptz,
  add column display_title text,
  add column place_type text not null default 'unclassified' check (place_type in ('expo','industrial','client_site','unclassified')),
  add column guests text[] not null default '{}',
  add column event_url text,
  add column image_url text,
  add column image_source_url text;
alter table public.action_items
  add column version integer not null default 1,
  add column archived_at timestamptz,
  add column ui_task_type text not null default 'general',
  add column importance smallint not null default 3 check (importance between 1 and 5),
  add column due_has_time boolean not null default true;
alter table public.memory_statements
  add column version integer not null default 1,
  add column archived_at timestamptz;

create table public.workspace_tasks (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid,
  title text not null check (length(btrim(title)) between 1 and 1000),
  due_date date,
  due_time time,
  done boolean not null default false,
  task_type text not null default 'general' check (task_type in ('general','mail','call','coffee','meeting','material')),
  importance smallint not null default 3 check (importance between 1 and 5),
  version integer not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,id),
  foreign key (workspace_id,person_id) references public.persons(workspace_id,id),
  check (due_time is null or due_date is not null)
);
comment on table public.workspace_tasks is 'User-created work, including work without a person. Never inferred as a relationship commitment.';
create table public.workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  persona jsonb not null default '{}' check (jsonb_typeof(persona) = 'object'),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
create table public.workspace_mail_drafts (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid not null,
  purpose text not null,
  subject text not null,
  body text not null,
  reference text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,id),
  foreign key (workspace_id,person_id) references public.persons(workspace_id,id)
);
create table public.workspace_mutations (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  request_id uuid not null,
  payload_hash text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, request_id)
);
create table public.workspace_change_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  request_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  before_value jsonb,
  created_at timestamptz not null default now()
);
comment on table public.workspace_change_log is 'Private canonical edit provenance. Never sent in the general UI snapshot.';

create function app_private.increment_record_version() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin new.version := old.version + 1; new.updated_at := now(); return new; end; $$;
revoke all on function app_private.increment_record_version() from public;
do $$ declare tab text; begin
  foreach tab in array array['persons','interactions','action_items','memory_statements','workspace_tasks','workspace_settings','workspace_mail_drafts'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app_private.increment_record_version()', tab || '_version', tab);
  end loop;
  foreach tab in array array['workspace_tasks','workspace_settings','workspace_mail_drafts','workspace_mutations','workspace_change_log'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from anon, authenticated',tab);
    execute format('grant all on public.%I to service_role',tab);
    -- Server-only MVP APIs set the workspace; browser Supabase access remains denied.
  end loop;
end $$;
create index workspace_tasks_dates on public.workspace_tasks(workspace_id,due_date) where archived_at is null;
create index workspace_changes_entity on public.workspace_change_log(workspace_id,entity_type,entity_id,created_at);

commit;
