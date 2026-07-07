-- ============================================================
-- Migration 015: multi-vendor analysis (e.g. Al Adwaa الأضواء)
-- Adds a vendor tag to stock_items (populated from the products file
-- brand column) and vendor-scoped analytics functions that match order
-- items by tagged SKU OR by a name/SKU pattern. Run after 014.
-- ============================================================
alter table public.stock_items add column if not exists vendor text;
create index if not exists idx_stock_vendor on public.stock_items (vendor);

create or replace function public.fn_upsert_stock(p_rows jsonb)
returns integer
language plpgsql set search_path = public
as $$
declare n integer;
begin
  if public.my_role() not in ('admin','manager') then
    raise exception 'Forbidden';
  end if;
  insert into public.stock_items (sku, product_name, ecom_stock, sap_stock, category, vendor, updated_at)
  select
    r->>'sku', nullif(r->>'product_name',''),
    nullif(r->>'ecom_stock','')::integer, nullif(r->>'sap_stock','')::integer,
    nullif(r->>'category',''), nullif(r->>'vendor',''), now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'sku','') <> ''
  on conflict (sku) do update set
    product_name = coalesce(excluded.product_name, stock_items.product_name),
    ecom_stock = coalesce(excluded.ecom_stock, stock_items.ecom_stock),
    sap_stock = coalesce(excluded.sap_stock, stock_items.sap_stock),
    category = coalesce(excluded.category, stock_items.category),
    vendor = coalesce(excluded.vendor, stock_items.vendor),
    updated_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.fn_vendor_kpis(p_pattern text, p_vendor text, p_from timestamptz, p_to timestamptz)
returns json language sql stable set search_path = public
as $$
  with matched as (
    select o.order_number, o.order_status, o.city, o.customer_id, o.order_date, i.product_name, i.sku, coalesce(i.price,0) as price
    from public.order_items i join public.orders o on o.order_number = i.order_number
    where (p_from is null or o.order_date >= p_from) and (p_to is null or o.order_date < p_to)
      and ((p_pattern is not null and p_pattern <> '' and (i.product_name ilike '%'||p_pattern||'%' or i.sku ilike p_pattern||'%'))
        or (p_vendor is not null and p_vendor <> '' and exists (select 1 from public.stock_items s where s.sku = i.sku and s.vendor = p_vendor)))
  )
  select json_build_object(
    'units', count(*), 'revenue', coalesce(sum(price),0), 'orders', count(distinct order_number),
    'delivered_units', count(*) filter (where order_status = 'Delivered'),
    'cancelled_units', count(*) filter (where order_status in ('Cancelled','Returned','Return Sent To Erp')),
    'unique_titles', count(distinct product_name), 'unique_customers', count(distinct customer_id),
    'avg_price', coalesce(avg(price),0)
  ) from matched;
$$;

create or replace function public.fn_vendor_top_books(p_pattern text, p_vendor text, p_from timestamptz, p_to timestamptz, p_limit integer default 30)
returns table (product_name text, sku text, units bigint, revenue numeric)
language sql stable set search_path = public
as $$
  select coalesce(i.product_name,'(unknown)'), max(i.sku), count(*), coalesce(sum(i.price),0)
  from public.order_items i join public.orders o on o.order_number = i.order_number
  where (p_from is null or o.order_date >= p_from) and (p_to is null or o.order_date < p_to) and o.order_status not in ('Cancelled')
    and ((p_pattern is not null and p_pattern <> '' and (i.product_name ilike '%'||p_pattern||'%' or i.sku ilike p_pattern||'%'))
      or (p_vendor is not null and p_vendor <> '' and exists (select 1 from public.stock_items s where s.sku = i.sku and s.vendor = p_vendor)))
  group by 1 order by 3 desc limit p_limit;
$$;

create or replace function public.fn_vendor_by_month(p_pattern text, p_vendor text, p_from timestamptz, p_to timestamptz)
returns table (month date, units bigint, revenue numeric, orders bigint)
language sql stable set search_path = public
as $$
  select date_trunc('month', o.order_date)::date, count(*), coalesce(sum(i.price),0), count(distinct o.order_number)
  from public.order_items i join public.orders o on o.order_number = i.order_number
  where o.order_date is not null and (p_from is null or o.order_date >= p_from) and (p_to is null or o.order_date < p_to)
    and ((p_pattern is not null and p_pattern <> '' and (i.product_name ilike '%'||p_pattern||'%' or i.sku ilike p_pattern||'%'))
      or (p_vendor is not null and p_vendor <> '' and exists (select 1 from public.stock_items s where s.sku = i.sku and s.vendor = p_vendor)))
  group by 1 order by 1;
$$;

create or replace function public.fn_vendor_by_city(p_pattern text, p_vendor text, p_from timestamptz, p_to timestamptz, p_limit integer default 20)
returns table (city text, units bigint, revenue numeric)
language sql stable set search_path = public
as $$
  select coalesce(nullif(trim(o.city),''),'(none)'), count(*), coalesce(sum(i.price),0)
  from public.order_items i join public.orders o on o.order_number = i.order_number
  where (p_from is null or o.order_date >= p_from) and (p_to is null or o.order_date < p_to) and o.order_status not in ('Cancelled')
    and ((p_pattern is not null and p_pattern <> '' and (i.product_name ilike '%'||p_pattern||'%' or i.sku ilike p_pattern||'%'))
      or (p_vendor is not null and p_vendor <> '' and exists (select 1 from public.stock_items s where s.sku = i.sku and s.vendor = p_vendor)))
  group by 1 order by 2 desc limit p_limit;
$$;

create or replace function public.fn_vendor_list()
returns table (vendor text, skus bigint)
language sql stable set search_path = public
as $$
  select vendor, count(*) from public.stock_items where vendor is not null and vendor <> '' group by 1 order by 2 desc;
$$;
