begin;

alter table public.capture_sessions
  add column user_correction_count integer not null default 0 check (
    user_correction_count >= 0
  );

comment on column public.capture_sessions.user_correction_count is
  'Number of user-confirmed draft revisions. Raw model output remains in model_draft.';

commit;
