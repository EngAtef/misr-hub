-- ============================================================
-- Migration 107: GA4 + Search Console pull kicked from pg_cron.
--
-- The Vercel Hobby cron for /api/cron/ga4-sync is best-effort — it skipped
-- 15 and 16 Aug 2026 (those days were first written by a manual Sync).
-- The Meta pull has been driven from pg_cron → net.http_get since 083 and
-- has not missed a run, so GA4/GSC now use the same mechanism, twice a
-- day: 05:00 UTC (yesterday complete) and 17:00 UTC (today refreshed).
-- Uses the same Vault secrets (app_base_url, cron_secret) as fn_ads_sync_kick.
-- ============================================================

create or replace function public.fn_ga4_sync_kick()
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
    raise exception 'fn_ga4_sync_kick: app_base_url and cron_secret must be stored in Vault first';
  end if;

  select net.http_get(
    url     => v_url || '/api/cron/ga4-sync',
    headers => jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds => 120000
  ) into v_id;
  return v_id;
end $$;
revoke all on function public.fn_ga4_sync_kick() from public;

select cron.unschedule('ga4-sync') where exists (select 1 from cron.job where jobname = 'ga4-sync');
select cron.schedule('ga4-sync', '0 5,17 * * *', $sql$select public.fn_ga4_sync_kick()$sql$);
