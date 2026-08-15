-- Two order counts sit behind the plan and they are not interchangeable.
--
--   orders_placed    orders carrying at least one non-Al-Adwaa line, ANY
--                    status. This is the plan's denominator: conversion is
--                    placed ÷ sessions (15,016 ÷ 688,168 = 2.182% for
--                    FY25/26), and its "AOV" of 560.10 is net ÷ placed —
--                    really net revenue per order placed.
--   actual_orders    the delivered subset (13,607). Pairs with the revenue
--                    on this page, giving the merchandising AOV of 618.10.
--
-- Showing only one of them invites the other to be quoted against it, so
-- the page now carries both. Revenue is unchanged: delivered lines
-- excluding Al-Adwaa, plus the delivery fees of the orders holding them —
-- a mixed invoice keeps its bookstore items and its full fee, and only
-- an Al-Adwaa-only order drops out entirely.
--
-- The return type gains a column, so the function has to be dropped first.

drop function if exists public.fn_targets_overview();

create function public.fn_targets_overview()
returns table (
  period_month date, quarter text, label text,
  total_target numeric, kids_target numeric, cultural_target numeric,
  actual_revenue numeric, actual_orders bigint, orders_placed bigint,
  progress_pct numeric, aov numeric, conv_rate numeric
)
language sql
stable
set search_path to 'public'
as $function$
  with span as (
    select min(period_month) as lo,
           (max(period_month) + interval '1 month')::timestamptz as hi
    from public.targets
  ),
  delivered as (
    select ps.order_id,
           date_trunc('month', ps.order_date)::date as m,
           sum(ps.total_amount) as goods
    from public.product_sales ps, span s
    where ps.status = 'Delivered'
      and coalesce(ps.category, '') <> 'AL-Adwaa'
      and ps.order_date >= s.lo
      and ps.order_date < s.hi
    group by 1, 2
  ),
  placed as (
    select distinct ps.order_id,
           date_trunc('month', ps.order_date)::date as m
    from public.product_sales ps, span s
    where coalesce(ps.category, '') <> 'AL-Adwaa'
      and ps.order_date >= s.lo
      and ps.order_date < s.hi
  ),
  monthly as (
    select d.m,
           sum(d.goods) + sum(coalesce(x.actual_delivery_fees, 0)) as rev,
           count(*) as orders
    from delivered d
    left join public.orders x on x.order_number = d.order_id
    group by 1
  ),
  placed_monthly as (
    select m, count(*) as orders_placed from placed group by 1
  )
  select
    t.period_month, t.quarter, t.label,
    t.total_target, t.kids_target, t.cultural_target,
    coalesce(mo.rev, 0) as actual_revenue,
    coalesce(mo.orders, 0) as actual_orders,
    coalesce(pm.orders_placed, 0) as orders_placed,
    case when t.total_target > 0
         then round(coalesce(mo.rev, 0) * 100 / t.total_target, 1)
         else 0 end as progress_pct,
    t.aov, t.conv_rate
  from public.targets t
  left join monthly mo on mo.m = t.period_month
  left join placed_monthly pm on pm.m = t.period_month
  order by t.period_month;
$function$;
