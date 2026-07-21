-- ============================================================
-- Migration 037: use every ProductSalesExport dimension.
-- - orders_with_categories also exposes sub_categories[] and
--   brands[] so orders can be filtered by any file hierarchy
-- - fn_category_buyers gains sub-category / brand filters
--   (drop + recreate: adding defaulted params would otherwise
--   leave the old 3-arg overload behind and confuse PostgREST)
-- - fn_customer_purchases: every book a customer bought, per
--   order, with quantity and discount detail (buyer drill-down)
-- Run after 036_promo_codes.sql
-- ============================================================

create or replace view public.orders_with_categories
with (security_invoker = true) as
select
  o.*,
  (select array_agg(distinct ps.category)
     from public.product_sales ps
    where ps.order_id = o.order_number
      and ps.category is not null) as categories,
  (select array_agg(distinct ps.sub_category)
     from public.product_sales ps
    where ps.order_id = o.order_number
      and ps.sub_category is not null) as sub_categories,
  (select array_agg(distinct ps.brand)
     from public.product_sales ps
    where ps.order_id = o.order_number
      and ps.brand is not null) as brands
from public.orders o;

drop function if exists public.fn_category_buyers(text[], timestamptz, timestamptz);

create or replace function public.fn_category_buyers(
  p_categories text[] default null,
  p_sub_categories text[] default null,
  p_brands text[] default null,
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
    and (p_sub_categories is null or ps.sub_category = any(p_sub_categories))
    and (p_brands is null or ps.brand = any(p_brands))
    and (p_from is null or o.order_date >= p_from)
    and (p_to is null or o.order_date < p_to)
    and coalesce(ps.status, '') not in ('Cancelled')
    and coalesce(o.customer_id, o.customer_phone, o.customer_name) is not null
  group by 1
  order by spend desc;
$$;

alter function public.fn_category_buyers(text[], text[], text[], timestamptz, timestamptz) set search_path = public;
revoke execute on function public.fn_category_buyers(text[], text[], text[], timestamptz, timestamptz) from public, anon;

-- Every sales line of one customer: each book per order with quantity
-- and prices. Key matching mirrors fn_category_buyers' customer_key.
create or replace function public.fn_customer_purchases(
  p_customer_key text,
  p_categories text[] default null,
  p_sub_categories text[] default null,
  p_brands text[] default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  order_id text,
  order_date timestamptz,
  order_status text,
  sku text,
  product_name text,
  category text,
  sub_category text,
  brand text,
  quantity numeric,
  unit_price numeric,
  price numeric,
  price_after_discount numeric,
  promotion text
)
language sql stable set search_path = public
as $$
  select
    ps.order_id, o.order_date, o.order_status,
    ps.sku, ps.product_name, ps.category, ps.sub_category, ps.brand,
    ps.quantity, ps.unit_price, ps.price, ps.price_after_discount, ps.promotion
  from public.product_sales ps
  join public.orders o on o.order_number = ps.order_id
  where coalesce(o.customer_id, o.customer_phone, o.customer_name) = p_customer_key
    and (p_categories is null or ps.category = any(p_categories))
    and (p_sub_categories is null or ps.sub_category = any(p_sub_categories))
    and (p_brands is null or ps.brand = any(p_brands))
    and (p_from is null or o.order_date >= p_from)
    and (p_to is null or o.order_date < p_to)
  order by o.order_date desc, ps.order_id, ps.product_name;
$$;

alter function public.fn_customer_purchases(text, text[], text[], text[], timestamptz, timestamptz) set search_path = public;
revoke execute on function public.fn_customer_purchases(text, text[], text[], text[], timestamptz, timestamptz) from public, anon;
