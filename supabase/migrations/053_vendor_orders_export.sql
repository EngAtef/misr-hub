-- ============================================================
-- Migration 053: vendor order-lines export + true unit counts.
--
-- 1) fn_vendor_grp_export: one row per (order, SKU) for the
--    selected vendor group with customer/contact details, real
--    quantity and discount detail (from product_sales, joined to
--    orders) — used by the vendors page "export orders" button to
--    produce a CSV that can be sent to the vendor directly.
--    Returns json so the result is not subject to the PostgREST
--    max-rows cap.
--
-- 2) order_items stores one row per (order, SKU) with price =
--    discounted line total, so revenue was correct but unit counts
--    ignored quantity (a 2-copy line counted as 1 unit). The
--    fn_vendor_grp_* functions now weight units by the quantity
--    recorded in product_sales (default 1 when missing).
-- Run after 052.
-- ============================================================

create or replace function public.fn_vendor_grp_export(p_group text, p_from timestamptz, p_to timestamptz)
returns json language sql stable set search_path = public
as $$
  with lines as (
    select ps.order_id as order_number,
           coalesce(o.order_date, ps.order_date) as order_date,
           coalesce(o.order_status, ps.status) as order_status,
           coalesce(o.payment_method, ps.payment_method) as payment_method,
           o.customer_name, o.customer_phone, o.city, o.area,
           ps.sku, ps.product_name, coalesce(ps.quantity, 1) as quantity,
           ps.unit_price,
           ps.price as total_before_discount,
           coalesce(ps.price_after_discount, ps.price) as total_paid
    from public.product_sales ps
    left join public.orders o on o.order_number = ps.order_id
    where (p_from is null or coalesce(o.order_date, ps.order_date) >= p_from)
      and (p_to is null or coalesce(o.order_date, ps.order_date) < p_to)
      and (case when p_group = 'adwaa'
                then exists (select 1 from public.v_adwaa_skus a where a.sku = ps.sku)
                else not exists (select 1 from public.v_adwaa_skus a where a.sku = ps.sku) end)
  )
  select coalesce(json_agg(row_to_json(l) order by l.order_date desc, l.order_number, l.product_name), '[]'::json)
  from lines l;
$$;

-- units weighted by real quantity
create or replace function public.fn_vendor_grp_kpis(p_group text, p_from timestamptz, p_to timestamptz)
returns json language sql stable set search_path = public
as $$
  with matched as (
    select o.order_number, o.order_status, o.customer_id, i.product_name, coalesce(i.price,0) as price,
           coalesce(ps.quantity, 1) as qty
    from public.order_items i
    join public.orders o on o.order_number = i.order_number
    left join public.product_sales ps on ps.order_id = i.order_number and ps.sku = i.sku
    where (p_from is null or o.order_date >= p_from) and (p_to is null or o.order_date < p_to)
      and (case when p_group = 'adwaa'
                then exists (select 1 from public.v_adwaa_skus a where a.sku = i.sku)
                else not exists (select 1 from public.v_adwaa_skus a where a.sku = i.sku) end)
  )
  select json_build_object(
    'units', coalesce(sum(qty),0), 'revenue', coalesce(sum(price),0), 'orders', count(distinct order_number),
    'delivered_units', coalesce(sum(qty) filter (where order_status = 'Delivered'),0),
    'cancelled_units', coalesce(sum(qty) filter (where order_status in ('Cancelled','Returned','Return Sent To Erp')),0),
    'unique_titles', count(distinct product_name), 'unique_customers', count(distinct customer_id),
    'avg_price', case when coalesce(sum(qty),0) > 0 then coalesce(sum(price),0) / sum(qty) else 0 end
  ) from matched;
$$;

create or replace function public.fn_vendor_grp_by_month(p_group text, p_from timestamptz, p_to timestamptz)
returns table (month date, units bigint, revenue numeric, orders bigint)
language sql stable set search_path = public
as $$
  select date_trunc('month', o.order_date)::date, coalesce(sum(coalesce(ps.quantity,1)),0)::bigint,
         coalesce(sum(i.price),0), count(distinct o.order_number)
  from public.order_items i
  join public.orders o on o.order_number = i.order_number
  left join public.product_sales ps on ps.order_id = i.order_number and ps.sku = i.sku
  where o.order_date is not null and (p_from is null or o.order_date >= p_from) and (p_to is null or o.order_date < p_to)
    and (case when p_group = 'adwaa'
              then exists (select 1 from public.v_adwaa_skus a where a.sku = i.sku)
              else not exists (select 1 from public.v_adwaa_skus a where a.sku = i.sku) end)
  group by 1 order by 1;
$$;

create or replace function public.fn_vendor_grp_top_books(p_group text, p_from timestamptz, p_to timestamptz, p_limit integer default 30)
returns table (product_name text, sku text, units bigint, revenue numeric)
language sql stable set search_path = public
as $$
  select coalesce(i.product_name,'(unknown)'), max(i.sku), coalesce(sum(coalesce(ps.quantity,1)),0)::bigint, coalesce(sum(i.price),0)
  from public.order_items i
  join public.orders o on o.order_number = i.order_number
  left join public.product_sales ps on ps.order_id = i.order_number and ps.sku = i.sku
  where (p_from is null or o.order_date >= p_from) and (p_to is null or o.order_date < p_to) and o.order_status not in ('Cancelled')
    and (case when p_group = 'adwaa'
              then exists (select 1 from public.v_adwaa_skus a where a.sku = i.sku)
              else not exists (select 1 from public.v_adwaa_skus a where a.sku = i.sku) end)
  group by 1 order by 3 desc limit p_limit;
$$;

create or replace function public.fn_vendor_grp_by_city(p_group text, p_from timestamptz, p_to timestamptz, p_limit integer default 20)
returns table (city text, units bigint, revenue numeric)
language sql stable set search_path = public
as $$
  select coalesce(nullif(trim(o.city),''),'(none)'), coalesce(sum(coalesce(ps.quantity,1)),0)::bigint, coalesce(sum(i.price),0)
  from public.order_items i
  join public.orders o on o.order_number = i.order_number
  left join public.product_sales ps on ps.order_id = i.order_number and ps.sku = i.sku
  where (p_from is null or o.order_date >= p_from) and (p_to is null or o.order_date < p_to) and o.order_status not in ('Cancelled')
    and (case when p_group = 'adwaa'
              then exists (select 1 from public.v_adwaa_skus a where a.sku = i.sku)
              else not exists (select 1 from public.v_adwaa_skus a where a.sku = i.sku) end)
  group by 1 order by 2 desc limit p_limit;
$$;

alter function public.fn_vendor_grp_export(text, timestamptz, timestamptz) set search_path = public;
revoke execute on function public.fn_vendor_grp_export(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.fn_vendor_grp_export(text, timestamptz, timestamptz) to authenticated;
