-- 087: the monthly source & revenue report as one payload — the table that was
-- assembled by hand for July 2026, reproducible for any month. Definitions are
-- fixed here so every export reconciles: revenue = products value only
-- (total_cart_amount, delivery excluded), cancelled orders counted but their
-- revenue removed, attribution = GA4 last-click matched to real orders,
-- spend summed at ad level only.

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
         coalesce(sum(o.total_cart_amount) filter (where o.order_status <> 'Cancelled'), 0) as revenue
  from o left join tx t on t.transaction_id = o.order_number
  group by 1
),
merged as (
  select coalesce(s.bucket, r.bucket) as bucket,
         s.sessions, coalesce(r.orders, 0) as orders,
         coalesce(r.cancelled, 0) as cancelled, coalesce(r.revenue, 0) as revenue
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
totals as (
  select
    (select coalesce(sum(sessions), 0) from sess) as sessions,
    (select count(*) from o) as orders,
    (select count(*) from o where order_status = 'Cancelled') as cancelled,
    (select round(coalesce(sum(total_cart_amount), 0)) from o where order_status <> 'Cancelled') as revenue,
    (select round(coalesce(sum(total_order_amount - coalesce(total_cart_amount, 0)), 0)) from o) as delivery_fees,
    (select round(coalesce(sum(spend), 0)) from spend) as spend
)
select jsonb_build_object(
  'month', (select m_from from bounds),
  'totals', (select jsonb_build_object(
    'sessions', sessions, 'orders', orders, 'cancelled', cancelled,
    'revenue', revenue, 'delivery_fees', delivery_fees, 'spend', spend,
    'cr', round(100.0 * orders / nullif(sessions, 0), 2),
    'aov', round(revenue / nullif(orders - cancelled, 0)),
    'spend_pct_of_revenue', round(100.0 * spend / nullif(revenue, 0), 1)
  ) from totals),
  'spend_by_account', (select coalesce(jsonb_agg(jsonb_build_object(
      'account', account_label, 'spend', round(spend)) order by spend desc), '[]'::jsonb) from spend),
  'rows', (select coalesce(jsonb_agg(jsonb_build_object(
      'bucket', bucket, 'sessions', sessions, 'orders', orders, 'cancelled', cancelled,
      'revenue', round(revenue),
      'cr', round(100.0 * orders / nullif(sessions, 0), 2),
      'aov', round(revenue / nullif(orders - cancelled, 0)))
      order by revenue desc), '[]'::jsonb) from merged),
  'campaigns', jsonb_build_object(
    'orders_with_campaign', (select count(*) from named),
    'pct_of_orders', (select round(100.0 * (select count(*) from named) / nullif(count(*), 0), 1) from o),
    'campaign_revenue', (select round(coalesce(sum(o.total_cart_amount), 0)) from o
                         join named n on n.transaction_id = o.order_number
                         where o.order_status <> 'Cancelled'),
    'combos_on_purchases', (select count(distinct combo) from tx),
    'combos_all_traffic', (select count(distinct source || '/' || coalesce(medium, ''))
                           from public.ga4_sources, bounds b
                           where date >= b.m_from and date < b.m_to)
  )
)
where (select public.my_role()) in ('admin', 'manager', 'viewer');
$$;

grant execute on function public.fn_gaps_source_report(date) to authenticated;
