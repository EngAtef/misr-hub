-- ============================================================
-- Migration 136: /abandoned RPCs plan with their real parameters.
--
-- Follow-up to 135. SECURITY DEFINER removed the RLS penalty, but
-- SQL-language functions are planned with every parameter unknown
-- (functions.c passes no bound params), so `p_from is null or
-- created_at >= p_from` can never use an index and the row estimates
-- collapse to 1-2. Reproduced with PREPARE + force_generic_plan:
--   fn_abandoned_top_products  month-to-date  5.9 s  (nested-loop anti
--     join over the excluded-carts CTE, 297k filter rejections; the
--     all-time call is 66 s) vs 0.25 s with literal parameters
--   fn_abandoned_carts_list    all-time      11.1 s  (fn_fx_rates()
--     evaluated per row inside the min/max value CASE) vs ~1 s
--
-- Fix: the same bodies become plpgsql wrappers
--   (perform gate; return query <body> / return (<body>))
-- with `plan_cache_mode = force_custom_plan`, so every call is
-- planned with the actual values: null filters fold away, ranges hit
-- idx_ab_items_created / idx_ab_carts_created, joins are hashed.
-- the `#variable_conflict use_column` directive keeps unqualified column
-- names (phone_norm, cart_value, ...) resolving to the table column
-- rather than the RETURNS TABLE output of the same name.
-- Bodies are copied verbatim from the catalog, so results are
-- identical to 135. Run after 135.
-- ============================================================

do $mig$
declare
  f record;
  body text;
  ddl text;
begin
  for f in
    select p.oid, p.proname, p.proretset,
           pg_get_function_arguments(p.oid) as args_full,
           pg_get_function_result(p.oid) as rettype,
           p.prosrc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and l.lanname = 'sql'
      and p.proname = any (array[
        'fn_abandoned_summary', 'fn_abandoned_segments', 'fn_abandoned_trend',
        'fn_abandoned_repeaters', 'fn_abandoned_breakdowns', 'fn_abandoned_anomaly_report',
        'fn_abandoned_carts_list', 'fn_abandoned_recall_stats', 'fn_abandoned_categories',
        'fn_abandoned_history', 'fn_abandoned_audience', 'fn_abandoned_promo_attribution',
        'fn_abandoned_top_products'])
  loop
    -- drop the gate statement 135 prepended; it is re-added as PERFORM
    body := regexp_replace(f.prosrc, '^\s*select public\.fn_abandoned_assert_reader\(\);\s*', '');
    body := rtrim(body, E' \n\t;');

    ddl := format(
      'create or replace function public.%I(%s) returns %s '
      'language plpgsql stable security definer '
      'set search_path to ''public'' '
      'set plan_cache_mode to ''force_custom_plan'' '
      'as $fn$ #variable_conflict use_column
begin perform public.fn_abandoned_assert_reader(); %s; end $fn$',
      f.proname, f.args_full, f.rettype,
      case when f.proretset then 'return query ' || body else 'return (' || body || ')' end);
    execute ddl;
  end loop;
end
$mig$;

-- sanity: every page RPC is now plpgsql + definer + custom plans
do $mig$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
  where n.nspname = 'public' and p.proname like 'fn\_abandoned%'
    and p.proname not in ('fn_abandoned_assert_reader', 'fn_abandoned_estimate_values', 'fn_abandoned_recovery_code')
    and (not p.prosecdef or l.lanname = 'sql');
  if bad is not null then
    raise exception 'abandoned RPCs still generic/RLS-bound: %', bad;
  end if;
end
$mig$;
