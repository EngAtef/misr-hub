-- 125: align the OKR report's gross order count with the monthly source report and
-- the net source report. Gross orders (and its cancelled/returned splits) now count
-- ALL placed orders, not only orders containing bookstore items — Aug 1-23 that is
-- 1,282 vs the old 955. Revenue is unchanged (AL-Adwaa-only orders still contribute
-- 0 to gross revenue); CR moves with the count and now matches the other exports.

create or replace function public.fn_gaps_okr_report(p_month date)
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
  select o.order_number, o.order_status, o.actual_delivery_fees,
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
net_orders as (
  select ps.order_id, sum(ps.total_amount) as goods
  from public.product_sales ps, bounds b
  where ps.status = 'Delivered'
    and coalesce(ps.category, '') <> 'AL-Adwaa'
    and ps.order_date >= b.ts_from and ps.order_date < b.ts_to
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
         count(*) as orders
  from net_orders n
  left join public.orders x on x.order_number = n.order_id
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
$function$;
