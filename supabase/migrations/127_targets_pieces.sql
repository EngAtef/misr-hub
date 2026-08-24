-- 127: piece (copies) targets alongside money targets.
-- targets.pieces_target: how many books the month should sell (0 = not set yet).
-- fn_targets_overview: returns pieces_target, actual_pieces (sum of delivered
-- quantities, AL-Adwaa excluded — same net basis as actual_revenue) and pieces_pct.
-- Also moves the page's month bucketing to Cairo local months (was UTC), so
-- /targets now agrees with the /gaps net report month by month (122-126 basis).

alter table public.targets add column if not exists pieces_target numeric not null default 0;

drop function if exists public.fn_targets_overview();

create function public.fn_targets_overview()
returns table(
  period_month date, quarter text, label text,
  total_target numeric, kids_target numeric, cultural_target numeric, pieces_target numeric,
  actual_revenue numeric, actual_orders bigint, orders_placed bigint, actual_pieces numeric,
  progress_pct numeric, pieces_pct numeric,
  aov numeric, conv_rate numeric
)
language sql stable
set search_path to 'public'
as $function$
  with span as (
    select min(period_month) as lo_d,
           (max(period_month) + interval '1 month')::date as hi_d
    from public.targets
  ),
  bounds as (
    select (s.lo_d::timestamp at time zone 'Africa/Cairo') as lo,
           (s.hi_d::timestamp at time zone 'Africa/Cairo') as hi
    from span s
  ),
  delivered as (
    select ps.order_id,
           date_trunc('month', ps.order_date at time zone 'Africa/Cairo')::date as m,
           sum(ps.total_amount) as goods,
           sum(coalesce(ps.quantity, 0)) as pieces
    from public.product_sales ps, bounds s
    where ps.status = 'Delivered'
      and coalesce(ps.category, '') <> 'AL-Adwaa'
      and ps.order_date >= s.lo
      and ps.order_date < s.hi
    group by 1, 2
  ),
  placed as (
    select distinct ps.order_id,
           date_trunc('month', ps.order_date at time zone 'Africa/Cairo')::date as m
    from public.product_sales ps, bounds s
    where coalesce(ps.category, '') <> 'AL-Adwaa'
      and ps.order_date >= s.lo
      and ps.order_date < s.hi
  ),
  monthly as (
    select d.m,
           sum(d.goods) + sum(coalesce(x.actual_delivery_fees, 0)) as rev,
           count(*) as orders,
           sum(d.pieces) as pieces
    from delivered d
    left join public.orders x on x.order_number = d.order_id
    group by 1
  ),
  placed_monthly as (
    select m, count(*) as orders_placed from placed group by 1
  )
  select
    t.period_month, t.quarter, t.label,
    t.total_target, t.kids_target, t.cultural_target, t.pieces_target,
    coalesce(mo.rev, 0) as actual_revenue,
    coalesce(mo.orders, 0) as actual_orders,
    coalesce(pm.orders_placed, 0) as orders_placed,
    coalesce(mo.pieces, 0) as actual_pieces,
    case when t.total_target > 0
         then round(coalesce(mo.rev, 0) * 100 / t.total_target, 1)
         else 0 end as progress_pct,
    case when t.pieces_target > 0
         then round(coalesce(mo.pieces, 0) * 100 / t.pieces_target, 1)
         else 0 end as pieces_pct,
    t.aov, t.conv_rate
  from public.targets t
  left join monthly mo on mo.m = t.period_month
  left join placed_monthly pm on pm.m = t.period_month
  order by t.period_month;
$function$;
