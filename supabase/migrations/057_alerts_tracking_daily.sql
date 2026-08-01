-- ============================================================
-- Migration 057: GA4 growth reports (phase 3)
-- fn_alerts gains daily tracking rates (7d vs 30d, from ga4_daily)
-- so the alerts bar can flag a tracking break the day after it
-- happens instead of at month-end. Run after 056.
-- ============================================================

create or replace function public.fn_alerts()
returns json
language sql stable
as $$
  with latest_tx_month as (
    select max(period_month) as m from public.ga4_transactions
  ),
  tracking as (
    select
      (select m from latest_tx_month) as month,
      (select count(*) from public.orders o, latest_tx_month lm
        where lm.m is not null and o.order_date >= lm.m and o.order_date < lm.m + interval '1 month') as orders,
      (select count(*) from public.orders o, latest_tx_month lm
        where lm.m is not null and o.order_date >= lm.m and o.order_date < lm.m + interval '1 month'
          and exists (select 1 from public.ga4_transactions g where g.transaction_id = o.order_number)) as tracked
  ),
  -- daily tracking health from the GA4 API sync (today excluded: incomplete)
  tdaily as (
    select
      (select sum(purchases) from public.ga4_daily where date >= current_date - 7 and date < current_date) as ga4_7,
      (select count(*) from public.orders where order_date >= current_date - 7 and order_date < current_date) as orders_7,
      (select sum(purchases) from public.ga4_daily where date >= current_date - 30 and date < current_date) as ga4_30,
      (select count(*) from public.orders where order_date >= current_date - 30 and order_date < current_date) as orders_30
  ),
  stockouts as (
    select count(*) as n from (
      select coalesce(nullif(i.sku,''),'x') as sku,
        count(*) filter (where o.order_date >= now() - interval '30 days') as recent,
        count(*) filter (where o.order_date >= now() - interval '120 days' and o.order_date < now() - interval '30 days') as hist
      from public.order_items i
      join public.orders o on o.order_number = i.order_number
      where o.order_status not in ('Cancelled') and o.order_date >= now() - interval '120 days'
      group by 1
    ) s
    where s.recent = 0 and s.hist >= 10
  ),
  cancels as (
    select
      count(*) filter (where order_date >= now() - interval '7 days' and order_status = 'Cancelled') as recent_cancels,
      count(*) filter (where order_date >= now() - interval '7 days') as recent_orders,
      count(*) filter (where order_date >= now() - interval '14 days' and order_date < now() - interval '7 days' and order_status = 'Cancelled') as prior_cancels,
      count(*) filter (where order_date >= now() - interval '14 days' and order_date < now() - interval '7 days') as prior_orders
    from public.orders
  ),
  pace as (
    select t.period_month, t.total_target,
      coalesce((select sum(o.total_order_amount) from public.orders o
        where o.order_status not in ('Cancelled','Returned','Return Sent To Erp')
          and o.order_date >= t.period_month and o.order_date < t.period_month + interval '1 month'), 0) as actual
    from public.targets t
    where t.period_month = date_trunc('month', now())::date
  ),
  bdays as (
    select count(*) as n from public.customers
    where birthdate is not null and extract(month from birthdate) = extract(month from now())
      and coalesce(is_active, true)
  )
  select json_build_object(
    'tracking_month', (select month from tracking),
    'tracking_rate', (select case when orders > 0 then round(tracked::numeric * 100 / orders, 1) else null end from tracking),
    'untracked', (select orders - tracked from tracking),
    'tracking_rate_7d', (select case when orders_7 > 0 and ga4_7 is not null then round(ga4_7 * 100 / orders_7, 1) else null end from tdaily),
    'tracking_rate_30d', (select case when orders_30 > 0 and ga4_30 is not null then round(ga4_30 * 100 / orders_30, 1) else null end from tdaily),
    'stockouts', (select n from stockouts),
    'cancel_rate_recent', (select case when recent_orders > 0 then round(recent_cancels::numeric * 100 / recent_orders, 1) else 0 end from cancels),
    'cancel_rate_prior', (select case when prior_orders > 0 then round(prior_cancels::numeric * 100 / prior_orders, 1) else 0 end from cancels),
    'target_total', (select total_target from pace),
    'target_actual', (select actual from pace),
    'target_expected_pct', round(extract(day from now())::numeric * 100 / extract(day from (date_trunc('month', now()) + interval '1 month' - interval '1 day')), 0),
    'birthdays_this_month', (select n from bdays),
    'never_purchased', (select count(*) from public.customers c
      where not exists (select 1 from public.orders o where o.customer_id = c.customer_id)
        and coalesce(c.is_active, true))
  );
$$;
