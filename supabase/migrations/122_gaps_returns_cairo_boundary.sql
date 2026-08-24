-- 122: two correctness fixes across the GAPS month reports (found verifying August 2026):
--
-- 1. Returned revenue was still counted. Only status = 'Cancelled' lost its revenue;
--    'Return Sent To Erp' / 'Delivery Failed' / 'Returned' / 'Return Request' kept theirs
--    (Aug 1-23: 65 orders / 21,837 EGP). Now every dead status loses its revenue, with
--    cancelled and returned reported as separate counts (returned_revenue shown for info).
--
-- 2. Month boundaries ran on UTC midnight = 03:00 Cairo, so orders placed 00:00-03:00
--    Cairo on the 1st landed in the previous month. All order windows now cut at Cairo
--    midnight, and "complete days only" (migration 106) now uses the Cairo date too.
--    Date-keyed tables (ga4_daily/ga4_sources/gsc_daily) already store Cairo-local days
--    and keep using plain date bounds; fn_gaps_report's daily slices now bucket orders
--    by Cairo day so they line up with GA4 days.
--
-- Bases stay reconciled: OKR "gross" moves with the monthly report (both now exclude
-- returned revenue); OKR "net" (delivered only) was already immune.

-- ---------------------------------------------------------------------------
create or replace function public.fn_gaps_source_report(p_month date)
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
         coalesce(sum(oi.price) filter (where a.sku is null), 0) as book_val,
         coalesce(sum(oi.price) filter (where a.sku is not null), 0) as adwaa_val
  from o
  join public.order_items oi on oi.order_number = o.order_number
  left join adwaa a on a.sku = oi.sku
  group by 1, 2, 3
),
tx as (
  select t.transaction_id, t.campaign,
         coalesce(t.source, '?') || '/' || coalesce(t.medium, '?') as combo,
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
  where t.period_month = b.m_from
    and not exists (select 1 from public.orders x
                    where x.order_number = t.transaction_id and x.order_date >= b.ts_to)
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
rows_ as (
  select coalesce(t.bucket, 'untracked') as bucket,
         count(*) as orders,
         count(*) filter (where o.is_cancelled) as cancelled,
         count(*) filter (where o.is_returned) as returned,
         coalesce(sum(v.book_val) filter (where not (o.is_cancelled or o.is_returned)), 0) as revenue,
         coalesce(sum(v.book_val) filter (where o.is_returned), 0) as returned_revenue,
         coalesce(sum(v.adwaa_val) filter (where not (o.is_cancelled or o.is_returned)), 0) as adwaa_revenue
  from o
  left join tx t on t.transaction_id = o.order_number
  left join ov v on v.order_number = o.order_number
  group by 1
),
merged as (
  select coalesce(s.bucket, r.bucket) as bucket,
         s.sessions, coalesce(r.orders, 0) as orders,
         coalesce(r.cancelled, 0) as cancelled,
         coalesce(r.returned, 0) as returned,
         coalesce(r.revenue, 0) as revenue,
         coalesce(r.returned_revenue, 0) as returned_revenue,
         coalesce(r.adwaa_revenue, 0) as adwaa_revenue
  from sess s full outer join rows_ r on r.bucket = s.bucket
),
spend as (
  select account_label, coalesce(sum(spend), 0) as spend
  from public.ad_insights i, bounds b
  where i.level = 'ad' and i.period_end >= b.m_from and i.period_start < b.m_to_d
  group by 1
),
named as (
  select t.transaction_id from tx t
  where t.campaign is not null
    and t.campaign not in ('(not set)', '(referral)', '(organic)', '(direct)', '(none)')
),
adwaa_info as (
  select
    coalesce(sum(v.adwaa_val) filter (where not (v.is_cancelled or v.is_returned)), 0) as revenue,
    count(*) filter (where v.adwaa_val > 0 and not (v.is_cancelled or v.is_returned)) as orders,
    count(*) filter (where v.adwaa_val > 0 and v.book_val = 0 and not (v.is_cancelled or v.is_returned)) as adwaa_only_orders,
    coalesce(sum(v.adwaa_val) filter (where not (v.is_cancelled or v.is_returned)
      and t.bucket in ('meta_tagged', 'meta_untagged')), 0) as from_ads_revenue,
    count(*) filter (where v.adwaa_val > 0 and not (v.is_cancelled or v.is_returned)
      and t.bucket in ('meta_tagged', 'meta_untagged')) as from_ads_orders
  from ov v
  left join tx t on t.transaction_id = v.order_number
),
totals as (
  select
    (select coalesce(sum(sessions), 0) from sess) as sessions,
    (select count(*) from o) as orders,
    (select count(*) from o where is_cancelled) as cancelled,
    (select count(*) from o where is_returned) as returned,
    (select round(coalesce(sum(book_val), 0)) from ov where not (is_cancelled or is_returned)) as revenue,
    (select round(coalesce(sum(book_val), 0)) from ov where is_returned) as returned_revenue,
    (select round(coalesce(sum(book_val + adwaa_val), 0)) from ov where not (is_cancelled or is_returned)) as revenue_incl_adwaa,
    (select round(coalesce(sum(total_order_amount - coalesce(total_cart_amount, 0)), 0)) from o) as delivery_fees,
    (select round(coalesce(sum(spend), 0)) from spend) as spend
)
select jsonb_build_object(
  'month', (select m_from from bounds),
  'totals', (select jsonb_build_object(
    'sessions', sessions, 'orders', orders, 'cancelled', cancelled,
    'returned', returned, 'returned_revenue', returned_revenue,
    'revenue', revenue, 'revenue_incl_adwaa', revenue_incl_adwaa,
    'delivery_fees', delivery_fees, 'spend', spend,
    'cr', round(100.0 * orders / nullif(sessions, 0), 2),
    'aov', round(revenue / nullif(orders - cancelled - returned, 0)),
    'spend_pct_of_revenue', round(100.0 * spend / nullif(revenue, 0), 1)
  ) from totals),
  'spend_by_account', (select coalesce(jsonb_agg(jsonb_build_object(
      'account', account_label, 'spend', round(spend)) order by spend desc), '[]'::jsonb) from spend),
  'rows', (select coalesce(jsonb_agg(jsonb_build_object(
      'bucket', bucket, 'sessions', sessions, 'orders', orders, 'cancelled', cancelled,
      'returned', returned, 'returned_revenue', round(returned_revenue),
      'revenue', round(revenue), 'adwaa_revenue', round(adwaa_revenue),
      'cr', round(100.0 * orders / nullif(sessions, 0), 2),
      'aov', round(revenue / nullif(orders - cancelled - returned, 0)))
      order by revenue desc), '[]'::jsonb) from merged),
  'adwaa', (select jsonb_build_object(
    'revenue', round(revenue), 'orders', orders, 'adwaa_only_orders', adwaa_only_orders,
    'from_ads_revenue', round(from_ads_revenue), 'from_ads_orders', from_ads_orders
  ) from adwaa_info),
  'campaigns', jsonb_build_object(
    'orders_with_campaign', (select count(*) from named),
    'pct_of_orders', (select round(100.0 * (select count(*) from named) / nullif(count(*), 0), 1) from o),
    'campaign_revenue', (select round(coalesce(sum(v.book_val), 0)) from ov v
                         join named n on n.transaction_id = v.order_number
                         where not (v.is_cancelled or v.is_returned)),
    'combos_on_purchases', (select count(distinct combo) from tx),
    'combos_all_traffic', (select count(distinct source || '/' || coalesce(medium, ''))
                           from public.ga4_sources, bounds b
                           where date >= b.m_from and date < b.m_to_d)
  )
)
where (select public.my_role()) in ('admin', 'manager', 'viewer');
$function$;

-- ---------------------------------------------------------------------------
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
  select coalesce(sum(book_val) filter (where not (is_cancelled or is_returned)), 0) as revenue,
         count(*) filter (where book_val > 0) as orders,
         count(*) filter (where book_val > 0 and is_cancelled) as cancelled,
         count(*) filter (where book_val > 0 and is_returned) as returned
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

-- ---------------------------------------------------------------------------
-- boundary fix only — payload shape and revenue definitions unchanged
create or replace function public.fn_tracking_summary(p_month date)
returns json
language sql stable
set search_path to 'public'
as $function$
  with bounds as (
    select (p_month::timestamp at time zone 'Africa/Cairo') as ts_from,
           (least((p_month + interval '1 month')::date,
                  (now() at time zone 'Africa/Cairo')::date)::timestamp
              at time zone 'Africa/Cairo') as ts_to
  ),
  o as (
    select order_number, total_order_amount, source, payment_method
    from public.orders, bounds b
    where order_date >= b.ts_from and order_date < b.ts_to
  ),
  g as (
    select t.transaction_id, t.revenue
    from public.ga4_transactions t, bounds b
    where t.period_month = p_month
      and not exists (select 1 from public.orders x
                      where x.order_number = t.transaction_id and x.order_date >= b.ts_to)
  )
  select json_build_object(
    'orders', (select count(*) from o),
    'orders_revenue', (select coalesce(sum(total_order_amount),0) from o),
    'ga4_transactions', (select count(*) from g),
    'ga4_revenue', (select coalesce(sum(revenue),0) from g),
    'tracked', (select count(*) from o where exists (select 1 from g where g.transaction_id = o.order_number)),
    'untracked', (select count(*) from o where not exists (select 1 from g where g.transaction_id = o.order_number)),
    'untracked_revenue', (select coalesce(sum(o.total_order_amount),0) from o where not exists (select 1 from g where g.transaction_id = o.order_number)),
    'ga4_only', (select count(*) from g where not exists (select 1 from o where o.order_number = g.transaction_id)),
    'untracked_by_source', (
      select coalesce(json_object_agg(coalesce(source,'unknown'), cnt), '{}'::json) from (
        select source, count(*) as cnt from o
        where not exists (select 1 from g where g.transaction_id = o.order_number)
        group by source
      ) s
    ),
    'payment_breakdown', (
      select coalesce(json_agg(row_to_json(p)), '[]'::json) from (
        select
          coalesce(payment_method,'unknown') as payment_method,
          count(*) filter (where not exists (select 1 from g where g.transaction_id = o.order_number)) as untracked,
          count(*) as total
        from o
        group by payment_method
        order by 2 desc
      ) p
    )
  );
$function$;

-- ---------------------------------------------------------------------------
-- boundary fix only — payload shape and revenue definitions unchanged;
-- daily/weekly slices now bucket orders by Cairo day so they align with GA4 days
create or replace function public.fn_gaps_report(p_month date)
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
  select o.* from public.orders o, bounds b
  where o.order_date >= b.ts_from and o.order_date < b.ts_to
),
o_status as (
  select order_status, count(*) as n, coalesce(sum(total_order_amount), 0) as revenue
  from o group by 1
),
chan as (
  select coalesce(o.source, '(unknown)') as channel,
         count(*) as orders,
         coalesce(sum(o.total_order_amount), 0) as revenue,
         count(t.transaction_id) as tracked,
         coalesce(sum(o.total_order_amount) filter (where t.transaction_id is null), 0) as untracked_revenue
  from o
  left join public.ga4_transactions t
    on t.period_month = (select m_from from bounds) and t.transaction_id = o.order_number
  group by 1
),
tx as (
  select t.*,
         case
           when t.source ~* 'facebook|instagram|meta' or t.source ~* '^(fb|ig)$'
             or t.medium ~* '^(paid|adv|static|post|parent)' or t.source ~* '^adv$' then 'meta'
           when t.source = 'google' and t.medium = 'cpc' then 'google_ads'
           when t.source = 'google' and t.medium = 'organic' then 'google_organic'
           when t.source ~* 'bit\.ly' then 'shortlinks'
           when t.source = '(direct)' then 'direct'
           when t.medium = 'referral' then 'referral'
           else 'other'
         end as bucket
  from public.ga4_transactions t, bounds b
  where t.period_month = b.m_from
    and not exists (select 1 from public.orders x
                    where x.order_number = t.transaction_id and x.order_date >= b.ts_to)
),
buckets as (
  select bucket, count(*) as tx, coalesce(sum(revenue), 0) as revenue
  from tx group by 1
),
frag as (
  select coalesce(source, '(not set)') as source,
         coalesce(medium, '(not set)') as medium,
         bucket,
         (coalesce(medium, '') not in ('referral', '(none)', '(not set)')) as tagged,
         count(*) as tx,
         coalesce(sum(revenue), 0) as revenue
  from tx group by 1, 2, 3, 4
  order by revenue desc
  limit 24
),
meta_ads as (
  select i.* from public.ad_insights i, bounds b
  where i.level = 'ad' and i.period_end >= b.m_from and i.period_start < b.m_to_d
),
meta as (
  select count(*) as ads,
         count(distinct campaign_name) as campaigns,
         coalesce(sum(spend), 0) as spend,
         coalesce(sum(purchases), 0) as purchases,
         coalesce(sum(conversion_value), 0) as value,
         coalesce(sum(link_clicks), 0) as clicks,
         coalesce(sum(adds_to_cart), 0) as atc,
         coalesce(sum(checkouts_initiated), 0) as checkouts
  from meta_ads
),
mapped as (
  select a.id, a.ad_name, a.campaign_name, a.spend,
         coalesce(ma.book_label, mc.book_label) as book_label
  from meta_ads a
  left join public.ad_map_effective ma
    on ma.match_level = 'ad' and ma.active and ma.pattern = public.norm_ad(a.ad_name)
  left join public.ad_map_effective mc
    on mc.match_level = 'campaign' and mc.active and mc.pattern = public.norm_ad(a.campaign_name)
),
unmapped_top as (
  select ad_name, campaign_name, round(coalesce(spend, 0)) as spend
  from mapped where book_label is null
  order by spend desc nulls last
  limit 15
),
g4 as (
  select coalesce(sum(sessions), 0) as sessions,
         coalesce(sum(purchases), 0) as purchases,
         coalesce(sum(revenue), 0) as revenue,
         count(*) as days,
         max(date) filter (where sessions > 0) as last_day
  from public.ga4_daily, bounds b
  where date >= b.m_from and date < b.m_to_d
),
g4_meta_sessions as (
  select coalesce(sum(sessions), 0) as sessions
  from public.ga4_sources, bounds b
  where date >= b.m_from and date < b.m_to_d
    and (source ~* 'facebook|instagram|meta' or source ~* '^(fb|ig|adv)$'
         or medium ~* '^(paid|adv|static|post|parent)')
),
g4_organic_sessions as (
  select coalesce(sum(sessions), 0) as sessions
  from public.ga4_sources, bounds b
  where date >= b.m_from and date < b.m_to_d
    and source = 'google' and medium = 'organic'
),
gsc as (
  select coalesce(sum(clicks), 0) as clicks,
         coalesce(sum(impressions), 0) as impressions,
         count(*) as days,
         max(date) filter (where impressions > 0) as last_day
  from public.gsc_daily, bounds b
  where date >= b.m_from and date < b.m_to_d
),
days as (
  select generate_series(b.m_from, b.m_to_d - 1, interval '1 day')::date as day
  from bounds b
),
o_daily as (
  select (order_date at time zone 'Africa/Cairo')::date as day,
         count(*) filter (where order_status <> 'Cancelled') as orders,
         coalesce(sum(total_order_amount) filter (where order_status <> 'Cancelled'), 0) as revenue
  from o group by 1
),
daily as (
  select d.day,
         coalesce(od.orders, 0) as orders,
         coalesce(od.revenue, 0) as revenue,
         g.purchases as ga4_purchases,
         g.revenue as ga4_revenue,
         g.sessions as sessions
  from days d
  left join o_daily od on od.day = d.day
  left join public.ga4_daily g on g.date = d.day
),
weekly as (
  select least((extract(day from d.day)::int - 1) / 7 + 1, 5) as week_no,
         min(d.day) as wk_from, max(d.day) as wk_to,
         sum(d.orders) as orders,
         sum(d.revenue) as revenue,
         sum(d.ga4_purchases) as ga4_purchases,
         sum(d.ga4_revenue) as ga4_revenue,
         count(*) filter (where d.sessions is null) as unsynced_days
  from daily d group by 1
),
meta_weekly as (
  select least((extract(day from a.period_start)::int - 1) / 7 + 1, 5) as week_no,
         coalesce(sum(a.spend), 0) as spend,
         coalesce(sum(a.purchases), 0) as purchases,
         coalesce(sum(a.conversion_value), 0) as value
  from meta_ads a, bounds b
  where a.period_start >= b.m_from and a.period_end < b.m_to_d
    and (a.period_end - a.period_start) <= 8
    and least((extract(day from a.period_start)::int - 1) / 7 + 1, 5)
      = least((extract(day from a.period_end)::int - 1) / 7 + 1, 5)
  group by 1
),
fresh as (
  select
    (select max(order_date) from public.orders) as orders_last_date,
    (select max(imported_at) from public.orders) as orders_last_import,
    (select max(date) from public.ga4_daily
      where date < (now() at time zone 'Africa/Cairo')::date and sessions > 0) as ga4_last_day,
    (select max(imported_at) from public.ga4_daily) as ga4_last_sync,
    (select max(period_end) from public.ad_insights) as meta_last_period,
    (select max(imported_at) from public.ad_imports) as meta_last_import,
    (select max(date) from public.gsc_daily where impressions > 0) as gsc_last_day,
    (select max(imported_at) from public.gsc_daily) as gsc_last_sync
)
select jsonb_build_object(
  'month', (select m_from from bounds),
  'orders', jsonb_build_object(
    'total', (select count(*) from o),
    'revenue', (select round(coalesce(sum(total_order_amount), 0)) from o),
    'net_revenue', (select round(coalesce(sum(total_order_amount), 0)) from o
                    where order_status not in ('Cancelled', 'Returned', 'Return Request', 'Return Sent To Erp', 'Delivery Failed')),
    'by_status', (select coalesce(jsonb_agg(jsonb_build_object(
                    'status', order_status, 'n', n, 'revenue', round(revenue))
                    order by n desc), '[]'::jsonb) from o_status)
  ),
  'ga4', (select jsonb_build_object(
    'tx', (select count(*) from tx),
    'revenue', (select round(coalesce(sum(revenue), 0)) from tx),
    'sessions', sessions, 'purchases', purchases, 'days', days, 'last_day', last_day
  ) from g4),
  'meta', (select jsonb_build_object(
    'ads', ads, 'campaigns', campaigns, 'spend', round(spend),
    'purchases', purchases, 'value', round(value), 'clicks', clicks,
    'atc', atc, 'checkouts', checkouts
  ) from meta),
  'gsc', (select jsonb_build_object(
    'clicks', clicks, 'impressions', impressions, 'days', days, 'last_day', last_day
  ) from gsc),
  'freshness', (select to_jsonb(fresh) from fresh),
  'tracking', public.fn_tracking_summary(p_month),
  'by_channel', (select coalesce(jsonb_agg(jsonb_build_object(
      'channel', channel, 'orders', orders, 'revenue', round(revenue),
      'tracked', tracked, 'untracked_revenue', round(untracked_revenue))
      order by orders desc), '[]'::jsonb) from chan),
  'attribution', (select coalesce(jsonb_agg(jsonb_build_object(
      'bucket', bucket, 'tx', tx, 'revenue', round(revenue))
      order by revenue desc), '[]'::jsonb) from buckets),
  'fragmentation', (select coalesce(jsonb_agg(jsonb_build_object(
      'source', source, 'medium', medium, 'bucket', bucket, 'tagged', tagged,
      'tx', tx, 'revenue', round(revenue))
      order by revenue desc), '[]'::jsonb) from frag),
  'funnel', jsonb_build_object(
    'meta_clicks', (select clicks from meta),
    'ga4_meta_sessions', (select sessions from g4_meta_sessions),
    'ga4_meta_tx', (select coalesce(sum(tx), 0) from buckets where bucket = 'meta'),
    'ga4_meta_revenue', (select round(coalesce(sum(revenue), 0)) from buckets where bucket = 'meta'),
    'meta_claimed_purchases', (select purchases from meta),
    'meta_claimed_value', (select round(value) from meta)
  ),
  'organic', jsonb_build_object(
    'gsc_clicks', (select clicks from gsc),
    'ga4_sessions', (select sessions from g4_organic_sessions),
    'ga4_tx', (select coalesce(sum(tx), 0) from buckets where bucket = 'google_organic'),
    'ga4_revenue', (select round(coalesce(sum(revenue), 0)) from buckets where bucket = 'google_organic')
  ),
  'mapping', jsonb_build_object(
    'ads', (select count(*) from mapped),
    'mapped', (select count(*) from mapped where book_label is not null),
    'unmapped', (select count(*) from mapped where book_label is null),
    'spend', (select round(coalesce(sum(spend), 0)) from mapped),
    'unmapped_spend', (select round(coalesce(sum(spend), 0)) from mapped where book_label is null),
    'unmapped_top', (select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) from unmapped_top u)
  ),
  'daily', (select coalesce(jsonb_agg(jsonb_build_object(
      'day', d.day, 'orders', d.orders, 'revenue', round(d.revenue),
      'ga4_purchases', d.ga4_purchases, 'ga4_revenue', round(d.ga4_revenue),
      'sessions', d.sessions)
      order by d.day), '[]'::jsonb) from daily d),
  'weekly', (select coalesce(jsonb_agg(jsonb_build_object(
      'week_no', w.week_no, 'from', w.wk_from, 'to', w.wk_to,
      'orders', w.orders, 'revenue', round(w.revenue),
      'ga4_purchases', w.ga4_purchases, 'ga4_revenue', round(w.ga4_revenue),
      'unsynced_days', w.unsynced_days,
      'meta_spend', round(mw.spend), 'meta_purchases', mw.purchases, 'meta_value', round(mw.value))
      order by w.week_no), '[]'::jsonb)
    from weekly w left join meta_weekly mw on mw.week_no = w.week_no)
)
where (select public.my_role()) in ('admin', 'manager', 'viewer');
$function$;
