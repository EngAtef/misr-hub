-- 141: two scheduled jobs that close the gaps found on 2026-09-06/08.
--
-- 1. Seal the previous month's Meta data.
--    The twice-daily refresh (083) only re-pulls the OPEN month. Whatever the
--    last pull of a month captured is what stays: Cultural's August froze on
--    Aug 20 (a silent 33k EGP hole in spend) and Kids/page were pulled at
--    18:00 on Aug 31, before the day ended. A backfill job per account on the
--    2nd of every month re-pulls the whole previous month and supersedes the
--    partial import (081's overlap guard), so closed months are always final.
--
-- 2. Refresh order attribution nightly.
--    orders.attr_bucket is filled from ga4_transactions, but the GA4 sync
--    (05:00 UTC) runs before the store orders import (06:30 UTC), so orders
--    that arrive after it stay unattributed until someone runs
--    fn_refresh_order_attribution by hand (141 orders were pending on 09-08).
--    A job at 07:00 UTC, after both imports, closes that window every day.
--
-- Both wrappers run from pg_cron, where there is no user session and
-- my_role() is null, so they assert the service role for the transaction
-- before calling the gated functions — the same trust the existing
-- fn_ads_sync_kick places in Vault. They are not granted to any client role.

create or replace function public.fn_ads_seal_month(p_month date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_start date := date_trunc('month', coalesce(p_month, (current_date - interval '1 month')::date))::date;
  v_end   date := (v_start + interval '1 month' - interval '1 day')::date;
  v_accounts jsonb;
  v_plan jsonb;
  v_req bigint;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select jsonb_agg(jsonb_build_object('id', a->>'id', 'label', a->>'label'))
    into v_accounts
  from public.app_settings s, jsonb_array_elements(s.value->'accounts') a
  where s.key = 'meta_ads'
    and coalesce((a->>'enabled')::boolean, false)
    and coalesce(s.value->>'enabled', 'true') <> 'false';

  if v_accounts is null or jsonb_array_length(v_accounts) = 0 then
    return jsonb_build_object('month', v_start, 'skipped', 'no enabled Meta accounts');
  end if;

  -- p_redo = true: a month that already has a job is re-queued on purpose
  v_plan := public.fn_ads_backfill_plan(v_accounts, v_start, v_end, true, 1);
  v_req  := public.fn_ads_sync_kick('backfill');

  return jsonb_build_object('month', v_start, 'to', v_end, 'accounts', jsonb_array_length(v_accounts), 'plan', v_plan, 'request', v_req);
end $$;

revoke all on function public.fn_ads_seal_month(date) from public, anon, authenticated;

create or replace function public.fn_refresh_attribution_cron()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  -- 60 days back covers late GA4 transactions and re-imported orders;
  -- tomorrow as the upper bound so today's orders are included
  return public.fn_refresh_order_attribution((current_date - 60)::date, (current_date + 1)::date);
end $$;

revoke all on function public.fn_refresh_attribution_cron() from public, anon, authenticated;

-- ---------------------------------------------------------------- schedules (UTC; Cairo = +3)
do $$
begin
  perform cron.unschedule('meta-ads-seal-month') where exists (select 1 from cron.job where jobname = 'meta-ads-seal-month');
  perform cron.schedule('meta-ads-seal-month', '15 6 2 * *', $sql$select public.fn_ads_seal_month()$sql$);   -- 2nd of month, 09:15 Cairo

  perform cron.unschedule('order-attribution') where exists (select 1 from cron.job where jobname = 'order-attribution');
  perform cron.schedule('order-attribution', '0 7 * * *', $sql$select public.fn_refresh_attribution_cron()$sql$); -- daily 10:00 Cairo
end $$;
