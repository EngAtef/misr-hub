-- 131_global_target.sql — the Egypt target stays Egypt-only, and the global
-- storefront gets its own target on a separate Targets tab.
--
-- fn_targets_overview previously counted every delivered line, so the new
-- foreign orders (USD, EGP-converted) would have leaked into the Egypt
-- monthly targets. Actuals are now filtered to market = 'EG'.
--
-- The global target is one figure for the fiscal year (seeded at 2,600,000
-- EGP for FY26/27), stored in app_settings under 'global_target' and served
-- by fn_target_global(): foreign orders only, converted to EGP at the
-- current FX setting, with per-market and per-month breakdowns.

-- 1 · Egypt targets: exclude foreign orders from actuals
create or replace function public.fn_targets_overview()
returns table(
  period_month date, quarter text, label text,
  total_target numeric, kids_target numeric, cultural_target numeric,
  pieces_target numeric, ly_revenue numeric, ly_pieces numeric,
  actual_revenue numeric, actual_orders bigint, orders_placed bigint,
  actual_pieces numeric, progress_pct numeric, pieces_pct numeric,
  aov numeric, conv_rate numeric)
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
    from public.product_sales ps
    left join public.orders eo on eo.order_number = ps.order_id
    cross join bounds s
    where ps.status = 'Delivered'
      and coalesce(ps.category, '') <> 'AL-Adwaa'
      and coalesce(eo.market, 'EG') = 'EG'
      and ps.order_date >= s.lo
      and ps.order_date < s.hi
    group by 1, 2
  ),
  placed as (
    select distinct ps.order_id,
           date_trunc('month', ps.order_date at time zone 'Africa/Cairo')::date as m
    from public.product_sales ps
    left join public.orders eo on eo.order_number = ps.order_id
    cross join bounds s
    where coalesce(ps.category, '') <> 'AL-Adwaa'
      and coalesce(eo.market, 'EG') = 'EG'
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
    t.ly_revenue, t.ly_pieces,
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

-- 2 · Global target: seed FY26/27 at 2.6M EGP (only if not set yet)
insert into public.app_settings (key, value)
values ('global_target', jsonb_build_object(
  'target_egp', 2600000,
  'start_date', '2026-07-01',
  'end_date', '2027-06-30',
  'label', 'FY26/27'
))
on conflict (key) do nothing;

-- security definer so non-admin roles with Targets access can read it
-- (app_settings RLS is admin-only)
create or replace function public.fn_target_global()
returns jsonb
language sql stable security definer
set search_path to 'public'
as $function$
  with cfg as (
    select
      coalesce((value->>'target_egp')::numeric, 0) as target_egp,
      coalesce((value->>'start_date')::date, '2026-07-01') as start_date,
      coalesce((value->>'end_date')::date, '2027-06-30') as end_date,
      coalesce(value->>'label', 'FY26/27') as label
    from (select coalesce((select value from public.app_settings where key = 'global_target'), '{}'::jsonb) as value) s
  ),
  fx as (
    select case coalesce(r->>'global_currency', 'USD')
      when 'SAR' then coalesce((r->>'sar_egp')::numeric, 12.95)
      when 'EGP' then 1
      else coalesce((r->>'usd_egp')::numeric, 48.5) end as g
    from (select public.fn_fx_rates() as r) x
  ),
  scoped as (
    select o.order_number, o.market,
           date_trunc('month', o.order_date at time zone 'Africa/Cairo')::date as m,
           coalesce(o.total_order_amount, 0) * fx.g as rev_egp,
           (o.order_status = 'Delivered' or o.delivery_status = 'Delivered') as is_delivered,
           (o.order_status in ('Cancelled')) as is_cancelled
    from public.orders o
    cross join fx, cfg
    where coalesce(o.market, 'EG') <> 'EG'
      and (o.order_date at time zone 'Africa/Cairo')::date >= cfg.start_date
      and (o.order_date at time zone 'Africa/Cairo')::date <= cfg.end_date
  ),
  agg as (
    select
      count(*) filter (where not is_cancelled) as orders_placed,
      count(*) filter (where is_delivered) as orders_delivered,
      count(*) filter (where is_cancelled) as orders_cancelled,
      coalesce(sum(rev_egp) filter (where not is_cancelled), 0) as placed_rev,
      coalesce(sum(rev_egp) filter (where is_delivered), 0) as delivered_rev
    from scoped
  ),
  by_market as (
    select coalesce(jsonb_agg(x order by (x->>'revenue_egp')::numeric desc), '[]'::jsonb) as j
    from (
      select jsonb_build_object(
        'market', market,
        'orders', count(*) filter (where not is_cancelled),
        'revenue_egp', round(coalesce(sum(rev_egp) filter (where not is_cancelled), 0), 2)
      ) as x
      from scoped group by market
    ) q
  ),
  by_month as (
    select coalesce(jsonb_agg(x order by (x->>'month')), '[]'::jsonb) as j
    from (
      select jsonb_build_object(
        'month', m,
        'orders', count(*) filter (where not is_cancelled),
        'placed_rev', round(coalesce(sum(rev_egp) filter (where not is_cancelled), 0), 2),
        'delivered_rev', round(coalesce(sum(rev_egp) filter (where is_delivered), 0), 2)
      ) as x
      from scoped group by m
    ) q
  )
  select jsonb_build_object(
    'target_egp', c.target_egp,
    'start_date', c.start_date,
    'end_date', c.end_date,
    'label', c.label,
    'orders_placed', a.orders_placed,
    'orders_delivered', a.orders_delivered,
    'orders_cancelled', a.orders_cancelled,
    'placed_rev', round(a.placed_rev, 2),
    'delivered_rev', round(a.delivered_rev, 2),
    'placed_pct', case when c.target_egp > 0 then round(a.placed_rev * 100 / c.target_egp, 2) else 0 end,
    'delivered_pct', case when c.target_egp > 0 then round(a.delivered_rev * 100 / c.target_egp, 2) else 0 end,
    'by_market', bm.j,
    'by_month', bmo.j,
    'fx', (select public.fn_fx_rates())
  )
  from cfg c, agg a, by_market bm, by_month bmo
$function$;
revoke execute on function public.fn_target_global() from anon, public;
grant execute on function public.fn_target_global() to authenticated;

create or replace function public.fn_set_global_target(
  p_target numeric,
  p_start date default null,
  p_end date default null,
  p_label text default null)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if public.my_role() not in ('admin', 'manager') then
    raise exception 'Forbidden';
  end if;
  insert into public.app_settings (key, value)
  values ('global_target', jsonb_build_object(
    'target_egp', p_target,
    'start_date', coalesce(p_start, '2026-07-01'::date),
    'end_date', coalesce(p_end, '2027-06-30'::date),
    'label', coalesce(p_label, 'FY26/27')
  ))
  on conflict (key) do update set value = jsonb_build_object(
    'target_egp', p_target,
    'start_date', coalesce(p_start, (app_settings.value->>'start_date')::date, '2026-07-01'::date),
    'end_date', coalesce(p_end, (app_settings.value->>'end_date')::date, '2027-06-30'::date),
    'label', coalesce(p_label, app_settings.value->>'label', 'FY26/27')
  );
end $$;
revoke execute on function public.fn_set_global_target(numeric, date, date, text) from anon, public;
grant execute on function public.fn_set_global_target(numeric, date, date, text) to authenticated;
