-- ============================================================
-- 142: Targets page no longer dies at the 8 s statement cap
--
-- fn_targets_overview ran under the caller's RLS: every product_sales /
-- orders row was re-checked against the read policy, which turned a
-- 1.7 s query into 8.6 s for an admin (measured 2026-09-13) and the
-- page showed "No data yet" because the error was ignored.
--
-- Same recipe as migrations 135-136 for the abandoned-cart RPCs:
-- SECURITY DEFINER (bypass RLS) + an explicit reader gate that mirrors
-- the read policy (admin / manager / viewer), plpgsql so the gate runs
-- before the body. The gate is generic this time (fn_assert_reader) so
-- the next page can reuse it. anon / PUBLIC lose EXECUTE (they had it).
--
-- NOTE for future migrations: `create or replace` of this function
-- drops SECURITY DEFINER unless you repeat it, and the page is slow
-- again. Keep `security definer` + the assert call.
-- ============================================================

create or replace function public.fn_assert_reader()
returns void
language plpgsql
stable
set search_path to 'public'
as $function$
begin
  if coalesce(public.my_role(), '') not in ('admin', 'manager', 'viewer') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
end
$function$;

revoke execute on function public.fn_assert_reader() from public, anon;
grant execute on function public.fn_assert_reader() to authenticated;

drop function if exists public.fn_targets_overview();

create function public.fn_targets_overview()
returns table(
  period_month date, quarter text, label text,
  total_target numeric, kids_target numeric, cultural_target numeric, pieces_target numeric,
  ly_revenue numeric, ly_pieces numeric,
  actual_revenue numeric, actual_orders bigint, orders_placed bigint, actual_pieces numeric,
  progress_pct numeric, pieces_pct numeric, aov numeric, conv_rate numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform public.fn_assert_reader();
  return query
  with span as (
    select min(t.period_month) as lo_d,
           (max(t.period_month) + interval '1 month')::date as hi_d
    from public.targets t
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
    select p.m, count(*) as orders_placed from placed p group by 1
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
end
$function$;

revoke execute on function public.fn_targets_overview() from public, anon;
grant execute on function public.fn_targets_overview() to authenticated, service_role;
