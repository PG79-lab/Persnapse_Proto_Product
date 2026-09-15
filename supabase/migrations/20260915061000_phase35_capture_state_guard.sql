begin;

create function app_private.enforce_capture_session_state_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.state = new.state then
    return new;
  end if;

  if (old.state = 'draft' and new.state in ('review', 'failed'))
    or (old.state = 'review' and new.state in ('draft', 'committed', 'failed'))
    or (old.state = 'failed' and new.state in ('draft', 'review'))
  then
    return new;
  end if;

  raise exception
    using
      errcode = '23514',
      message = format(
        'capture session cannot transition from %s to %s',
        old.state,
        new.state
      );
end;
$$;

create trigger capture_sessions_enforce_state_transition
before update of state on public.capture_sessions
for each row
execute function app_private.enforce_capture_session_state_transition();

revoke all on function app_private.enforce_capture_session_state_transition() from public;

commit;
