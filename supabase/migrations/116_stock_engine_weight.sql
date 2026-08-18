-- ============================================================
-- Migration 116: unit weight on the stock engine payload.
-- fn_stock_engine_json (15-arg) attaches products.weight_kg as
-- unit_weight_kg to every row via a per-row lookup — no join, so the
-- engine's row order (which the page relies on) is untouched. The page
-- derives move / shortfall / surplus weight from it.
-- Run after 115_catalog_products_weight.sql
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
language sql stable
set search_path = public
set work_mem = '32MB'
as $$
  select coalesce(jsonb_agg(
    to_jsonb(e) || jsonb_build_object(
      'unit_weight_kg', (select p.weight_kg from public.products p where p.sku = e.sku)
    )
  ), '[]'::jsonb)
  from public.fn_stock_engine(
    p_window_days, p_coverage_days, p_global_min, p_bestseller_min,
    p_bestseller_units, p_max_order, p_min_sap_move, p_relist_qty,
    p_ad_days, p_unlimited_at, p_overstock_min, p_min_scope, p_min_move_line,
    p_recent_days, p_surge_min
  ) e;
$$;
