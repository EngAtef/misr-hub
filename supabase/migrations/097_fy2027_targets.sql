-- FY26/27 target, and actuals measured on the basis the target was set on.
--
-- The board target of 10,400,754 is SAP net excluding the Al-Adwaa imprint.
-- fn_targets_overview was comparing it against sum(total_order_amount) over
-- non-cancelled orders — app gross, Al-Adwaa included, undelivered included —
-- which for FY25/26 reads 10,440,158 against a real net of 8,410,524. Every
-- month would have looked ~24% ahead of itself.
--
-- The net definition, verified against the plan to the pound for FY25/26:
--   delivered LINE items, category <> 'AL-Adwaa'   7,408,791
--   + actual delivery fees of those orders         1,001,733
--   =                                              8,410,524   (SAP: 8,443,077)

create or replace function public.fn_targets_overview()
returns table (
  period_month date, quarter text, label text,
  total_target numeric, kids_target numeric, cultural_target numeric,
  actual_revenue numeric, actual_orders bigint,
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
  -- one row per order that carries revenue on the plan basis
  ord as (
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
  monthly as (
    select o.m,
           sum(o.goods) + sum(coalesce(x.actual_delivery_fees, 0)) as rev,
           count(*) as orders
    from ord o
    left join public.orders x on x.order_number = o.order_id
    group by 1
  )
  select
    t.period_month, t.quarter, t.label,
    t.total_target, t.kids_target, t.cultural_target,
    coalesce(mo.rev, 0) as actual_revenue,
    coalesce(mo.orders, 0) as actual_orders,
    case when t.total_target > 0
         then round(coalesce(mo.rev, 0) * 100 / t.total_target, 1)
         else 0 end as progress_pct,
    t.aov, t.conv_rate
  from public.targets t
  left join monthly mo on mo.m = t.period_month
  order by t.period_month;
$function$;

-- FY26/27: the annual target split flat across the twelve months, by
-- decision — 10,400,754 / 12 = 866,729.50, summing back exactly. The
-- seasonal shape in the plan document is deliberately not used here.
-- July 2026 already held a placeholder of 1,199,999 and is overwritten.
insert into public.targets (period_month, quarter, label, total_target, kids_target, cultural_target)
select
  m::date,
  -- fiscal quarters: the year starts in July
  case
    when extract(month from m)::int between 7 and 9  then 'Q1'
    when extract(month from m)::int between 10 and 12 then 'Q2'
    when extract(month from m)::int between 1 and 3  then 'Q3'
    else 'Q4'
  end,
  'FY26/27',
  866729.50,
  0,
  0
from generate_series('2026-07-01'::date, '2027-06-01'::date, interval '1 month') as m
on conflict (period_month) do update
set total_target    = excluded.total_target,
    quarter         = excluded.quarter,
    label           = excluded.label,
    kids_target     = excluded.kids_target,
    cultural_target = excluded.cultural_target,
    updated_at      = now();
