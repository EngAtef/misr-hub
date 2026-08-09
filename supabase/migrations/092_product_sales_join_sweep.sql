-- ============================================================
-- Migration 092: the same join fix as 091, applied everywhere else it
-- was inherited from 065_units_by_quantity.
--
-- Every one of these functions counts copies as coalesce(ps.quantity, 1),
-- so product_sales can only change an answer for rows where quantity is
-- neither null nor 1 — 3,331 of 106,381. Every other row contributes 1
-- whether it joins or not, but the planner cannot know that and nested-
-- loops ~100k memoized index probes to find out. Pushing the condition
-- into the join lets the existing partial index idx_product_sales_qty_multi
-- serve those rows as a small hash.
--
-- Measured on the same call each page makes, warm both times, with the
-- full result set md5-fingerprinted before and after:
--
--   function                    before     after   faster   result
--   fn_custom_lists_overview   5,919 ms  3,408 ms   42%   identical
--   fn_catalog_products        1,349 ms  1,169 ms   13%   identical
--   fn_ads_gap                 1,231 ms  1,199 ms    3%   identical
--   fn_ads_map_suggest           864 ms    605 ms   30%   identical
--   fn_ads_insights              536 ms    481 ms   10%   identical
--   fn_product_stats             220 ms    178 ms   19%   identical
--   fn_top_products              188 ms    146 ms   22%   identical
--   fn_custom_list_items           8 ms      8 ms    5%   identical
--
-- Two functions match the grep but are deliberately NOT swept:
--
--   fn_sku_purchasers     reads ps.product_name, ps.unit_price and
--                         ps.unit_price_after_discount off the same join.
--                         Restricting it would blank those columns.
--   fn_vendor_grp_export  drives FROM product_sales — it is the source
--                         table, not a lookup join.
--
-- Still outstanding: fn_custom_lists_overview is 3.4s even after this.
-- Its remaining cost is 108,903 buffer hits of genuine work, not a sort
-- spill — a work_mem grant was tested and made no difference — so it needs
-- its own diagnosis rather than this fix.
-- Run after 091_stock_engine_speed.sql
-- ============================================================

do $$
declare
  r record;
  newdef text;
  changed int := 0;
begin
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname in ('fn_ads_gap','fn_ads_insights','fn_ads_map_suggest','fn_catalog_products',
                         'fn_custom_list_items','fn_custom_lists_overview','fn_product_stats','fn_top_products')
       -- so a re-run cannot append a second guard to a join already fixed
       and pg_get_functiondef(p.oid) not like '%ps.quantity <> 1%'
  loop
    newdef := regexp_replace(
      r.def,
      '(left join public\.product_sales ps on ps\.order_id = \w+\.order_number and ps\.sku = \w+\.sku)',
      '\1 and ps.quantity is not null and ps.quantity <> 1',
      'g');
    if newdef is distinct from r.def then
      execute newdef;   -- CREATE OR REPLACE: owner, grants and SECURITY DEFINER are preserved
      changed := changed + 1;
      raise notice 'rewrote %', r.proname;
    else
      raise warning 'no product_sales join matched in % — left untouched', r.proname;
    end if;
  end loop;
  raise notice 'functions rewritten: %', changed;
end $$;
