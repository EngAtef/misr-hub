-- ============================================================
-- Migration 065: count copies sold, not order lines.
--
-- OrderExport has no quantity column — it packs a whole order into one
-- row with pipe-separated product names/SKUs/prices — so order_items
-- stores one row per (order, SKU) no matter how many copies were bought.
-- Every function that counted units as count(*) over order_items was
-- therefore undercounting: 104,668 lines vs 109,251 real copies in the
-- current data (4.6% low, 3,277 lines have quantity > 1).
--
-- ProductSalesExport does carry Quantity, already loaded into
-- product_sales keyed (order_id, sku) — the same key order_items has.
-- fn_top_products_units (Reports) was already built on it; these
-- functions now agree with it. Revenue is untouched: order_items.price
-- is the line total, so it was always correct.
--
-- The join is LEFT with a fallback of 1, so lines with no product_sales
-- match (506 today) still count as one copy rather than vanishing.
-- Run after 064_stock_engine_lifetime.sql
-- ============================================================

-- No index needed for the join: product_sales_pkey is already a unique
-- btree on exactly (order_id, sku).

-- ---- fn_top_products: quantity really means quantity now -----------
create or replace function public.fn_top_products(p_from timestamptz, p_to timestamptz, p_limit integer default 25)
returns table (product_name text, sku text, quantity bigint, revenue numeric)
language sql stable set search_path = public
as $$
  select
    coalesce(i.product_name, '(unknown)') as product_name,
    max(i.sku) as sku,
    sum(coalesce(ps.quantity, 1))::bigint as quantity,
    coalesce(sum(i.price), 0) as revenue
  from public.order_items i
  join public.orders o on o.order_number = i.order_number
  left join public.product_sales ps on ps.order_id = i.order_number and ps.sku = i.sku
  where (p_from is null or o.order_date >= p_from)
    and (p_to is null or o.order_date < p_to)
    and o.order_status not in ('Cancelled')
  group by 1
  order by 3 desc
  limit p_limit;
$$;

-- ---- fn_product_stats ----------------------------------------------
create or replace function public.fn_product_stats(p_from timestamptz, p_to timestamptz, p_search text default null, p_limit integer default 200)
returns table (sku text, product_name text, units bigint, orders bigint, revenue numeric)
language sql stable set search_path = public
as $$
  select
    coalesce(nullif(i.sku, ''), '(no sku)') as sku,
    mode() within group (order by i.product_name) as product_name,
    sum(coalesce(ps.quantity, 1))::bigint as units,
    count(distinct i.order_number) as orders,
    coalesce(sum(i.price), 0) as revenue
  from public.order_items i
  join public.orders o on o.order_number = i.order_number
  left join public.product_sales ps on ps.order_id = i.order_number and ps.sku = i.sku
  where o.order_status not in ('Cancelled')
    and (p_from is null or o.order_date >= p_from)
    and (p_to is null or o.order_date < p_to)
    and (p_search is null or p_search = '' or i.product_name ilike '%'||p_search||'%' or i.sku ilike '%'||p_search||'%')
  group by 1
  order by units desc
  limit p_limit;
$$;

-- ---- fn_catalog_products: units + lifetime units --------------------
drop function if exists public.fn_catalog_products(timestamptz, timestamptz, text, text, text, text, integer, integer);
create or replace function public.fn_catalog_products(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_search text default null,
  p_scope text default 'all',
  p_sort text default 'units',
  p_dir text default 'desc',
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  sku text, product_name text, category text, vendor text,
  ecom_stock integer, sap_stock integer,
  price numeric, image text, author text, publisher text,
  language text, age text, series text, barcode text,
  units bigint, orders bigint, revenue numeric,
  lifetime_units bigint, lifetime_orders bigint, lifetime_revenue numeric,
  first_order_date timestamptz, last_order_date timestamptz,
  total_count bigint
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
    left join public.product_sales ps on ps.order_id = i.order_number and ps.sku = i.sku
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
      l.last_order_date
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
       when 'price' then coalesce(f.price, 0)
       when 'last_sale' then coalesce(extract(epoch from f.last_order_date), 0)::numeric
       else f.units::numeric
     end) asc nulls last,
    f.sku asc
  limit greatest(coalesce(p_limit, 100), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke execute on function public.fn_catalog_products(timestamptz, timestamptz, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.fn_catalog_products(timestamptz, timestamptz, text, text, text, text, integer, integer) to authenticated;

drop function if exists public.fn_catalog_products_totals(timestamptz, timestamptz, text, text);
create or replace function public.fn_catalog_products_totals(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_search text default null,
  p_scope text default 'all'
)
returns table (
  products bigint, never_sold bigint, out_of_stock bigint,
  units bigint, orders bigint, revenue numeric,
  lifetime_units bigint, lifetime_revenue numeric
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
    coalesce(sum(r.lifetime_revenue), 0)
  from r;
$$;

revoke execute on function public.fn_catalog_products_totals(timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.fn_catalog_products_totals(timestamptz, timestamptz, text, text) to authenticated;

-- ---- fn_stock_engine: velocity from real copies ---------------------
-- A 4.6% undercount here systematically under-orders every restock.
drop function if exists public.fn_stock_engine(integer, integer, integer, integer, integer, integer);
create function public.fn_stock_engine(
  p_window_days integer default 30,
  p_coverage_days integer default 45,
  p_global_min integer default 0,
  p_bestseller_min integer default 20,
  p_bestseller_units integer default 20,
  p_max_order integer default 300
)
returns table (
  sku text, product_name text, category text,
  units bigint, velocity numeric, forecast numeric,
  min_applied integer, target numeric,
  ecom_stock integer, sap_stock integer,
  cover_days numeric, need numeric, move_qty numeric, shortfall numeric,
  surplus numeric, status text,
  vendor text, cost numeric, avg_price numeric,
  lifetime_units bigint, last_order_date timestamptz
)
language sql stable set search_path = public
as $$
  with sales as (
    select coalesce(nullif(i.sku,''),'(no sku)') as sku,
      mode() within group (order by i.product_name) as product_name,
      coalesce(sum(coalesce(ps.quantity, 1)) filter (
        where o.order_date >= now() - make_interval(days => p_window_days)), 0) as units,
      coalesce(sum(coalesce(ps.quantity, 1)) filter (
        where o.order_date >= now() - make_interval(days => p_window_days*4)
          and o.order_date < now() - make_interval(days => p_window_days)), 0) as units_hist,
      coalesce(sum(coalesce(ps.quantity, 1)), 0) as lifetime_units,
      max(o.order_date) as last_order_date,
      avg(nullif(i.price, 0)) filter (
        where o.order_date >= now() - make_interval(days => p_window_days*4)
      ) as avg_price
    from public.order_items i
    join public.orders o on o.order_number = i.order_number
    left join public.product_sales ps on ps.order_id = i.order_number and ps.sku = i.sku
    where o.order_status not in ('Cancelled')
    group by 1
  ),
  merged as (
    select
      coalesce(s.sku, st.sku) as sku,
      coalesce(s.product_name, st.product_name, p.name) as product_name,
      coalesce(st.category, p.section) as category,
      coalesce(s.units, 0) as units,
      coalesce(s.units_hist, 0) as units_hist,
      coalesce(s.lifetime_units, 0) as lifetime_units,
      s.last_order_date,
      coalesce(s.avg_price, p.price) as avg_price,
      st.ecom_stock, st.sap_stock, st.min_override,
      coalesce(st.vendor, p.vendor, p.publisher) as vendor,
      st.cost
    from sales s
    full outer join public.stock_items st on st.sku = s.sku
    left join public.products p on p.sku = coalesce(s.sku, st.sku)
  ),
  calc as (
    select m.*,
      m.units::numeric / greatest(p_window_days,1) as velocity,
      (m.units::numeric / greatest(p_window_days,1)) * p_coverage_days as forecast,
      coalesce(
        m.min_override,
        case when m.units >= p_bestseller_units then greatest(p_bestseller_min, p_global_min)
             when m.units > 0 then p_global_min
             else 0 end
      ) as min_applied
    from merged m
    where m.lifetime_units > 0 or coalesce(m.ecom_stock,0) > 0 or coalesce(m.sap_stock,0) > 0
  ),
  eng as (
    select c.*,
      greatest(ceil(c.forecast), c.min_applied) as target,
      greatest(greatest(ceil(c.forecast), c.min_applied) - coalesce(c.ecom_stock, 0), 0) as need
    from calc c
  )
  select
    e.sku, e.product_name, e.category,
    e.units::bigint,
    round(e.velocity, 3) as velocity,
    round(e.forecast, 1) as forecast,
    e.min_applied::integer,
    e.target::numeric,
    e.ecom_stock, e.sap_stock,
    case when e.ecom_stock is null or e.velocity = 0 then null
         else round(e.ecom_stock / e.velocity, 1) end as cover_days,
    e.need::numeric,
    least(least(e.need, coalesce(e.sap_stock, e.need)), p_max_order)::numeric as move_qty,
    greatest(e.need - coalesce(e.sap_stock, 0), 0)::numeric as shortfall,
    case when e.ecom_stock is not null then greatest(coalesce(e.ecom_stock,0) - ceil(e.forecast), 0) else null end::numeric as surplus,
    case
      when coalesce(e.ecom_stock,0) = 0 and coalesce(e.sap_stock,0) = 0 and e.lifetime_units > 0 then 'oos_reorder'
      when e.need > 0 and coalesce(e.sap_stock,0) < e.need then 'low_sap'
      when e.need > 0 then 'move'
      when e.ecom_stock is not null and coalesce(e.ecom_stock,0) - ceil(e.forecast) > greatest(e.target,10) then 'overstock'
      else 'ok'
    end as status,
    e.vendor, e.cost, round(e.avg_price, 2) as avg_price,
    e.lifetime_units::bigint, e.last_order_date
  from eng e
  order by e.need desc, e.units desc, e.lifetime_units desc;
$$;

revoke execute on function public.fn_stock_engine(integer, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.fn_stock_engine(integer, integer, integer, integer, integer, integer) to authenticated;
