-- 084: GAPS center — one payload reconciling every data source for a month.
-- Meta (ad_insights), GA4 (ga4_*), Search Console (gsc_*) and the store's own
-- orders each tell a different story about the same money. fn_gaps_report puts
-- the four witnesses side by side so the gap between "claimed" and "real" is a
-- number, not a feeling.

create or replace function public.fn_gaps_report(p_month date)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with bounds as (
  select date_trunc('month', p_month)::date as m_from,
         (date_trunc('month', p_month) + interval '1 month')::date as m_to
),
-- ------------------------------------------------------------ store truth
o as (
  select o.* from public.orders o, bounds b
  where o.order_date >= b.m_from and o.order_date < b.m_to
),
o_status as (
  select order_status, count(*) as n, coalesce(sum(total_order_amount), 0) as revenue
  from o group by 1
),
-- --------------------------------------------------------------- channels
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
-- -------------------------------------------------------- ga4 attribution
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
),
buckets as (
  select bucket, count(*) as tx, coalesce(sum(revenue), 0) as revenue
  from tx group by 1
),
frag as (
  select coalesce(source, '(not set)') as source,
         coalesce(medium, '(not set)') as medium,
         bucket,
         -- traffic that arrived carrying a UTM tag vs. bare referral clicks
         (coalesce(medium, '') not in ('referral', '(none)', '(not set)')) as tagged,
         count(*) as tx,
         coalesce(sum(revenue), 0) as revenue
  from tx group by 1, 2, 3, 4
  order by revenue desc
  limit 24
),
-- ------------------------------------------------------------------- meta
meta_ads as (
  select i.* from public.ad_insights i, bounds b
  where i.level = 'ad' and i.period_end >= b.m_from and i.period_start < b.m_to
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
-- how much of the spend is connected to a book/list (the manual step)
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
-- --------------------------------------------------------- ga4 aggregates
g4 as (
  select coalesce(sum(sessions), 0) as sessions,
         coalesce(sum(purchases), 0) as purchases,
         coalesce(sum(revenue), 0) as revenue,
         count(*) as days,
         max(date) filter (where sessions > 0) as last_day
  from public.ga4_daily, bounds b
  where date >= b.m_from and date < b.m_to
),
g4_meta_sessions as (
  select coalesce(sum(sessions), 0) as sessions
  from public.ga4_sources, bounds b
  where date >= b.m_from and date < b.m_to
    and (source ~* 'facebook|instagram|meta' or source ~* '^(fb|ig|adv)$'
         or medium ~* '^(paid|adv|static|post|parent)')
),
g4_organic_sessions as (
  select coalesce(sum(sessions), 0) as sessions
  from public.ga4_sources, bounds b
  where date >= b.m_from and date < b.m_to
    and source = 'google' and medium = 'organic'
),
-- ---------------------------------------------------------------- search
gsc as (
  select coalesce(sum(clicks), 0) as clicks,
         coalesce(sum(impressions), 0) as impressions,
         count(*) as days,
         max(date) filter (where impressions > 0) as last_day
  from public.gsc_daily, bounds b
  where date >= b.m_from and date < b.m_to
),
-- -------------------------------------------------------------- freshness
fresh as (
  select
    (select max(order_date) from public.orders) as orders_last_date,
    (select max(imported_at) from public.orders) as orders_last_import,
    (select max(date) from public.ga4_daily) as ga4_last_day,
    (select max(period_end) from public.ad_insights) as meta_last_period,
    (select max(imported_at) from public.ad_imports) as meta_last_import,
    (select max(date) from public.gsc_daily) as gsc_last_day
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
  )
)
where (select public.my_role()) in ('admin', 'manager', 'viewer');
$$;

grant execute on function public.fn_gaps_report(date) to authenticated;

-- the page itself, visible to everyone by default (admins can restrict later)
insert into public.page_permissions (page_key, allow_manager, allow_viewer)
values ('gaps', true, true)
on conflict (page_key) do nothing;
