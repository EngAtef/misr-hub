-- 088: two business rules the reports must understand.
--
-- 1. The Meta ad accounts (Kids, Cultural, Disney, bookstore) are ONE spend
--    pool for the bookstore overall — account names do not map to product
--    categories, so nothing may read account-level spend as category spend.
-- 2. AL-Adwaa (vendor/section = 'AL-Adwaa') is not advertised. Its revenue is
--    excluded from every ads-facing number (revenue, AOV, MER, spend share),
--    but customers arriving from ads do buy AL-Adwaa books — that spillover
--    is reported as information, never as ad performance.
--
-- fn_gaps_source_report: revenue becomes bookstore products value (ex-Adwaa,
-- delivery excluded, cancelled removed); an `adwaa` block carries the info.
-- This also makes the hand-made July draft reconcile: its 1,261,647 was
-- exactly items minus AL-Adwaa.

create or replace function public.fn_gaps_source_report(p_month date)
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
o as (
  select o.* from public.orders o, bounds b
  where o.order_date >= b.m_from and o.order_date < b.m_to
),
adwaa as (
  select sku from public.products where vendor = 'AL-Adwaa' or section = 'AL-Adwaa'
),
-- per-order split: bookstore value vs AL-Adwaa value
ov as (
  select o.order_number, o.order_status,
         coalesce(sum(oi.price) filter (where a.sku is null), 0) as book_val,
         coalesce(sum(oi.price) filter (where a.sku is not null), 0) as adwaa_val
  from o
  join public.order_items oi on oi.order_number = o.order_number
  left join adwaa a on a.sku = oi.sku
  group by 1, 2
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
  where date >= b.m_from and date < b.m_to
  group by 1
),
rows_ as (
  select coalesce(t.bucket, 'untracked') as bucket,
         count(*) as orders,
         count(*) filter (where o.order_status = 'Cancelled') as cancelled,
         coalesce(sum(v.book_val) filter (where o.order_status <> 'Cancelled'), 0) as revenue,
         coalesce(sum(v.adwaa_val) filter (where o.order_status <> 'Cancelled'), 0) as adwaa_revenue
  from o
  left join tx t on t.transaction_id = o.order_number
  left join ov v on v.order_number = o.order_number
  group by 1
),
merged as (
  select coalesce(s.bucket, r.bucket) as bucket,
         s.sessions, coalesce(r.orders, 0) as orders,
         coalesce(r.cancelled, 0) as cancelled,
         coalesce(r.revenue, 0) as revenue,
         coalesce(r.adwaa_revenue, 0) as adwaa_revenue
  from sess s full outer join rows_ r on r.bucket = s.bucket
),
spend as (
  select account_label, coalesce(sum(spend), 0) as spend
  from public.ad_insights i, bounds b
  where i.level = 'ad' and i.period_end >= b.m_from and i.period_start < b.m_to
  group by 1
),
named as (
  select t.transaction_id from tx t
  where t.campaign is not null
    and t.campaign not in ('(not set)', '(referral)', '(organic)', '(direct)', '(none)')
),
adwaa_info as (
  select
    coalesce(sum(v.adwaa_val) filter (where v.order_status <> 'Cancelled'), 0) as revenue,
    count(*) filter (where v.adwaa_val > 0 and v.order_status <> 'Cancelled') as orders,
    count(*) filter (where v.adwaa_val > 0 and v.book_val = 0 and v.order_status <> 'Cancelled') as adwaa_only_orders,
    coalesce(sum(v.adwaa_val) filter (where v.order_status <> 'Cancelled'
      and t.bucket in ('meta_tagged', 'meta_untagged')), 0) as from_ads_revenue,
    count(*) filter (where v.adwaa_val > 0 and v.order_status <> 'Cancelled'
      and t.bucket in ('meta_tagged', 'meta_untagged')) as from_ads_orders
  from ov v
  left join tx t on t.transaction_id = v.order_number
),
totals as (
  select
    (select coalesce(sum(sessions), 0) from sess) as sessions,
    (select count(*) from o) as orders,
    (select count(*) from o where order_status = 'Cancelled') as cancelled,
    (select round(coalesce(sum(book_val), 0)) from ov where order_status <> 'Cancelled') as revenue,
    (select round(coalesce(sum(book_val + adwaa_val), 0)) from ov where order_status <> 'Cancelled') as revenue_incl_adwaa,
    (select round(coalesce(sum(total_order_amount - coalesce(total_cart_amount, 0)), 0)) from o) as delivery_fees,
    (select round(coalesce(sum(spend), 0)) from spend) as spend
)
select jsonb_build_object(
  'month', (select m_from from bounds),
  'totals', (select jsonb_build_object(
    'sessions', sessions, 'orders', orders, 'cancelled', cancelled,
    'revenue', revenue, 'revenue_incl_adwaa', revenue_incl_adwaa,
    'delivery_fees', delivery_fees, 'spend', spend,
    'cr', round(100.0 * orders / nullif(sessions, 0), 2),
    'aov', round(revenue / nullif(orders - cancelled, 0)),
    'spend_pct_of_revenue', round(100.0 * spend / nullif(revenue, 0), 1)
  ) from totals),
  'spend_by_account', (select coalesce(jsonb_agg(jsonb_build_object(
      'account', account_label, 'spend', round(spend)) order by spend desc), '[]'::jsonb) from spend),
  'rows', (select coalesce(jsonb_agg(jsonb_build_object(
      'bucket', bucket, 'sessions', sessions, 'orders', orders, 'cancelled', cancelled,
      'revenue', round(revenue), 'adwaa_revenue', round(adwaa_revenue),
      'cr', round(100.0 * orders / nullif(sessions, 0), 2),
      'aov', round(revenue / nullif(orders - cancelled, 0)))
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
                         where v.order_status <> 'Cancelled'),
    'combos_on_purchases', (select count(distinct combo) from tx),
    'combos_all_traffic', (select count(distinct source || '/' || coalesce(medium, ''))
                           from public.ga4_sources, bounds b
                           where date >= b.m_from and date < b.m_to)
  )
)
where (select public.my_role()) in ('admin', 'manager', 'viewer');
$$;
