-- ============================================================
-- 143: customer identity rebuild moves to pg_cron
--
-- fn_rebuild_customer_identities takes ~3.5 minutes on 45k accounts
-- (plus the migration-111 trigger that recomputes first/last source over
-- every order), but the app called it from the browser after every
-- customers import under the 8 s statement cap, and ignored the error.
-- Result: customer_identities was last rebuilt on 2026-08-04 until it was
-- run by hand on 2026-09-13; the Customers page was five weeks stale and
-- nobody could tell.
--
-- Now:
--   fn_identity_rebuild_run(reason)   the worker: advisory lock, service
--                                     claims, 15 min timeout, writes its
--                                     outcome to app_settings.identity_rebuild
--   fn_request_identity_rebuild()     what the app calls (admin/manager):
--                                     stamps requested_at, returns status
--   fn_identity_rebuild_status()      what the app reads (admin/manager/viewer)
--   fn_identity_rebuild_tick()        cron every 2 min: runs only if requested
--   cron identity-rebuild-nightly     02:30 UTC daily (05:30 Cairo), before
--                                     the morning imports and the other jobs
--   cron identity-rebuild-queue       */2 * * * *  -> fn_identity_rebuild_tick()
--
-- Status document (app_settings key 'identity_rebuild'):
--   { status: 'idle'|'queued'|'running'|'ok'|'error'|'busy',
--     requested_at, started_at, finished_at, duration_s, reason,
--     result (jsonb from the rebuild), error }
-- ============================================================

-- ---------------------------------------------------------------- worker
create or replace function public.fn_identity_rebuild_run(p_reason text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lock  constant bigint := 4871002;   -- arbitrary, unique to this job
  v_prev  jsonb;
  v_t0    timestamptz := clock_timestamp();
  v_res   jsonb;
  v_doc   jsonb;
begin
  if not pg_try_advisory_lock(v_lock) then
    return jsonb_build_object('status', 'busy', 'reason', p_reason);
  end if;

  begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    -- the rebuild plus the identity-sources trigger need minutes, not 8 s
    perform set_config('statement_timeout', '15min', true);

    select value into v_prev from public.app_settings where key = 'identity_rebuild';
    v_doc := coalesce(v_prev, '{}'::jsonb)
          || jsonb_build_object('status', 'running', 'started_at', v_t0, 'reason', p_reason, 'error', null);
    insert into public.app_settings (key, value, updated_at) values ('identity_rebuild', v_doc, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();

    v_res := public.fn_rebuild_customer_identities();

    v_doc := v_doc || jsonb_build_object(
      'status', 'ok',
      'finished_at', clock_timestamp(),
      'duration_s', round(extract(epoch from clock_timestamp() - v_t0)::numeric, 1),
      'result', v_res,
      'requested_at', null);
    update public.app_settings set value = v_doc, updated_at = now() where key = 'identity_rebuild';
    perform pg_advisory_unlock(v_lock);
    return v_doc;
  exception when others then
    v_doc := coalesce(v_doc, '{}'::jsonb) || jsonb_build_object(
      'status', 'error',
      'finished_at', clock_timestamp(),
      'duration_s', round(extract(epoch from clock_timestamp() - v_t0)::numeric, 1),
      'error', sqlerrm,
      'requested_at', null);
    update public.app_settings set value = v_doc, updated_at = now() where key = 'identity_rebuild';
    perform pg_advisory_unlock(v_lock);
    return v_doc;
  end;
end $$;

revoke all on function public.fn_identity_rebuild_run(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- app-facing
create or replace function public.fn_identity_rebuild_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  perform public.fn_assert_reader();
  return coalesce((select value from public.app_settings where key = 'identity_rebuild'),
                  jsonb_build_object('status', 'idle'));
end $$;

revoke all on function public.fn_identity_rebuild_status() from public, anon;
grant execute on function public.fn_identity_rebuild_status() to authenticated;

create or replace function public.fn_request_identity_rebuild()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_doc jsonb;
begin
  if not public.can_manage_identities() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select value into v_doc from public.app_settings where key = 'identity_rebuild';
  v_doc := coalesce(v_doc, '{}'::jsonb) || jsonb_build_object('requested_at', now());
  if coalesce(v_doc->>'status', '') <> 'running' then
    v_doc := v_doc || jsonb_build_object('status', 'queued');
  end if;
  insert into public.app_settings (key, value, updated_at) values ('identity_rebuild', v_doc, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_doc;
end $$;

revoke all on function public.fn_request_identity_rebuild() from public, anon;
grant execute on function public.fn_request_identity_rebuild() to authenticated;

-- ---------------------------------------------------------------- cron entry points
create or replace function public.fn_identity_rebuild_tick()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_doc jsonb;
begin
  select value into v_doc from public.app_settings where key = 'identity_rebuild';
  if v_doc is null or v_doc->>'requested_at' is null then
    return jsonb_build_object('status', 'nothing-requested');
  end if;
  if v_doc->>'status' = 'running'
     and coalesce((v_doc->>'started_at')::timestamptz, now()) > now() - interval '20 minutes' then
    return jsonb_build_object('status', 'already-running');
  end if;
  return public.fn_identity_rebuild_run('requested');
end $$;

revoke all on function public.fn_identity_rebuild_tick() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('identity-rebuild-nightly') where exists (select 1 from cron.job where jobname = 'identity-rebuild-nightly');
  perform cron.schedule('identity-rebuild-nightly', '30 2 * * *', $sql$select public.fn_identity_rebuild_run('nightly')$sql$);

  perform cron.unschedule('identity-rebuild-queue') where exists (select 1 from cron.job where jobname = 'identity-rebuild-queue');
  perform cron.schedule('identity-rebuild-queue', '*/2 * * * *', $sql$select public.fn_identity_rebuild_tick()$sql$);
end $$;
