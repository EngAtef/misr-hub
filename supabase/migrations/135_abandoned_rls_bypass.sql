-- ============================================================
-- Migration 135: /abandoned RPCs run as SECURITY DEFINER.
--
-- Symptom (2026-09-03): the Abandoned Carts page rendered "No
-- abandoned-cart data yet" with a "canceling statement due to
-- statement timeout" banner; fn_abandoned_top_products and
-- fn_abandoned_link returned 500. Nothing was missing: 60k carts and
-- 202k items are loaded.
--
-- Cause: every read RPC on the page runs under the caller's RLS. With
-- an RLS policy on the table the planner (a) cannot use the created_at
-- index for the `timestamp >= date` range because that operator is
-- not leakproof, and (b) estimates the policy predicate as a 1-row
-- filter, so it picks seq scans + nested loops. The same function
-- body measured 15x slower as `authenticated` than as the owner:
--   fn_abandoned_top_products (Sep 1-3)   3.7 s  vs 0.25 s
--   fn_abandoned_segments      (Sep 1-3)   2.7 s  vs 0.05 s
--   fn_abandoned_carts_list    (Sep 1-3)   2.5 s  vs 1.1 s
--   fn_abandoned_top_products (all time)  78 s   vs 7.8 s
-- Seven of these fire in parallel on load, so the 8 s cap always won.
--
-- Fix: the page's read RPCs become SECURITY DEFINER (bypass RLS, same
-- as the other gated RPCs in this schema) with an explicit role gate
-- (fn_abandoned_assert_reader) that mirrors the RLS read policy
-- exactly (admin / manager / viewer). fn_abandoned_link already had
-- an admin/manager gate and only gains SECURITY DEFINER.
-- fn_abandoned_top_products is also rewritten: item rows are unique
-- per (cart, sku) (item_key = md5 of cart|created|sku), so count(*)
-- replaces count(distinct text), and the excluded / market cart sets
-- are collected once instead of probed per item.
--
-- NOTE for future migrations: `create or replace` on any of these
-- functions drops SECURITY DEFINER unless you repeat it, and then the
-- page is slow again. Keep `security definer` + the assert call.
-- Run after 134.
-- ============================================================

create or replace function public.fn_abandoned_assert_reader()
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

revoke execute on function public.fn_abandoned_assert_reader() from public, anon;
grant execute on function public.fn_abandoned_assert_reader() to authenticated;

-- ---------------------------------------------------------------
-- Top abandoned products: rewritten (see header).
-- ---------------------------------------------------------------
create or replace function public.fn_abandoned_top_products(
  p_from date default null, p_to date default null, p_limit integer default 30, p_markets text[] default null)
returns table(sku text, product_name text, carts bigint, total_qty numeric, ecom_stock integer, in_catalog boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.fn_abandoned_assert_reader();
  with excluded as materialized (
    -- carts whose items must not count: anomalies and closed workflows
    select ac.full_name, ac.created_at
    from public.abandoned_carts ac
    where ac.full_name is not null
      and (ac.is_anomaly or ac.recall_status in ('recovered', 'lost', 'excluded'))
  ),
  wanted as materialized (
    -- carts in the requested markets (empty when no market filter)
    select ac.full_name, ac.created_at
    from public.abandoned_carts ac
    where p_markets is not null and cardinality(p_markets) > 0
      and ac.full_name is not null
      and ac.market = any(p_markets)
  ),
  items as (
    select i.sku, i.product_name, i.qty
    from public.abandoned_cart_items i
    where (p_from is null or i.created_at >= p_from)
      and (p_to is null or i.created_at < p_to + interval '1 day')
      and coalesce(i.qty, 1) < 50
      and not exists (
        select 1 from excluded e
        where e.full_name = i.cart_name
          and i.created_at between e.created_at - interval '1 hour' and e.created_at + interval '1 hour'
      )
      and (p_markets is null or cardinality(p_markets) = 0 or exists (
        select 1 from wanted w
        where w.full_name = i.cart_name
          and i.created_at between w.created_at - interval '1 hour' and w.created_at + interval '1 hour'
      ))
  )
  select
    i.sku,
    max(i.product_name) as product_name,
    count(*) as carts,
    sum(coalesce(i.qty, 1)) as total_qty,
    max(s.ecom_stock) as ecom_stock,
    (max(s.sku) is not null) as in_catalog
  from items i
  left join public.stock_items s on s.sku = i.sku
  group by i.sku
  order by 3 desc
  limit least(coalesce(p_limit, 30), 200)
$function$;

-- ---------------------------------------------------------------
-- The other read RPCs keep their current bodies (last defined in
-- migrations 117-119); they are re-created verbatim from the catalog
-- with the reader gate prepended and SECURITY DEFINER added.
-- ---------------------------------------------------------------
do $mig$
declare
  f record;
  src text;
begin
  for f in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'fn_abandoned_summary', 'fn_abandoned_segments', 'fn_abandoned_trend',
        'fn_abandoned_repeaters', 'fn_abandoned_breakdowns', 'fn_abandoned_anomaly_report',
        'fn_abandoned_carts_list', 'fn_abandoned_recall_stats', 'fn_abandoned_categories',
        'fn_abandoned_history', 'fn_abandoned_audience', 'fn_abandoned_promo_attribution'])
  loop
    src := f.def;
    if position('fn_abandoned_assert_reader()' in src) = 0 then
      src := regexp_replace(src, '(AS \$function\$)\s*', E'\1\n  select public.fn_abandoned_assert_reader();\n');
    end if;
    execute src;
    execute format('alter function public.%I(%s) security definer', f.proname, f.args);
  end loop;
end
$mig$;

-- Re-match already gates on admin/manager inside; it only needs to
-- run its updates without RLS.
alter function public.fn_abandoned_link() security definer;

-- Several of these were still executable by anon (grant slipped in
-- migration 117). Lock every abandoned RPC to signed-in users.
do $mig$
declare f record;
begin
  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fn\_abandoned%'
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon', f.proname, f.args);
    execute format('grant execute on function public.%I(%s) to authenticated', f.proname, f.args);
  end loop;
end
$mig$;
