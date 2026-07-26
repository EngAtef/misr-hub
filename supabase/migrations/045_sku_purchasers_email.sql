-- ============================================================
-- Migration 045: buyers export includes the customer's email.
-- fn_sku_purchasers gains customer_email (from public.customers via
-- customer_id) so the Products page "export buyers" CSV can feed
-- email campaigns directly.
-- Return type changes -> drop + recreate.
-- Run after 044_abandoned_history.sql
-- ============================================================

drop function if exists public.fn_sku_purchasers(text, text, timestamptz, timestamptz, integer);
create or replace function public.fn_sku_purchasers(p_sku text, p_keyword text, p_from timestamptz, p_to timestamptz, p_limit integer default 5000)
returns table (
  order_number text, order_date timestamptz, order_status text,
  customer_id text, customer_name text, customer_phone text, customer_email text,
  city text, area text,
  product_name text, sku text, units bigint, book_amount numeric, order_total numeric,
  payment_method text
)
language sql stable set search_path = public
as $$
  select
    o.order_number, o.order_date, o.order_status,
    o.customer_id, o.customer_name, o.customer_phone,
    c.email as customer_email,
    o.city, o.area,
    mode() within group (order by i.product_name) as product_name,
    max(i.sku) as sku,
    count(*) as units,
    coalesce(sum(i.price), 0) as book_amount,
    max(o.total_order_amount) as order_total,
    max(o.payment_method) as payment_method
  from public.order_items i
  join public.orders o on o.order_number = i.order_number
  left join public.customers c on c.customer_id = o.customer_id
  where (
      (p_sku is not null and p_sku <> '' and i.sku = p_sku)
      or (p_keyword is not null and p_keyword <> '' and i.product_name ilike '%'||p_keyword||'%')
    )
    and (p_from is null or o.order_date >= p_from)
    and (p_to is null or o.order_date < p_to)
  group by o.order_number, o.order_date, o.order_status, o.customer_id, o.customer_name, o.customer_phone, c.email, o.city, o.area
  order by o.order_date desc
  limit p_limit;
$$;
revoke execute on function public.fn_sku_purchasers(text, text, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.fn_sku_purchasers(text, text, timestamptz, timestamptz, integer) to authenticated;
