begin;

create table public.ocr_provider_calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  capture_session_id uuid,
  provider_scope text not null check (char_length(provider_scope) between 1 and 120),
  operation_key uuid not null,
  image_sha256 text not null check (image_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'reserved' check (
    status in ('reserved', 'started', 'succeeded', 'failed')
  ),
  reserved_at timestamptz not null default clock_timestamp(),
  provider_request_started_at timestamptz,
  completed_at timestamptz,
  lease_expires_at timestamptz not null default (
    clock_timestamp() + interval '2 minutes'
  ),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  unique (workspace_id, provider_scope, operation_key),
  foreign key (workspace_id, capture_session_id)
    references public.capture_sessions(workspace_id, id)
    on delete set null (capture_session_id),
  check (
    (status = 'reserved' and provider_request_started_at is null and completed_at is null)
    or (status = 'started' and provider_request_started_at is not null and completed_at is null)
    or (status in ('succeeded', 'failed') and completed_at is not null)
  )
);

create index ocr_provider_calls_budget_idx
  on public.ocr_provider_calls (provider_scope, reserved_at desc);

create index ocr_provider_calls_active_image_idx
  on public.ocr_provider_calls (
    workspace_id,
    provider_scope,
    image_sha256,
    lease_expires_at desc
  )
  where status in ('reserved', 'started');

create index ocr_provider_calls_capture_idx
  on public.ocr_provider_calls (workspace_id, capture_session_id, reserved_at desc)
  where capture_session_id is not null;

alter table public.ocr_provider_calls enable row level security;

revoke all on table public.ocr_provider_calls from anon;
revoke all on table public.ocr_provider_calls from authenticated;
grant all on table public.ocr_provider_calls to service_role;

commit;
