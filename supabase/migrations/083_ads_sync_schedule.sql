-- 083 — the twice-daily Meta ads sync, scheduled from Postgres
--
-- Why not Vercel: this project is on the Hobby plan, where a cron job may only
-- be triggered once per day. Setting "0 6,18 * * *" in vercel.json didn't
-- degrade to daily — it failed the whole deployment. pg_cron has no such
-- limit, runs on the minute rather than "some time within the hour", and
-- doesn't depend on the hosting plan, so the schedule lives here and Vercel
-- keeps a single daily entry as a harmless fallback.
--
-- 06:00 and 18:00 UTC = 09:00 and 21:00 in Cairo while Egypt is on EEST
-- (UTC+3, late April to late October). Egypt drops to UTC+2 in winter, and
-- pg_cron schedules are UTC, so from late October these land at 08:00 and
-- 20:00 local until spring. Re-run fn_ads_sync_schedule('0 7,19 * * *') then
-- if the clock time matters more than the interval.

create extension if not exists pg_cron;
create extension if not exists pg_net;

/**
 * Calls the app's sync endpoint. Runs as the cron owner, so it never touches
 * user data directly — it just pokes the route that already knows how to talk
 * to Meta.
 *
 * The URL and the shared secret live in Vault rather than in this file:
 *   select vault.create_secret('https://misr-hub.vercel.app', 'app_base_url');
 *   select vault.create_secret('<the CRON_SECRET from Vercel>', 'cron_secret');
 *
 * Without both, this raises instead of firing an unauthenticated request at
 * the internet — a scheduled job that quietly calls the wrong thing is worse
 * than one that fails loudly.
 */
create or replace function public.fn_ads_sync_kick(p_mode text default 'refresh')
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_url    text;
  v_secret text;
  v_id     bigint;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';

  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    raise exception 'fn_ads_sync_kick: app_base_url and cron_secret must be stored in Vault first';
  end if;

  select net.http_get(
    url     => v_url || '/api/cron/meta-ads-sync' ||
               case when p_mode = 'backfill' then '?mode=backfill' else '' end,
    headers => jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    -- the route budgets itself to ~52s; give it room to answer
    timeout_milliseconds => 120000
  ) into v_id;

  return v_id;
end $$;

revoke all on function public.fn_ads_sync_kick(text) from public;

/** Idempotent (re)scheduling, so the cadence can be changed in one call. */
create or replace function public.fn_ads_sync_schedule(p_cron text default '0 6,18 * * *')
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (select public.my_role()) <> 'admin' and not public.is_service_role() then
    raise exception 'only an admin can change the sync schedule';
  end if;

  perform cron.unschedule('meta-ads-sync')
  where exists (select 1 from cron.job where jobname = 'meta-ads-sync');

  perform cron.schedule('meta-ads-sync', p_cron, $sql$select public.fn_ads_sync_kick('refresh')$sql$);
  return p_cron;
end $$;

revoke all on function public.fn_ads_sync_schedule(text) from public;
grant execute on function public.fn_ads_sync_schedule(text) to authenticated, service_role;

-- 09:00 and 21:00 Cairo
select public.fn_ads_sync_schedule('0 6,18 * * *');
