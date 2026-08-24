-- 124: net per-source export for /gaps.
-- fn_gaps_net_source_report(p_month): per source (GA4 bucket, adjacent-month matched
-- like 123) — placed orders, gross revenue (products ex-Adwaa, dead revenue removed),
-- delivered orders, net revenue (delivered items ex-Adwaa + those orders' delivery
-- fees — the Targets basis), and in-transit counts; totals carry BOTH bases (gross +
-- net) with CR and ROAS each, plus a pending block so a running month's low net is
-- explained. Cairo month bounds, complete days only (same conventions as 122/123).

create or replace function public.fn_gaps_net_source_report(p_month date)
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
ov as (
  select o.order_number, o.is_cancelled, o.is_returned,
         coalesce(sum(oi.price) filter (where a.sku is null), 0) as book_val
  from o
  join public.order_items oi on oi.order_number = o.order_number
  left join adwaa a on a.sku = oi.sku
  group by 1, 2, 3
),
tx as (
  select distinct on (t.transaction_id)
         t.transaction_id,
         case
           when t.source ~* 'bit\.ly' then 'bitly'
           when (t.source ~* 'facebook|instagram|meta' or t.source ~* '^(fb|ig|adv)$'
                 or t.medium ~* '^(paid|adv|static|post|parent)')
             and coalesce(t.medium, '') <> 'referral' then 'meta_tagged'
           when (t.source ~* 'facebook|instagram|meta' or t.source ~* '^(fb|ig)$')
             and t.medium = 'referral' then 'meta_untagged'
           when t.source = 'google' and t.medium = 'cpc' then 'google_ads'
           when t.source in ('(direct)', '(not set)') or t.source is null then 'direct'
           when t.medium = 'organic' and t.source <> 'google-play' then 'seo'
           when t.source = 'google-play' then 'appstore'
           else 'other'
         end as bucket
  from public.ga4_transactions t, bounds b
  where t.period_month in ((b.m_from - interval '1 month')::date, b.m_from)
    and exists (select 1 from public.orders x
                where x.order_number = t.transaction_id
                  and x.order_date >= b.ts_from and x.order_date < b.ts_to)
  order by t.transaction_id, t.period_month desc
),
net_o as (
  select ps.order_id, sum(ps.total_amount) as goods
  from public.product_sales ps, bounds b
  where ps.status = 'Delivered'
    and coalesce(ps.category, '') <> 'AL-Adwaa'
    and ps.order_date >= b.ts_from and ps.order_date < b.ts_to
  group by 1
),
sess as (
  select case
           when source ~* 'bit\.ly' then 'bitly'
           when (source ~* 'facebook|instagram|meta' or source ~* '^(fb|ig|adv)$'
                 or medium ~* '^(paid|adv|static|post|parent)')
             and coalesce(medium, '') <> 'referral' then 'meta_tagged'
           when (source ~* 'facebook|instagram|meta' or source ~* '^(fb|ig)$')
             and medium = 'referral' then 'meta_untagged'
           when source = 'google' and medium = 'cpc' then 'google_ads'
           when source in ('(direct)', '(not set)') then 'direct'
           when medium = 'organic' and source <> 'google-play' then 'seo'
           when source = 'google-play' then 'appstore'
           else 'other'
         end as bucket,
         sum(sessions) as sessions
  from public.ga4_sources, bounds b
  where date >= b.m_from and date < b.m_to_d
  group by 1
),
spend as (
  select coalesce(sum(spend), 0) as n
  from public.ad_insights i, bounds b
  where i.level = 'ad' and i.period_end >= b.m_from and i.period_start < b.m_to_d
),
rows_ as (
  select coalesce(t.bucket, 'untracked') as bucket,
         count(*) as orders,
         coalesce(sum(v.book_val) filter (where not (o.is_cancelled or o.is_returned)), 0) as gross_revenue,
         count(n.order_id) as delivered,
         coalesce(sum(n.goods + coalesce(o.actual_delivery_fees, 0)), 0) as net_revenue,
         count(*) filter (where not (o.is_cancelled or o.is_returned) and n.order_id is null) as pending,
         coalesce(sum(v.book_val) filter (where not (o.is_cancelled or o.is_returned) and n.order_id is null), 0) as pending_value
  from o
  left join tx t on t.transaction_id = o.order_number
  left join ov v on v.order_number = o.order_number
  left join net_o n on n.order_id = o.order_number
  group by 1
),
merged as (
  select coalesce(s.bucket, r.bucket) as bucket,
         s.sessions,
         coalesce(r.orders, 0) as orders,
         coalesce(r.gross_revenue, 0) as gross_revenue,
         coalesce(r.delivered, 0) as delivered,
         coalesce(r.net_revenue, 0) as net_revenue,
         coalesce(r.pending, 0) as pending,
         coalesce(r.pending_value, 0) as pending_value
  from sess s full outer join rows_ r on r.bucket = s.bucket
),
totals as (
  select
    (select coalesce(sum(sessions), 0) from sess) as sessions,
    (select round(n) from spend) as spend,
    (select count(*) from o) as orders,
    (select count(*) from o where is_cancelled) as cancelled,
    (select count(*) from o where is_returned) as returned,
    (select round(coalesce(sum(book_val), 0)) from ov where not (is_cancelled or is_returned)) as gross_revenue,
    (select count(*) from net_o) as delivered,
    (select round(coalesce(sum(n.goods + coalesce(x.actual_delivery_fees, 0)), 0))
       from net_o n join o x on x.order_number = n.order_id) as net_revenue,
    (select coalesce(sum(pending), 0) from rows_) as pending,
    (select round(coalesce(sum(pending_value), 0)) from rows_) as pending_value
)
select jsonb_build_object(
  'month', (select m_from from bounds),
  'through', (select m_to_d - 1 from bounds),
  'totals', (select jsonb_build_object(
    'sessions', sessions, 'spend', spend,
    'gross', jsonb_build_object(
      'revenue', gross_revenue, 'orders', orders,
      'cancelled', cancelled, 'returned', returned,
      'cr', round(100.0 * orders / nullif(sessions, 0), 2),
      'roas', round(gross_revenue / nullif(spend, 0), 2)),
    'net', jsonb_build_object(
      'revenue', net_revenue, 'orders', delivered,
      'cr', round(100.0 * delivered / nullif(sessions, 0), 2),
      'roas', round(net_revenue / nullif(spend, 0), 2)),
    'pending', jsonb_build_object('orders', pending, 'book_value', pending_value)
  ) from totals),
  'rows', (select coalesce(jsonb_agg(jsonb_build_object(
      'bucket', bucket, 'sessions', sessions, 'orders', orders,
      'gross_revenue', round(gross_revenue),
      'delivered', delivered, 'net_revenue', round(net_revenue),
      'pending', pending, 'pending_value', round(pending_value))
      order by net_revenue desc), '[]'::jsonb) from merged)
)
where (select public.my_role()) in ('admin', 'manager', 'viewer');
$function$;
