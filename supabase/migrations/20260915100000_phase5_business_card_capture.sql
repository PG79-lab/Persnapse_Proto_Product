begin;

alter table public.source_assets
  add column variant text check (variant in ('original', 'display')),
  add column byte_size integer check (byte_size is null or byte_size > 0),
  add column pixel_width integer check (pixel_width is null or pixel_width > 0),
  add column pixel_height integer check (pixel_height is null or pixel_height > 0),
  add column processing_metadata jsonb not null default '{}'::jsonb,
  add column deleted_at timestamptz;

create table public.business_card_drafts (
  capture_session_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  original_asset_id uuid not null,
  display_asset_id uuid not null,
  model_draft jsonb not null default '{}'::jsonb,
  structured_draft jsonb not null default '{}'::jsonb,
  context_note text,
  ocr_schema_version text not null default 'business-card-extraction-v1',
  ocr_provider text,
  ocr_latency_ms integer check (ocr_latency_ms is null or ocr_latency_ms >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, capture_session_id),
  foreign key (workspace_id, capture_session_id)
    references public.capture_sessions(workspace_id, id)
    on delete cascade,
  foreign key (workspace_id, original_asset_id)
    references public.source_assets(workspace_id, id)
    on delete restrict,
  foreign key (workspace_id, display_asset_id)
    references public.source_assets(workspace_id, id)
    on delete restrict,
  check (original_asset_id <> display_asset_id)
);

create table public.business_cards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid not null,
  capture_session_id uuid not null,
  original_asset_id uuid not null,
  display_asset_id uuid not null,
  card_data jsonb not null,
  original_retained boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, capture_session_id),
  foreign key (workspace_id, person_id)
    references public.persons(workspace_id, id)
    on delete cascade,
  foreign key (workspace_id, capture_session_id)
    references public.capture_sessions(workspace_id, id)
    on delete restrict,
  foreign key (workspace_id, original_asset_id)
    references public.source_assets(workspace_id, id)
    on delete restrict,
  foreign key (workspace_id, display_asset_id)
    references public.source_assets(workspace_id, id)
    on delete restrict,
  check (original_asset_id <> display_asset_id)
);

create index business_card_drafts_workspace_idx
  on public.business_card_drafts (workspace_id, created_at desc);
create index business_cards_person_idx
  on public.business_cards (workspace_id, person_id, created_at desc);

create trigger business_card_drafts_set_updated_at
before update on public.business_card_drafts
for each row execute function app_private.set_updated_at();

create trigger business_cards_set_updated_at
before update on public.business_cards
for each row execute function app_private.set_updated_at();

alter table public.business_card_drafts enable row level security;
alter table public.business_cards enable row level security;

create policy workspace_isolation on public.business_card_drafts
for all to authenticated
using (workspace_id = app_private.request_workspace_id())
with check (workspace_id = app_private.request_workspace_id());

create policy workspace_isolation on public.business_cards
for all to authenticated
using (workspace_id = app_private.request_workspace_id())
with check (workspace_id = app_private.request_workspace_id());

revoke all on table public.business_card_drafts from anon;
revoke all on table public.business_card_drafts from authenticated;
grant select, insert, update, delete on table public.business_card_drafts to authenticated;
grant all on table public.business_card_drafts to service_role;

revoke all on table public.business_cards from anon;
revoke all on table public.business_cards from authenticated;
grant select, insert, update, delete on table public.business_cards to authenticated;
grant all on table public.business_cards to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'business-card-assets',
  'business-card-assets',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

commit;
