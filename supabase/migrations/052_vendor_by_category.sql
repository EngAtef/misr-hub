-- ============================================================
-- Migration 052: vendor analysis by product category.
-- Business rule: every SKU whose category is 'AL-Adwaa' (from
-- stock_items or product_sales) belongs to vendor "AL-Adwaa";
-- every other SKU belongs to "NM Books". Replaces the old
-- name-pattern matching on the vendors page. The old fn_vendor_*
-- functions are left in place (unused) so nothing else changes.
-- Run after 051.
-- ============================================================

-- Canonical AL-Adwaa SKU set (category-driven, both sources).
create or replace view public.v_adwaa_skus
with (security_invoker = true) as
  select sku from public.stock_items where category = 'AL-Adwaa'
  union
  select distinct sku from public.product_sales where category = 'AL-Adwaa';

-- KPIs for one vendor group: 'adwaa' or 'nm'.
create or replace function public.fn_vendor_grp_kpis(p_group text, p_from timestamptz, p_to timestamptz)
returns json language sql stable set search_path = public
as $$
  with matched as (
    select o.order_number, o.order_status, o.customer_id, i.product_name, coalesce(i.price,0) as price
    from public.order_items i join public.orders o on o.order_number = i.order_number
    where (p_from is null or o.order_date >= p_from) and (p_to is null or o.order_date < p_to)
      and (case when p_group = 'adwaa'
                then exists (select 1 from public.v_adwaa_skus a where a.sku = i.sku)
                else not exists (select 1 from public.v_adwaa_skus a where a.sku = i.sku) end)
  )
  select json_build_object(
    'units', count(*), 'revenue', coalesce(sum(price),0), 'orders', count(distinct order_number),
    'delivered_units', count(*) filter (where order_status = 'Delivered'),
    'cancelled_units', count(*) filter (where order_status in ('Cancelled','Returned','Return Sent To Erp')),
    'unique_titles', count(distinct product_name), 'unique_customers', count(distinct customer_id),
    'avg_price', coalesce(avg(price),0)
  ) from matched;
$$;

create or replace function public.fn_vendor_grp_by_month(p_group text, p_from timestamptz, p_to timestamptz)
returns table (month date, units bigint, revenue numeric, orders bigint)
language sql stable set search_path = public
as $$
  select date_trunc('month', o.order_date)::date, count(*), coalesce(sum(i.price),0), count(distinct o.order_number)
  from public.order_items i join public.orders o on o.order_number = i.order_number
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
  select coalesce(i.product_name,'(unknown)'), max(i.sku), count(*), coalesce(sum(i.price),0)
  from public.order_items i join public.orders o on o.order_number = i.order_number
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
  select coalesce(nullif(trim(o.city),''),'(none)'), count(*), coalesce(sum(i.price),0)
  from public.order_items i join public.orders o on o.order_number = i.order_number
  where (p_from is null or o.order_date >= p_from) and (p_to is null or o.order_date < p_to) and o.order_status not in ('Cancelled')
    and (case when p_group = 'adwaa'
              then exists (select 1 from public.v_adwaa_skus a where a.sku = i.sku)
              else not exists (select 1 from public.v_adwaa_skus a where a.sku = i.sku) end)
  group by 1 order by 2 desc limit p_limit;
$$;

-- Both vendors side by side for the comparison table.
create or replace function public.fn_vendor_grp_summary(p_from timestamptz, p_to timestamptz)
returns table (
  vendor text, units bigint, revenue numeric, orders bigint, titles bigint, customers bigint,
  delivered_units bigint, cancelled_units bigint, avg_price numeric, revenue_share_pct numeric
)
language sql stable set search_path = public
as $$
  with lines as (
    select
      case when exists (select 1 from public.v_adwaa_skus a where a.sku = i.sku)
           then 'AL-Adwaa' else 'NM Books' end as vendor,
      o.order_number, o.order_status, o.customer_id, i.product_name, coalesce(i.price,0) as price
    from public.order_items i join public.orders o on o.order_number = i.order_number
    where (p_from is null or o.order_date >= p_from) and (p_to is null or o.order_date < p_to)
  ),
  total as (select coalesce(sum(price),0) as t from lines)
  select
    l.vendor, count(*), coalesce(sum(l.price),0), count(distinct l.order_number),
    count(distinct l.product_name), count(distinct l.customer_id),
    count(*) filter (where l.order_status = 'Delivered'),
    count(*) filter (where l.order_status in ('Cancelled','Returned','Return Sent To Erp')),
    coalesce(avg(l.price),0),
    case when (select t from total) > 0 then round(coalesce(sum(l.price),0) * 100.0 / (select t from total), 1) else 0 end
  from lines l
  group by l.vendor
  order by 3 desc;
$$;

alter function public.fn_vendor_grp_kpis(text, timestamptz, timestamptz) set search_path = public;
alter function public.fn_vendor_grp_by_month(text, timestamptz, timestamptz) set search_path = public;
alter function public.fn_vendor_grp_top_books(text, timestamptz, timestamptz, integer) set search_path = public;
alter function public.fn_vendor_grp_by_city(text, timestamptz, timestamptz, integer) set search_path = public;
alter function public.fn_vendor_grp_summary(timestamptz, timestamptz) set search_path = public;
revoke execute on function public.fn_vendor_grp_kpis(text, timestamptz, timestamptz) from public, anon;
revoke execute on function public.fn_vendor_grp_by_month(text, timestamptz, timestamptz) from public, anon;
revoke execute on function public.fn_vendor_grp_top_books(text, timestamptz, timestamptz, integer) from public, anon;
revoke execute on function public.fn_vendor_grp_by_city(text, timestamptz, timestamptz, integer) from public, anon;
revoke execute on function public.fn_vendor_grp_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.fn_vendor_grp_kpis(text, timestamptz, timestamptz) to authenticated;
grant execute on function public.fn_vendor_grp_by_month(text, timestamptz, timestamptz) to authenticated;
grant execute on function public.fn_vendor_grp_top_books(text, timestamptz, timestamptz, integer) to authenticated;
grant execute on function public.fn_vendor_grp_by_city(text, timestamptz, timestamptz, integer) to authenticated;
grant execute on function public.fn_vendor_grp_summary(timestamptz, timestamptz) to authenticated;
