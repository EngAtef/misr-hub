-- ============================================================
-- Migration 066: drop exactly-duplicated indexes.
--
-- Three btree indexes duplicated another index on the same columns.
-- Postgres happily maintains both, so every row of the 23k-order /
-- 104k-line / 104k-product-sales uploads paid for an index nothing
-- could ever read from.
--
--   idx_order_items_sku          == idx_items_sku          (added by 062)
--   idx_orders_date              == idx_orders_order_date  (added by 061)
--   idx_product_sales_order_sku  == product_sales_pkey     (added by 065)
--
-- The surviving index in each pair has identical definition, so no plan
-- changes — only cheaper writes. 062 and 065 have been edited not to
-- create theirs; this migration cleans up databases that already ran them.
-- Run after 065_units_by_quantity.sql
-- ============================================================

drop index if exists public.idx_order_items_sku;
drop index if exists public.idx_orders_date;
drop index if exists public.idx_product_sales_order_sku;

-- The big uploads leave enough dead tuples to skew the planner: a stale
-- product_sales (last analyzed 4 days / 11k dead rows) made the Products
-- page query take 4.5s instead of 1.2s. Refresh stats now; autovacuum
-- keeps up from here.
analyze public.orders;
analyze public.order_items;
analyze public.product_sales;
analyze public.products;
analyze public.stock_items;
