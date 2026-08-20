-- ============================================================
-- Migration 119: Monthly OKR report (GAPS page export).
--
-- A totals-only report — no tracking-gap sections, no AL-Adwaa block.
-- One number set per month, on the same bases the app already uses so
-- everything reconciles:
--   sessions   GA4 sessions, complete days only (same bounds as the
--              monthly source report, migration 106).
--   spend      ad-level Meta spend overlapping the month (same as the
--              monthly source report — never account/campaign level).
--   gross      bookstore items value ex-Al-Adwaa, cancelled removed,
--              delivery excluded — identical to the monthly report's
--              "revenue". gross_orders = orders placed carrying at
--              least one bookstore line, ANY status (the plan's
--              conversion denominator, migration 098).
--   net        delivered lines ex-Al-Adwaa + the delivery fees of the
--              orders holding them — identical to fn_targets_overview
--              (the SAP-reconciling basis). net_orders = the delivered
--              subset.
--   CR / ROAS  computed for both: orders ÷ sessions, revenue ÷ spend.
-- Run after 118.
-- ============================================================

create or replace function public.fn_gaps_okr_report(p_month date)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with bounds as (
  select date_trunc('month', p_month)::date as m_from,
         least((date_trunc('month', p_month) + interval '1 month')::date, current_date) as m_to
),
o as (
  select o.order_number, o.order_status, o.actual_delivery_fees
  from public.orders o, bounds b
  where o.order_date >= b.m_from and o.order_date < b.m_to
),
adwaa as (
  select sku from public.products where vendor = 'AL-Adwaa' or section = 'AL-Adwaa'
),
-- per-order bookstore value (ex-Adwaa), from the same source as the
-- monthly report so gross matches it to the pound
ov as (
  select o.order_number, o.order_status,
         coalesce(sum(oi.price) filter (where a.sku is null), 0) as book_val
  from o
  join public.order_items oi on oi.order_number = o.order_number
  left join adwaa a on a.sku = oi.sku
  group by 1, 2
),
-- delivered goods per order, from the same source as fn_targets_overview
-- so net matches the Targets page to the pound
net_orders as (
  select ps.order_id, sum(ps.total_amount) as goods
  from public.product_sales ps, bounds b
  where ps.status = 'Delivered'
    and coalesce(ps.category, '') <> 'AL-Adwaa'
    and ps.order_date >= b.m_from and ps.order_date < b.m_to
  group by 1
),
sessions as (
  select coalesce(sum(sessions), 0) as n
  from public.ga4_sources, bounds b
  where date >= b.m_from and date < b.m_to
),
spend as (
  select coalesce(sum(spend), 0) as n
  from public.ad_insights i, bounds b
  where i.level = 'ad' and i.period_end >= b.m_from and i.period_start < b.m_to
),
gross as (
  select coalesce(sum(book_val) filter (where order_status <> 'Cancelled'), 0) as revenue,
         count(*) filter (where book_val > 0) as orders,
         count(*) filter (where book_val > 0 and order_status = 'Cancelled') as cancelled
  from ov
),
net as (
  select coalesce(sum(n.goods + coalesce(x.actual_delivery_fees, 0)), 0) as revenue,
         count(*) as orders
  from net_orders n
  left join public.orders x on x.order_number = n.order_id
)
select jsonb_build_object(
  'month', (select m_from from bounds),
  'through', (select m_to - 1 from bounds),
  'sessions', (select n from sessions),
  'spend', (select round(n) from spend),
  'gross', (select jsonb_build_object(
      'revenue', round(revenue),
      'orders', orders,
      'cancelled', cancelled,
      'cr', round(100.0 * orders / nullif((select n from sessions), 0), 2),
      'roas', round(revenue / nullif((select n from spend), 0), 2)
    ) from gross),
  'net', (select jsonb_build_object(
      'revenue', round(revenue),
      'orders', orders,
      'cr', round(100.0 * orders / nullif((select n from sessions), 0), 2),
      'roas', round(revenue / nullif((select n from spend), 0), 2)
    ) from net)
);
$$;

revoke execute on function public.fn_gaps_okr_report(date) from public, anon;
grant execute on function public.fn_gaps_okr_report(date) to authenticated;
