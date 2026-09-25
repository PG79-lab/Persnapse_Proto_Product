begin;
-- Capture time remains separate. Unknown encounter dates stay unknown.
alter table public.interactions alter column occurred_at drop not null;
-- Reservations remain counted after timeouts: the provider may have billed them.
create table public.ai_call_reservations (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 task text not null,
 created_at timestamptz not null default now()
);
create index ai_call_reservations_window on public.ai_call_reservations(workspace_id, created_at);
alter table public.ai_call_reservations enable row level security;
revoke all on public.ai_call_reservations from anon, authenticated;
commit;
