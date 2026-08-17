-- ============================================================
-- Migration 108: Traffic page compares complete days only.
--
-- Companion to the app change that stops storing GA4/GSC for "today"
-- (monthRange now ends at yesterday UTC). Every traffic RPC that puts
-- orders next to GA4 sessions/transactions caps the ORDERS side at the
-- same last complete day, so month-to-date conversion, ATC→order, the
-- tracking chart and channel tables never mix a full day of orders with
-- zero GA4. Closed periods are unaffected.
-- ============================================================

create or replace function public.fn_ga4_summary(p_month date)
returns json
language sql
stable
set search_path to 'public'
as $$
  with g as (
    select * from public.ga4_pages where period_month = p_month
  ),
  o as (
    select count(*) as orders, coalesce(sum(total_order_amount),0) as revenue
    from public.orders
    where order_status not in ('Cancelled')
      and (
        p_month = date '2000-01-01'
        or (order_date >= p_month
            and order_date < least((p_month + interval '1 month')::date, current_date))
      )
  )
  select json_build_object(
    'views', (select coalesce(sum(views),0) from g),
    'users', (select coalesce(sum(active_users),0) from g),
    'add_to_carts', (select coalesce(sum(add_to_carts),0) from g),
    'app_revenue', (select coalesce(sum(total_revenue),0) from g),
    'avg_bounce', (select avg(bounce_rate) from g where views > 100),
    'orders', (select orders from o),
    'order_revenue', (select revenue from o),
    'atc_rate', case when (select sum(views) from g) > 0 then (select sum(add_to_carts) from g) / (select sum(views) from g) else 0 end,
    'atc_to_order', case when (select sum(add_to_carts) from g) > 0 then (select orders from o)::numeric / (select sum(add_to_carts) from g) else 0 end
  );
$$;

create or replace function public.fn_tracking_daily(p_from date, p_to date)
returns table(day date, ga4_purchases numeric, ga4_revenue numeric, sessions numeric, orders bigint, order_revenue numeric)
language sql
stable
set search_path to 'public'
as $$
  with b as (select least(p_to, current_date - 1) as p_to),
  days as (
    select generate_series(p_from, b.p_to, interval '1 day')::date as day from b
  ),
  o as (
    select order_date::date as day,
           count(*) as orders,
           coalesce(sum(total_order_amount),0) as revenue
    from public.orders, b
    where order_status not in ('Cancelled')
      and order_date >= p_from and order_date < b.p_to + 1
    group by 1
  )
  select d.day,
         coalesce(g.purchases, 0),
         coalesce(g.revenue, 0),
         coalesce(g.sessions, 0),
         coalesce(o.orders, 0),
         coalesce(o.revenue, 0)
  from days d
  left join public.ga4_daily g on g.date = d.day
  left join o on o.day = d.day
  order by d.day;
$$;

create or replace function public.fn_channel_summary(p_from date, p_to date)
returns json
language sql
stable
set search_path to 'public'
as $$
  with b as (select least(p_to, current_date - 1) as p_to),
  tx as (
    select t.source, t.medium, t.campaign, o.order_status, o.total_order_amount
    from public.ga4_transactions t
    join public.orders o on o.tx_key = t.transaction_id
    cross join b
    where o.order_date >= p_from and o.order_date < b.p_to + 1
      and t.source is not null
  ),
  src as (
    select source, medium,
           sum(sessions) as sessions, sum(active_users) as users,
           sum(add_to_carts) as add_to_carts,
           sum(purchases) as ga4_purchases, sum(revenue) as ga4_revenue
    from public.ga4_sources, b
    where date between p_from and b.p_to
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
    from public.ga4_sources, b
    where date between p_from and b.p_to
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
    from public.ad_spend, b
    where campaign_name is not null
      and report_start <= b.p_to
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

create or replace function public.fn_channel_quality(p_from date, p_to date)
returns table(source text, customers bigint, repeat_customers bigint, orders bigint, revenue numeric)
language sql
stable
set search_path to 'public'
as $$
  with b as (select least(p_to, current_date - 1) as p_to),
  matched as (
    select t.source, o.customer_id, o.total_order_amount, o.order_status
    from public.ga4_transactions t
    join public.orders o on o.tx_key = t.transaction_id
    cross join b
    where o.order_date >= p_from and o.order_date < b.p_to + 1
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

-- today's partial GA4 rows already stored: drop them; the sync will never
-- write a current-day row again
delete from public.ga4_sources where date >= current_date;
delete from public.ga4_daily   where date >= current_date;
