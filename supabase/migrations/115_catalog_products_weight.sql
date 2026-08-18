-- ============================================================
-- Migration 115: weight on the Products & SKUs page.
-- fn_catalog_products gains unit_weight_kg (catalog), weight_kg
-- (period units × unit weight) and lifetime_weight_kg, plus a
-- 'weight' sort key; fn_catalog_products_totals sums both.
-- Drop + recreate: return types grow. Run after 114_weights.sql
-- ============================================================

drop function if exists public.fn_catalog_products_totals(timestamptz, timestamptz, text, text);
drop function if exists public.fn_catalog_products(timestamptz, timestamptz, text, text, text, text, integer, integer);

create function public.fn_catalog_products(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_search text default null,
  p_scope text default 'all',
  p_sort text default 'units',
  p_dir text default 'desc',
  p_limit integer default 100,
  p_offset integer default 0
)
returns table(
  sku text, product_name text, category text, vendor text,
  ecom_stock integer, sap_stock integer, price numeric, image text,
  author text, publisher text, language text, age text, series text, barcode text,
  units bigint, orders bigint, revenue numeric,
  lifetime_units bigint, lifetime_orders bigint, lifetime_revenue numeric,
  first_order_date timestamptz, last_order_date timestamptz,
  total_count bigint,
  unit_weight_kg numeric, weight_kg numeric, lifetime_weight_kg numeric
)
language sql stable set search_path = public
as $$
  with life as (
    select
      coalesce(nullif(i.sku, ''), '(no sku)') as sku,
      mode() within group (order by i.product_name) as product_name,
      sum(coalesce(ps.quantity, 1))::bigint as l_units,
      count(distinct i.order_number)::bigint as l_orders,
      coalesce(sum(i.price), 0) as l_revenue,
      min(o.order_date) as first_order_date,
      max(o.order_date) as last_order_date,
      coalesce(sum(coalesce(ps.quantity, 1)) filter (
        where (p_from is null or o.order_date >= p_from)
          and (p_to is null or o.order_date < p_to)
      ), 0)::bigint as r_units,
      count(distinct i.order_number) filter (
        where (p_from is null or o.order_date >= p_from)
          and (p_to is null or o.order_date < p_to)
      )::bigint as r_orders,
      coalesce(sum(i.price) filter (
        where (p_from is null or o.order_date >= p_from)
          and (p_to is null or o.order_date < p_to)
      ), 0) as r_revenue
    from public.order_items i
    join public.orders o on o.order_number = i.order_number
    left join public.product_sales ps on ps.order_id = i.order_number and ps.sku = i.sku and ps.quantity is not null and ps.quantity <> 1
    where o.order_status not in ('Cancelled')
    group by 1
  ),
  universe as (
    select s.sku from public.stock_items s
    union
    select p.sku from public.products p
    union
    select l.sku from life l
  ),
  joined as (
    select
      u.sku,
      coalesce(nullif(p.name, ''), nullif(s.product_name, ''), l.product_name, u.sku) as product_name,
      coalesce(s.category, p.section) as category,
      coalesce(s.vendor, p.vendor, p.publisher) as vendor,
      coalesce(s.ecom_stock, p.stock_qty) as ecom_stock,
      s.sap_stock,
      p.price, p.image, p.author, p.publisher, p.language, p.age, p.series, p.barcode,
      coalesce(l.r_units, 0)::bigint as units,
      coalesce(l.r_orders, 0)::bigint as orders,
      coalesce(l.r_revenue, 0) as revenue,
      coalesce(l.l_units, 0)::bigint as lifetime_units,
      coalesce(l.l_orders, 0)::bigint as lifetime_orders,
      coalesce(l.l_revenue, 0) as lifetime_revenue,
      l.first_order_date,
      l.last_order_date,
      p.weight_kg as unit_weight_kg,
      round(coalesce(l.r_units, 0) * p.weight_kg, 2) as weight_kg,
      round(coalesce(l.l_units, 0) * p.weight_kg, 2) as lifetime_weight_kg
    from universe u
    left join public.stock_items s on s.sku = u.sku
    left join public.products p on p.sku = u.sku
    left join life l on l.sku = u.sku
  ),
  filtered as (
    select * from joined j
    where (
        p_search is null or p_search = ''
        or j.product_name ilike '%' || p_search || '%'
        or j.sku ilike '%' || p_search || '%'
        or j.author ilike '%' || p_search || '%'
        or j.publisher ilike '%' || p_search || '%'
        or j.series ilike '%' || p_search || '%'
        or j.barcode ilike '%' || p_search || '%'
      )
      and case lower(coalesce(p_scope, 'all'))
            when 'sold' then j.units > 0
            when 'unsold' then j.units = 0
            when 'never' then j.lifetime_units = 0
            when 'ever' then j.lifetime_units > 0
            when 'oos' then coalesce(j.ecom_stock, 0) <= 0
            when 'instock' then coalesce(j.ecom_stock, 0) > 0
            else true
          end
  )
  select
    f.sku, f.product_name, f.category, f.vendor, f.ecom_stock, f.sap_stock,
    f.price, f.image, f.author, f.publisher, f.language, f.age, f.series, f.barcode,
    f.units, f.orders, f.revenue,
    f.lifetime_units, f.lifetime_orders, f.lifetime_revenue,
    f.first_order_date, f.last_order_date,
    count(*) over ()::bigint as total_count,
    f.unit_weight_kg, f.weight_kg, f.lifetime_weight_kg
  from filtered f
  order by
    case when lower(coalesce(p_sort, 'units')) = 'name' and lower(coalesce(p_dir, 'desc')) = 'asc' then f.product_name end asc nulls last,
    case when lower(coalesce(p_sort, 'units')) = 'name' and lower(coalesce(p_dir, 'desc')) <> 'asc' then f.product_name end desc nulls last,
    case when lower(coalesce(p_sort, 'units')) = 'sku' and lower(coalesce(p_dir, 'desc')) = 'asc' then f.sku end asc nulls last,
    case when lower(coalesce(p_sort, 'units')) = 'sku' and lower(coalesce(p_dir, 'desc')) <> 'asc' then f.sku end desc nulls last,
    (case when lower(coalesce(p_dir, 'desc')) = 'asc' then 1 else -1 end) *
    (case lower(coalesce(p_sort, 'units'))
       when 'orders' then f.orders::numeric
       when 'revenue' then f.revenue
       when 'lifetime_units' then f.lifetime_units::numeric
       when 'lifetime_orders' then f.lifetime_orders::numeric
       when 'lifetime_revenue' then f.lifetime_revenue
       when 'stock' then coalesce(f.ecom_stock, 0)::numeric
       when 'price' then coalesce(f.price, 0)
       when 'last_sale' then coalesce(extract(epoch from f.last_order_date), 0)::numeric
       when 'unit_weight' then coalesce(f.unit_weight_kg, 0)
       when 'weight' then coalesce(f.weight_kg, 0)
       when 'lifetime_weight' then coalesce(f.lifetime_weight_kg, 0)
       else f.units::numeric
     end) asc nulls last,
    f.sku asc
  limit greatest(coalesce(p_limit, 100), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke execute on function public.fn_catalog_products(timestamptz, timestamptz, text, text, text, text, integer, integer) from public, anon;

create function public.fn_catalog_products_totals(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_search text default null,
  p_scope text default 'all'
)
returns table(
  products bigint, never_sold bigint, out_of_stock bigint,
  units bigint, orders bigint, revenue numeric,
  lifetime_units bigint, lifetime_revenue numeric,
  weight_kg numeric, lifetime_weight_kg numeric
)
language sql stable set search_path = public
as $$
  with r as (
    select * from public.fn_catalog_products(p_from, p_to, p_search, p_scope, 'units', 'desc', 1000000, 0)
  )
  select
    count(*)::bigint,
    count(*) filter (where r.lifetime_units = 0)::bigint,
    count(*) filter (where coalesce(r.ecom_stock, 0) <= 0)::bigint,
    coalesce(sum(r.units), 0)::bigint,
    coalesce(sum(r.orders), 0)::bigint,
    coalesce(sum(r.revenue), 0),
    coalesce(sum(r.lifetime_units), 0)::bigint,
    coalesce(sum(r.lifetime_revenue), 0),
    coalesce(sum(r.weight_kg), 0),
    coalesce(sum(r.lifetime_weight_kg), 0)
  from r;
$$;
revoke execute on function public.fn_catalog_products_totals(timestamptz, timestamptz, text, text) from public, anon;
