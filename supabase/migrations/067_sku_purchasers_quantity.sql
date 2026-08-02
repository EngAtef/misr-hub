-- ============================================================
-- Migration 067: the product drawer disagreed with the order drawer.
--
-- Order #20590 shows QTY 3 of C010917120002P in Orders (that modal reads
-- product_sales directly), but the Products drawer showed 1 unit for the
-- same order — fn_sku_purchasers counted order_items rows, and
-- order_items has no quantity column (OrderExport packs an order into one
-- pipe-separated row, so one row per SKU regardless of copies).
-- Migration 065 fixed every other units function and missed this one.
--
-- fn_sku_purchasers now takes quantity, unit price and the discounted
-- line total from product_sales — the same source the Orders modal uses —
-- so both drawers show identical numbers for the same order. The join is
-- LEFT with a fallback of 1 copy so orders that predate the
-- ProductSalesExport still appear.
-- Run after 066_drop_duplicate_indexes.sql
-- ============================================================

drop function if exists public.fn_sku_purchasers(text, text, timestamptz, timestamptz, integer);
create or replace function public.fn_sku_purchasers(
  p_sku text,
  p_keyword text,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer default 5000
)
returns table (
  order_number text, order_date timestamptz, order_status text,
  customer_id text, customer_name text, customer_phone text, customer_email text,
  city text, area text,
  product_name text, sku text,
  units bigint, unit_price numeric, book_amount numeric,
  order_total numeric, payment_method text
)
language sql stable set search_path = public
as $$
  select
    o.order_number, o.order_date, o.order_status,
    o.customer_id, o.customer_name, o.customer_phone,
    c.email as customer_email,
    o.city, o.area,
    mode() within group (order by coalesce(ps.product_name, i.product_name)) as product_name,
    max(i.sku) as sku,
    -- real copies bought, not the number of order lines
    sum(coalesce(ps.quantity, 1))::bigint as units,
    max(coalesce(ps.unit_price_after_discount, ps.unit_price)) as unit_price,
    -- order_items.price is already the discounted line total
    coalesce(sum(i.price), 0) as book_amount,
    max(o.total_order_amount) as order_total,
    max(o.payment_method) as payment_method
  from public.order_items i
  join public.orders o on o.order_number = i.order_number
  left join public.product_sales ps on ps.order_id = i.order_number and ps.sku = i.sku
  left join public.customers c on c.customer_id = o.customer_id
  where (
      (p_sku is not null and p_sku <> '' and i.sku = p_sku)
      or (p_keyword is not null and p_keyword <> '' and i.product_name ilike '%'||p_keyword||'%')
    )
    and (p_from is null or o.order_date >= p_from)
    and (p_to is null or o.order_date < p_to)
  group by o.order_number, o.order_date, o.order_status, o.customer_id,
           o.customer_name, o.customer_phone, c.email, o.city, o.area
  order by o.order_date desc
  limit p_limit;
$$;

revoke execute on function public.fn_sku_purchasers(text, text, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.fn_sku_purchasers(text, text, timestamptz, timestamptz, integer) to authenticated;
