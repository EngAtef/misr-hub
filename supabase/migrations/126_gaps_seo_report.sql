-- 126: SEO report export for /gaps.
-- fn_gaps_seo_month(p_month): one Cairo month of SEO-organic stats (web search only,
-- google-play excluded) — GSC impressions/clicks, organic web sessions, orders with
-- cancelled/returned splits, scorecard bookstore revenue (gross basis of 122), net
-- (delivered + delivery fees), AL-Adwaa and delivery-fee info values, and the GA4-side
-- revenue pieces needed to draw the "GA4 organic -> Hub SEO" ladder.
-- fn_gaps_seo_report(p_month): current + previous month blocks for the print report.
-- Same conventions as 122-125: Egypt-midnight bounds, complete days only, dead
-- statuses lose revenue, adjacent-period_month transaction matching.

create or replace function public.fn_gaps_seo_month(p_month date)
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
  select o.*,
         (o.order_status = 'Cancelled') as is_cancelled,
         (o.order_status in ('Returned', 'Return Request', 'Return Sent To Erp', 'Delivery Failed')) as is_returned
  from public.orders o, bounds b
  where o.order_date >= b.ts_from and o.order_date < b.ts_to
),
adwaa as (
  select sku from public.products where vendor = 'AL-Adwaa' or section = 'AL-Adwaa'
),
seo_tx as (
  select distinct on (t.transaction_id) t.transaction_id
  from public.ga4_transactions t, bounds b
  where t.period_month in ((b.m_from - interval '1 month')::date, b.m_from)
    and t.medium = 'organic' and t.source <> 'google-play'
    and exists (select 1 from public.orders x
                where x.order_number = t.transaction_id
                  and x.order_date >= b.ts_from and x.order_date < b.ts_to)
  order by t.transaction_id, t.period_month desc
),
so as (
  select o.* from o join seo_tx s on s.transaction_id = o.order_number
),
ov as (
  select so.order_number, so.is_cancelled, so.is_returned, so.actual_delivery_fees,
         (so.total_order_amount - coalesce(so.total_cart_amount, 0)) as delivery_fee,
         coalesce(sum(oi.price) filter (where a.sku is null), 0) as book_val,
         coalesce(sum(oi.price) filter (where a.sku is not null), 0) as adwaa_val
  from so
  join public.order_items oi on oi.order_number = so.order_number
  left join adwaa a on a.sku = oi.sku
  group by 1, 2, 3, 4, 5
),
net_o as (
  select ps.order_id, sum(ps.total_amount) as goods
  from public.product_sales ps, bounds b
  where ps.status = 'Delivered'
    and coalesce(ps.category, '') <> 'AL-Adwaa'
    and ps.order_date >= b.ts_from and ps.order_date < b.ts_to
    and exists (select 1 from seo_tx s where s.transaction_id = ps.order_id)
  group by 1
),
ga4_side as (
  select
    coalesce(sum(t.revenue) filter (where t.source <> 'google-play'), 0) as web_revenue,
    coalesce(sum(t.revenue) filter (where t.source = 'google-play'), 0) as app_revenue
  from public.ga4_transactions t, bounds b
  where t.period_month = b.m_from and t.medium = 'organic'
),
sess as (
  select coalesce(sum(sessions), 0) as n
  from public.ga4_sources, bounds b
  where date >= b.m_from and date < b.m_to_d
    and medium = 'organic' and source <> 'google-play'
),
gsc as (
  select coalesce(sum(clicks), 0) as clicks, coalesce(sum(impressions), 0) as impressions
  from public.gsc_daily, bounds b
  where date >= b.m_from and date < b.m_to_d
)
select jsonb_build_object(
  'month', (select m_from from bounds),
  'through', (select m_to_d - 1 from bounds),
  'days', (select m_to_d - m_from from bounds),
  'gsc_impressions', (select impressions from gsc),
  'gsc_clicks', (select clicks from gsc),
  'sessions', (select n from sess),
  'orders', (select count(*) from so),
  'cancelled', (select count(*) from so where is_cancelled),
  'returned', (select count(*) from so where is_returned),
  'book_revenue', (select round(coalesce(sum(book_val) filter (where not (is_cancelled or is_returned)), 0)) from ov),
  'adwaa_revenue', (select round(coalesce(sum(adwaa_val) filter (where not (is_cancelled or is_returned)), 0)) from ov),
  'delivery_fees', (select round(coalesce(sum(delivery_fee) filter (where not (is_cancelled or is_returned)), 0)) from ov),
  'cancelled_value', (select round(coalesce(sum(book_val + adwaa_val) filter (where is_cancelled), 0)) from ov),
  'returned_value', (select round(coalesce(sum(book_val + adwaa_val) filter (where is_returned), 0)) from ov),
  'delivered', (select count(*) from net_o),
  'net_revenue', (select round(coalesce(sum(n.goods + coalesce(x.actual_delivery_fees, 0)), 0))
                    from net_o n join so x on x.order_number = n.order_id),
  'pending', (select count(*) from so
              where not (is_cancelled or is_returned)
                and not exists (select 1 from net_o n where n.order_id = so.order_number)),
  'ga4_web_revenue', (select round(web_revenue) from ga4_side),
  'ga4_app_revenue', (select round(app_revenue) from ga4_side)
)
where (select public.my_role()) in ('admin', 'manager', 'viewer');
$function$;

create or replace function public.fn_gaps_seo_report(p_month date)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $function$
select jsonb_build_object(
  'month', date_trunc('month', p_month)::date,
  'cur', public.fn_gaps_seo_month(p_month),
  'prev', public.fn_gaps_seo_month((date_trunc('month', p_month) - interval '1 month')::date)
)
where (select public.my_role()) in ('admin', 'manager', 'viewer');
$function$;
