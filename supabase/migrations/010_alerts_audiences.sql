-- ============================================================
-- Migration 010: smart alerts, never-purchased audience, birthdays
-- Run after 009_customers_ga4_recon_user_access.sql
-- ============================================================

create or replace function public.fn_never_purchased(p_limit integer default 25000)
returns table (
  customer_id text, name text, email text, phone text, city text,
  language text, joined_at timestamptz
)
language sql stable
as $$
  select c.customer_id, c.name, c.email, c.phone, c.city, c.language, c.joined_at
  from public.customers c
  where not exists (select 1 from public.orders o where o.customer_id = c.customer_id)
    and coalesce(c.is_active, true)
  order by c.joined_at desc nulls last
  limit p_limit;
$$;

create or replace function public.fn_birthdays(p_month integer default null, p_limit integer default 2000)
returns table (
  customer_id text, name text, phone text, email text, city text,
  birthdate date, birth_day integer, orders bigint, total_spent numeric, last_order timestamptz
)
language sql stable
as $$
  select
    c.customer_id, c.name, c.phone, c.email, c.city,
    c.birthdate,
    extract(day from c.birthdate)::integer as birth_day,
    count(o.order_number) as orders,
    coalesce(sum(o.total_order_amount), 0) as total_spent,
    max(o.order_date) as last_order
  from public.customers c
  left join public.orders o on o.customer_id = c.customer_id and o.order_status not in ('Cancelled')
  where c.birthdate is not null
    and extract(month from c.birthdate) = coalesce(p_month, extract(month from now()))
    and coalesce(c.is_active, true)
  group by c.customer_id, c.name, c.phone, c.email, c.city, c.birthdate
  order by birth_day, total_spent desc
  limit p_limit;
$$;

create or replace function public.fn_alerts()
returns json
language sql stable
as $$
  with latest_tx_month as (
    select max(period_month) as m from public.ga4_transactions
  ),
  tracking as (
    select
      (select m from latest_tx_month) as month,
      (select count(*) from public.orders o, latest_tx_month lm
        where lm.m is not null and o.order_date >= lm.m and o.order_date < lm.m + interval '1 month') as orders,
      (select count(*) from public.orders o, latest_tx_month lm
        where lm.m is not null and o.order_date >= lm.m and o.order_date < lm.m + interval '1 month'
          and exists (select 1 from public.ga4_transactions g where g.transaction_id = o.order_number)) as tracked
  ),
  stockouts as (
    select count(*) as n from (
      select coalesce(nullif(i.sku,''),'x') as sku,
        count(*) filter (where o.order_date >= now() - interval '30 days') as recent,
        count(*) filter (where o.order_date >= now() - interval '120 days' and o.order_date < now() - interval '30 days') as hist
      from public.order_items i
      join public.orders o on o.order_number = i.order_number
      where o.order_status not in ('Cancelled') and o.order_date >= now() - interval '120 days'
      group by 1
    ) s
    where s.recent = 0 and s.hist >= 10
  ),
  cancels as (
    select
      count(*) filter (where order_date >= now() - interval '7 days' and order_status = 'Cancelled') as recent_cancels,
      count(*) filter (where order_date >= now() - interval '7 days') as recent_orders,
      count(*) filter (where order_date >= now() - interval '14 days' and order_date < now() - interval '7 days' and order_status = 'Cancelled') as prior_cancels,
      count(*) filter (where order_date >= now() - interval '14 days' and order_date < now() - interval '7 days') as prior_orders
    from public.orders
  ),
  pace as (
    select t.period_month, t.total_target,
      coalesce((select sum(o.total_order_amount) from public.orders o
        where o.order_status not in ('Cancelled','Returned','Return Sent To Erp')
          and o.order_date >= t.period_month and o.order_date < t.period_month + interval '1 month'), 0) as actual
    from public.targets t
    where t.period_month = date_trunc('month', now())::date
  ),
  bdays as (
    select count(*) as n from public.customers
    where birthdate is not null and extract(month from birthdate) = extract(month from now())
      and coalesce(is_active, true)
  )
  select json_build_object(
    'tracking_month', (select month from tracking),
    'tracking_rate', (select case when orders > 0 then round(tracked::numeric * 100 / orders, 1) else null end from tracking),
    'untracked', (select orders - tracked from tracking),
    'stockouts', (select n from stockouts),
    'cancel_rate_recent', (select case when recent_orders > 0 then round(recent_cancels::numeric * 100 / recent_orders, 1) else 0 end from cancels),
    'cancel_rate_prior', (select case when prior_orders > 0 then round(prior_cancels::numeric * 100 / prior_orders, 1) else 0 end from cancels),
    'target_total', (select total_target from pace),
    'target_actual', (select actual from pace),
    'target_expected_pct', round(extract(day from now())::numeric * 100 / extract(day from (date_trunc('month', now()) + interval '1 month' - interval '1 day')), 0),
    'birthdays_this_month', (select n from bdays),
    'never_purchased', (select count(*) from public.customers c
      where not exists (select 1 from public.orders o where o.customer_id = c.customer_id)
        and coalesce(c.is_active, true))
  );
$$;
