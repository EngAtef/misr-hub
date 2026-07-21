-- ============================================================
-- Migration 035: category filter on orders + buyers by category.
-- product_sales carries category per (order, sku). Expose the
-- distinct categories of each order as an array so the orders
-- page can filter with overlaps(), and aggregate buyer stats
-- per category for the buyers view and CSV export.
-- Run after 034_session_enforcement.sql
-- ============================================================

-- Orders enriched with their item categories. security_invoker
-- keeps orders/product_sales RLS applying to the caller.
create or replace view public.orders_with_categories
with (security_invoker = true) as
select
  o.*,
  (select array_agg(distinct ps.category)
     from public.product_sales ps
    where ps.order_id = o.order_number
      and ps.category is not null) as categories
from public.orders o;

-- Buyer aggregates for the selected categories (null = all).
-- Spend counts product_sales line amounts (after discount when
-- present) so it reflects spend *within* the category, not the
-- whole order total. Cancelled lines are excluded, matching
-- fn_product_sales_breakdown.
create or replace function public.fn_category_buyers(
  p_categories text[] default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  customer_key text,
  customer_id text,
  customer_name text,
  customer_phone text,
  city text,
  orders_count bigint,
  units numeric,
  spend numeric,
  categories text[],
  first_order timestamptz,
  last_order timestamptz
)
language sql stable set search_path = public
as $$
  select
    coalesce(o.customer_id, o.customer_phone, o.customer_name) as customer_key,
    max(o.customer_id) as customer_id,
    max(o.customer_name) as customer_name,
    max(o.customer_phone) as customer_phone,
    max(o.city) as city,
    count(distinct ps.order_id) as orders_count,
    coalesce(sum(ps.quantity), 0) as units,
    coalesce(sum(coalesce(ps.price_after_discount, ps.price)), 0) as spend,
    array_agg(distinct ps.category) as categories,
    min(o.order_date) as first_order,
    max(o.order_date) as last_order
  from public.product_sales ps
  join public.orders o on o.order_number = ps.order_id
  where ps.category is not null
    and (p_categories is null or ps.category = any(p_categories))
    and (p_from is null or o.order_date >= p_from)
    and (p_to is null or o.order_date < p_to)
    and coalesce(ps.status, '') not in ('Cancelled')
    and coalesce(o.customer_id, o.customer_phone, o.customer_name) is not null
  group by 1
  order by spend desc;
$$;

alter function public.fn_category_buyers(text[], timestamptz, timestamptz) set search_path = public;
revoke execute on function public.fn_category_buyers(text[], timestamptz, timestamptz) from public, anon;
