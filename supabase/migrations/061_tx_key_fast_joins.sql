-- ============================================================
-- Migration 061: fast GA4 <-> orders matching
-- The channel/campaign functions joined ga4_transactions to orders
-- through regexp_replace(order_number) computed at query time. Under
-- RLS the planner chose a nested loop, re-running the regex millions
-- of times (21s -> PostgREST's 8s timeout, so Channels & ROI showed
-- "no data"). orders.tx_key stores the normalized id once, indexed.
-- Run after 060.
-- ============================================================

alter table public.orders
  add column if not exists tx_key text
  generated always as (nullif(ltrim(regexp_replace(order_number, '\D', '', 'g'), '0'), '')) stored;

create index if not exists idx_orders_tx_key on public.orders (tx_key);
create index if not exists idx_orders_date on public.orders (order_date);

create or replace function public.fn_channel_summary(p_from date, p_to date)
returns json
language sql stable set search_path = public
as $$
  with tx as (
    select t.source, t.medium, t.campaign, o.order_status, o.total_order_amount
    from public.ga4_transactions t
    join public.orders o on o.tx_key = t.transaction_id
    where o.order_date >= p_from and o.order_date < p_to + 1
      and t.source is not null
  ),
  src as (
    select source, medium,
           sum(sessions) as sessions, sum(active_users) as users,
           sum(add_to_carts) as add_to_carts,
           sum(purchases) as ga4_purchases, sum(revenue) as ga4_revenue
    from public.ga4_sources
    where date between p_from and p_to
    group by 1, 2
  ),
  src_orders as (
    select source, medium,
           count(*) as orders,
           count(*) filter (where order_status = 'Delivered') as delivered,
           count(*) filter (where order_status = 'Cancelled') as cancelled,
           coalesce(sum(total_order_amount) filter (where order_status <> 'Cancelled'), 0) as order_revenue
    from tx group by 1, 2
  ),
  camp as (
    select campaign,
           sum(sessions) as sessions,
           sum(purchases) as ga4_purchases, sum(revenue) as ga4_revenue
    from public.ga4_sources
    where date between p_from and p_to
      and campaign not in ('', '(not set)', '(direct)', '(organic)', '(referral)')
    group by 1
  ),
  camp_orders as (
    select campaign,
           count(*) as orders,
           count(*) filter (where order_status = 'Delivered') as delivered,
           count(*) filter (where order_status = 'Cancelled') as cancelled,
           coalesce(sum(total_order_amount) filter (where order_status <> 'Cancelled'), 0) as order_revenue
    from tx
    where campaign is not null and campaign not in ('', '(not set)')
    group by 1
  ),
  spend as (
    select lower(trim(campaign_name)) as campaign_key,
           sum(amount_spent) as spend,
           sum(reported_purchases) as meta_purchases,
           sum(reported_conversion_value) as meta_revenue
    from public.ad_spend
    where campaign_name is not null
      and report_start <= p_to
      and coalesce(report_end, report_start) >= p_from
    group by 1
  )
  select json_build_object(
    'channels', (
      select coalesce(json_agg(row_to_json(c) order by c.sessions desc), '[]'::json)
      from (
        select s.source, s.medium, s.sessions, s.users, s.add_to_carts,
               s.ga4_purchases, s.ga4_revenue,
               coalesce(so.orders, 0) as orders,
               coalesce(so.delivered, 0) as delivered,
               coalesce(so.cancelled, 0) as cancelled,
               coalesce(so.order_revenue, 0) as order_revenue
        from src s
        left join src_orders so on so.source = s.source and so.medium = s.medium
      ) c
    ),
    'campaigns', (
      select coalesce(json_agg(row_to_json(c) order by c.spend desc nulls last, c.ga4_purchases desc), '[]'::json)
      from (
        select g.campaign, g.sessions, g.ga4_purchases, g.ga4_revenue,
               coalesce(co.orders, 0) as orders,
               coalesce(co.delivered, 0) as delivered,
               coalesce(co.cancelled, 0) as cancelled,
               coalesce(co.order_revenue, 0) as order_revenue,
               sp.spend, sp.meta_purchases, sp.meta_revenue
        from camp g
        left join camp_orders co on co.campaign = g.campaign
        left join spend sp on sp.campaign_key = lower(trim(g.campaign))
      ) c
    )
  );
$$;

create or replace function public.fn_campaign_orders(p_campaign text, p_from date, p_to date, p_limit integer default 200)
returns table (order_number text, order_date timestamptz, order_status text, total_order_amount numeric, city text, source text, medium text)
language sql stable set search_path = public
as $$
  select o.order_number, o.order_date, o.order_status, o.total_order_amount, o.city, t.source, t.medium
  from public.ga4_transactions t
  join public.orders o on o.tx_key = t.transaction_id
  where t.campaign = p_campaign
    and o.order_date >= p_from and o.order_date < p_to + 1
  order by o.order_date desc
  limit p_limit;
$$;

create or replace function public.fn_channel_quality(p_from date, p_to date)
returns table (source text, customers bigint, repeat_customers bigint, orders bigint, revenue numeric)
language sql stable set search_path = public
as $$
  with matched as (
    select t.source, o.customer_id, o.total_order_amount, o.order_status
    from public.ga4_transactions t
    join public.orders o on o.tx_key = t.transaction_id
    where o.order_date >= p_from and o.order_date < p_to + 1
      and t.source is not null and o.customer_id is not null
  )
  select m.source,
         count(distinct m.customer_id) as customers,
         count(distinct m.customer_id) filter (where coalesce(c.lifetime_orders, 0) > 1) as repeat_customers,
         count(*) as orders,
         coalesce(sum(m.total_order_amount) filter (where m.order_status <> 'Cancelled'), 0) as revenue
  from matched m
  left join public.customers c on c.customer_id = m.customer_id
  group by 1
  having count(distinct m.customer_id) >= 5
  order by customers desc;
$$;
