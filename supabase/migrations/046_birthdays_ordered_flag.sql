-- ============================================================
-- Migration 046: birthdays list knows if the customer ever ordered.
-- fn_birthdays gains lifetime_orders (from the CustomerOrdersExport
-- lifetime stats, falling back to the profile's total_orders) so the
-- Customers page can filter birthday lists by "ordered before / never
-- ordered" — the in-app `orders` count alone misses history that
-- predates the imported OrderExport files.
-- Return type changes -> drop + recreate.
-- Run after 045_sku_purchasers_email.sql
-- ============================================================

drop function if exists public.fn_birthdays(integer, integer);
create or replace function public.fn_birthdays(p_month integer default null, p_limit integer default 2000)
returns table (
  customer_id text, name text, phone text, email text, city text,
  birthdate date, birth_day integer, orders bigint, lifetime_orders integer,
  total_spent numeric, last_order timestamptz
)
language sql stable set search_path = public
as $$
  select
    c.customer_id, c.name, c.phone, c.email, c.city,
    c.birthdate,
    extract(day from c.birthdate)::integer as birth_day,
    count(o.order_number) as orders,
    coalesce(c.lifetime_orders, c.total_orders, 0) as lifetime_orders,
    coalesce(sum(o.total_order_amount), 0) as total_spent,
    max(o.order_date) as last_order
  from public.customers c
  left join public.orders o on o.customer_id = c.customer_id and o.order_status not in ('Cancelled')
  where c.birthdate is not null
    and extract(month from c.birthdate) = coalesce(p_month, extract(month from now()))
    and coalesce(c.is_active, true)
  group by c.customer_id, c.name, c.phone, c.email, c.city, c.birthdate, c.lifetime_orders, c.total_orders
  order by birth_day, total_spent desc
  limit p_limit;
$$;
revoke execute on function public.fn_birthdays(integer, integer) from public, anon;
grant execute on function public.fn_birthdays(integer, integer) to authenticated;
