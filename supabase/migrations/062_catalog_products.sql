-- ============================================================
-- Migration 062: catalog-first Products page.
-- fn_product_stats starts from order_items, so a book only exists on
-- the Products page if it SOLD inside the selected date range (and it
-- was capped at the top 500). Books with 0 stock, books that never
-- sold, and books whose only orders are older than the range were
-- invisible even though the FullProductExport upload had loaded them.
--
-- fn_catalog_products starts from the CATALOG (stock_items, plus any
-- SKU seen in orders but missing from the catalog) and left-joins the
-- sales aggregates, so every product is listed. It returns both the
-- selected-range figures AND lifetime figures + first/last order date,
-- so a book with no stock but old orders still shows its history.
-- Server-side search, scope filter, sort and pagination; total_count
-- rides along in every row.
-- Run after 061_tx_key_fast_joins.sql
-- ============================================================

create index if not exists idx_order_items_sku on public.order_items (sku);

drop function if exists public.fn_catalog_products(timestamptz, timestamptz, text, text, text, text, integer, integer);
create or replace function public.fn_catalog_products(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_search text default null,
  p_scope text default 'all',      -- all | sold | unsold | never | ever | oos | instock
  p_sort text default 'units',     -- units|orders|revenue|lifetime_units|lifetime_orders|lifetime_revenue|stock|last_sale|name|sku
  p_dir text default 'desc',
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  sku text,
  product_name text,
  category text,
  vendor text,
  ecom_stock integer,
  sap_stock integer,
  units bigint,
  orders bigint,
  revenue numeric,
  lifetime_units bigint,
  lifetime_orders bigint,
  lifetime_revenue numeric,
  first_order_date timestamptz,
  last_order_date timestamptz,
  total_count bigint
)
language sql stable set search_path = public
as $$
  with life as (
    select
      coalesce(nullif(i.sku, ''), '(no sku)') as sku,
      mode() within group (order by i.product_name) as product_name,
      count(*)::bigint as l_units,
      count(distinct i.order_number)::bigint as l_orders,
      coalesce(sum(i.price), 0) as l_revenue,
      min(o.order_date) as first_order_date,
      max(o.order_date) as last_order_date,
      count(*) filter (
        where (p_from is null or o.order_date >= p_from)
          and (p_to is null or o.order_date < p_to)
      )::bigint as r_units,
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
    where o.order_status not in ('Cancelled')
    group by 1
  ),
  universe as (
    select s.sku, s.product_name, s.category, s.vendor, s.ecom_stock, s.sap_stock
    from public.stock_items s
    union all
    -- SKUs that sold but never made it into the catalog file
    select l.sku, l.product_name, null::text, null::text, null::integer, null::integer
    from life l
    where not exists (select 1 from public.stock_items s2 where s2.sku = l.sku)
  ),
  joined as (
    select
      u.sku,
      coalesce(nullif(u.product_name, ''), l.product_name, u.sku) as product_name,
      u.category,
      u.vendor,
      u.ecom_stock,
      u.sap_stock,
      coalesce(l.r_units, 0)::bigint as units,
      coalesce(l.r_orders, 0)::bigint as orders,
      coalesce(l.r_revenue, 0) as revenue,
      coalesce(l.l_units, 0)::bigint as lifetime_units,
      coalesce(l.l_orders, 0)::bigint as lifetime_orders,
      coalesce(l.l_revenue, 0) as lifetime_revenue,
      l.first_order_date,
      l.last_order_date
    from universe u
    left join life l on l.sku = u.sku
  ),
  filtered as (
    select * from joined j
    where (
        p_search is null or p_search = ''
        or j.product_name ilike '%' || p_search || '%'
        or j.sku ilike '%' || p_search || '%'
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
    f.units, f.orders, f.revenue,
    f.lifetime_units, f.lifetime_orders, f.lifetime_revenue,
    f.first_order_date, f.last_order_date,
    count(*) over ()::bigint as total_count
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
       when 'last_sale' then coalesce(extract(epoch from f.last_order_date), 0)::numeric
       else f.units::numeric
     end) asc nulls last,
    f.sku asc
  limit greatest(coalesce(p_limit, 100), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke execute on function public.fn_catalog_products(timestamptz, timestamptz, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.fn_catalog_products(timestamptz, timestamptz, text, text, text, text, integer, integer) to authenticated;

-- Totals strip for the Products page: same universe/filters, one row.
drop function if exists public.fn_catalog_products_totals(timestamptz, timestamptz, text, text);
create or replace function public.fn_catalog_products_totals(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_search text default null,
  p_scope text default 'all'
)
returns table (
  products bigint,
  never_sold bigint,
  out_of_stock bigint,
  units bigint,
  orders bigint,
  revenue numeric,
  lifetime_units bigint,
  lifetime_revenue numeric
)
language sql stable set search_path = public
as $$
  with rows as (
    select * from public.fn_catalog_products(p_from, p_to, p_search, p_scope, 'units', 'desc', 1000000, 0)
  )
  select
    count(*)::bigint,
    count(*) filter (where lifetime_units = 0)::bigint,
    count(*) filter (where coalesce(ecom_stock, 0) <= 0)::bigint,
    coalesce(sum(units), 0)::bigint,
    coalesce(sum(orders), 0)::bigint,
    coalesce(sum(revenue), 0),
    coalesce(sum(lifetime_units), 0)::bigint,
    coalesce(sum(lifetime_revenue), 0)
  from rows;
$$;

revoke execute on function public.fn_catalog_products_totals(timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.fn_catalog_products_totals(timestamptz, timestamptz, text, text) to authenticated;
