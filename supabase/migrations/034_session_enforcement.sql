-- ============================================================
-- Migration 034: make session termination take effect immediately
-- fn_session_alive(): does the caller's session still exist in
-- auth.sessions? The app shell polls this every ~20s and signs the
-- device out when the owner has terminated its session — without
-- this, a kicked device could keep using its access token until
-- expiry (up to an hour).
-- Run after 033.
-- ============================================================

create or replace function public.fn_session_alive()
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when auth.jwt()->>'session_id' is null then true
    else exists (select 1 from auth.sessions where id = (auth.jwt()->>'session_id')::uuid)
  end;
$$;
revoke execute on function public.fn_session_alive() from public, anon;
