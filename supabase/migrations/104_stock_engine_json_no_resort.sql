-- ============================================================
-- Migration 104: the jsonb wrapper took 4.9 s to package a 0.66 s engine.
--
-- jsonb_agg(to_jsonb(e) ORDER BY need, units, lifetime) re-sorted 4,499
-- rows that arrive already sorted — the engine ends in the same ORDER BY —
-- and it sorted them carrying a 2.4 MB jsonb payload under the default
-- 4 MB work_mem, so the sort spilled to disk (temp read/written 414
-- blocks). Measured on the page's own call:
--   with the ORDER BY     4,862 ms   temp 414 blocks
--   without               ~800 ms    no temp
-- Row order through a set-returning function is the function's order, so
-- nothing is lost by dropping it. work_mem is set on the wrapper too so
-- the aggregate itself never spills.
--
-- Run after 103_stock_inactive_note.sql
-- ============================================================

create or replace function public.fn_stock_engine_json(
  p_window_days integer default 30,
  p_coverage_days integer default 45,
  p_global_min integer default 20,
  p_bestseller_min integer default 20,
  p_bestseller_units integer default 20,
  p_max_order integer default 300,
  p_min_sap_move integer default 2,
  p_relist_qty integer default 10,
  p_ad_days integer default 0,
  p_unlimited_at integer default 5000,
  p_overstock_min integer default 20,
  p_min_scope text default 'listed',
  p_min_move_line integer default 5,
  p_recent_days integer default 7,
  p_surge_min integer default 5
)
returns jsonb
language sql stable set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
  from public.fn_stock_engine(
    p_window_days, p_coverage_days, p_global_min, p_bestseller_min,
    p_bestseller_units, p_max_order, p_min_sap_move, p_relist_qty,
    p_ad_days, p_unlimited_at, p_overstock_min, p_min_scope, p_min_move_line,
    p_recent_days, p_surge_min
  ) e;
$$;

alter function public.fn_stock_engine_json(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer, integer, integer)
  set work_mem = '32MB';
grant execute on function public.fn_stock_engine_json(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer, integer, integer)
  to authenticated;
