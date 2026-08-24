-- 129: combined OKR + pieces export for /gaps.
-- fn_gaps_okr_pieces_report(p_month): the OKR totals (gross + net revenue/orders,
-- CR, ROAS, spend, sessions) extended with pieces on both bases — gross pieces =
-- quantities in alive placed orders (ex-Adwaa), net pieces = delivered quantities
-- (ex-Adwaa, matches /targets actual_pieces) — plus the month's money and pieces
-- targets with attainment (measured on the net basis, same as the Targets page).
-- Cairo months, complete days only, dead statuses excluded (122-128 conventions).

create or replace function public.fn_gaps_okr_pieces_report(p_month date)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $function$
with bounds as (
  select date_trunc('month', p_month)::date as m_from,
         least((date_trunc('month', p_month) + interval '1 month')::date,
               (now() at time zone 'Africa/Cairo')::date) as m_to_d,
         (date_trunc('month', p_month)::timestamp at time zone 'Africa/Cairo') as ts_from,
         (least((date_trunc('month', p_month) + interval '1 month')::date,
                (now() at time zone 'Africa/Cairo')::date)::timestamp
            at time zone 'Africa/Cairo') as ts_to
),
o as (
  select o.order_number, o.actual_delivery_fees,
         (o.order_status = 'Cancelled') as is_cancelled,
         (o.order_status in ('Returned', 'Return Request', 'Return Sent To Erp', 'Delivery Failed')) as is_returned
  from public.orders o, bounds b
  where o.order_date >= b.ts_from and o.order_date < b.ts_to
),
adwaa as (
  select sku from public.products where vendor = 'AL-Adwaa' or section = 'AL-Adwaa'
),
ov as (
  select o.order_number, o.is_cancelled, o.is_returned,
         coalesce(sum(oi.price) filter (where a.sku is null), 0) as book_val
  from o
  join public.order_items oi on oi.order_number = o.order_number
  left join adwaa a on a.sku = oi.sku
  group by 1, 2, 3
),
ps_lines as (
  select ps.order_id, ps.status, sum(coalesce(ps.quantity, 0)) as pieces,
         sum(ps.total_amount) filter (where ps.status = 'Delivered') as delivered_goods
  from public.product_sales ps, bounds b
  where coalesce(ps.category, '') <> 'AL-Adwaa'
    and ps.order_date >= b.ts_from and ps.order_date < b.ts_to
  group by 1, 2
),
gross_pieces as (
  select coalesce(sum(p.pieces), 0) as n
  from ps_lines p
  join o on o.order_number = p.order_id
  where not (o.is_cancelled or o.is_returned)
),
net_orders as (
  select p.order_id, sum(p.delivered_goods) as goods, sum(p.pieces) as pieces
  from ps_lines p
  where p.status = 'Delivered'
  group by 1
),
sessions as (
  select coalesce(sum(sessions), 0) as n
  from public.ga4_sources, bounds b
  where date >= b.m_from and date < b.m_to_d
),
spend as (
  select coalesce(sum(spend), 0) as n
  from public.ad_insights i, bounds b
  where i.level = 'ad' and i.period_end >= b.m_from and i.period_start < b.m_to_d
),
gross as (
  select coalesce((select sum(book_val) from ov where not (is_cancelled or is_returned)), 0) as revenue,
         (select count(*) from o) as orders,
         (select count(*) from o where is_cancelled) as cancelled,
         (select count(*) from o where is_returned) as returned
),
net as (
  select coalesce(sum(n.goods + coalesce(x.actual_delivery_fees, 0)), 0) as revenue,
         count(*) as orders,
         coalesce(sum(n.pieces), 0) as pieces
  from net_orders n
  left join public.orders x on x.order_number = n.order_id
),
tgt as (
  select t.total_target, t.pieces_target, t.ly_revenue, t.ly_pieces
  from public.targets t, bounds b
  where t.period_month = b.m_from
)
select jsonb_build_object(
  'month', (select m_from from bounds),
  'through', (select m_to_d - 1 from bounds),
  'sessions', (select n from sessions),
  'spend', (select round(n) from spend),
  'gross', (select jsonb_build_object(
      'revenue', round(revenue),
      'orders', orders,
      'cancelled', cancelled,
      'returned', returned,
      'pieces', (select n from gross_pieces),
      'cr', round(100.0 * orders / nullif((select n from sessions), 0), 2),
      'roas', round(revenue / nullif((select n from spend), 0), 2)
    ) from gross),
  'net', (select jsonb_build_object(
      'revenue', round(revenue),
      'orders', orders,
      'pieces', pieces,
      'cr', round(100.0 * orders / nullif((select n from sessions), 0), 2),
      'roas', round(revenue / nullif((select n from spend), 0), 2)
    ) from net),
  'target', (select jsonb_build_object(
      'revenue', round(total_target),
      'pieces', round(pieces_target),
      'ly_revenue', round(ly_revenue),
      'ly_pieces', round(ly_pieces),
      'revenue_pct', case when total_target > 0
        then round((select revenue from net) * 100 / total_target, 1) else null end,
      'pieces_pct', case when pieces_target > 0
        then round((select pieces from net) * 100 / pieces_target, 1) else null end
    ) from tgt)
)
where (select public.my_role()) in ('admin', 'manager', 'viewer');
$function$;
