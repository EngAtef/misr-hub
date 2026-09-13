-- ============================================================
-- 144: identity rebuild jobs survive pg_cron's 2-minute statement cap
--
-- 143's first queued run was cancelled after exactly 120 s: the pg_cron
-- session carries a 2 min statement_timeout, and set_config() inside
-- the running statement cannot extend the statement that is already
-- running. A query cancel is not caught by `exception when others`, so
-- the status stayed 'queued' and the 2-minute job retried for ever.
--
-- Fix:
--   * the cron COMMAND raises the timeout as its own statement before
--     the call (a multi-statement command; each statement gets its own
--     timeout).
--   * fn_identity_rebuild_mark() stamps the attempt in its own committed
--     transaction (explicit COMMIT in the command) so a cancelled run
--     still counts; after 3 attempts the request is dropped with an
--     error status instead of looping.
--   * fn_identity_rebuild_tick() only runs when mark() said go.
-- ============================================================

create or replace function public.fn_identity_rebuild_mark()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v jsonb; v_att int;
begin
  select value into v from public.app_settings where key = 'identity_rebuild';
  if v is null or v->>'requested_at' is null then
    return false;
  end if;
  if v->>'attempt_at' is not null
     and (v->>'attempt_at')::timestamptz > now() - interval '10 minutes' then
    return false;   -- an attempt is running or just failed; wait
  end if;
  v_att := coalesce((v->>'attempts')::int, 0) + 1;
  if v_att > 3 then
    update public.app_settings
       set value = v || jsonb_build_object(
             'status', 'error',
             'error', 'gave up after 3 attempts (each cancelled by the statement timeout)',
             'finished_at', now(), 'requested_at', null, 'attempts', 0, 'attempt_at', null, 'go', false),
           updated_at = now()
     where key = 'identity_rebuild';
    return false;
  end if;
  update public.app_settings
     set value = v || jsonb_build_object('attempt_at', now(), 'attempts', v_att, 'go', true),
         updated_at = now()
   where key = 'identity_rebuild';
  return true;
end $$;

revoke all on function public.fn_identity_rebuild_mark() from public, anon, authenticated;

create or replace function public.fn_identity_rebuild_tick()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_doc jsonb;
begin
  select value into v_doc from public.app_settings where key = 'identity_rebuild';
  if v_doc is null or coalesce(v_doc->>'go', 'false') <> 'true' then
    return jsonb_build_object('status', 'nothing-to-do');
  end if;
  return public.fn_identity_rebuild_run('requested');
end $$;

revoke all on function public.fn_identity_rebuild_tick() from public, anon, authenticated;

-- the worker clears the attempt bookkeeping when it finishes either way
create or replace function public.fn_identity_rebuild_run(p_reason text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lock  constant bigint := 4871002;
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
      'requested_at', null, 'attempts', 0, 'attempt_at', null, 'go', false);
    update public.app_settings set value = v_doc, updated_at = now() where key = 'identity_rebuild';
    perform pg_advisory_unlock(v_lock);
    return v_doc;
  exception when others then
    v_doc := coalesce(v_doc, '{}'::jsonb) || jsonb_build_object(
      'status', 'error',
      'finished_at', clock_timestamp(),
      'duration_s', round(extract(epoch from clock_timestamp() - v_t0)::numeric, 1),
      'error', sqlerrm,
      'requested_at', null, 'attempts', 0, 'attempt_at', null, 'go', false);
    update public.app_settings set value = v_doc, updated_at = now() where key = 'identity_rebuild';
    perform pg_advisory_unlock(v_lock);
    return v_doc;
  end;
end $$;

revoke all on function public.fn_identity_rebuild_run(text) from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('identity-rebuild-nightly') where exists (select 1 from cron.job where jobname = 'identity-rebuild-nightly');
  perform cron.schedule('identity-rebuild-nightly', '30 2 * * *',
    $sql$set statement_timeout = '15min'; select public.fn_identity_rebuild_run('nightly')$sql$);

  perform cron.unschedule('identity-rebuild-queue') where exists (select 1 from cron.job where jobname = 'identity-rebuild-queue');
  perform cron.schedule('identity-rebuild-queue', '*/2 * * * *',
    $sql$select public.fn_identity_rebuild_mark(); commit; set statement_timeout = '15min'; select public.fn_identity_rebuild_tick()$sql$);
end $$;

-- reset the request left behind by the cancelled attempts so the first
-- run under the new command starts clean
update public.app_settings
   set value = value - 'go' || jsonb_build_object('attempts', 0, 'attempt_at', null)
 where key = 'identity_rebuild';
