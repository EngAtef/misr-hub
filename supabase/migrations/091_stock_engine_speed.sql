-- ============================================================
-- Migration 091: the Stock page 500s — fn_stock_engine crosses the
-- 8s statement_timeout on a cold cache.
--
-- Measured: 1.7s warm, 8.4s cold, timeout 8s. So the page worked when
-- someone had just loaded it and failed after any idle period — and the
-- failure surfaces as an empty page with a 500 in the console, not as
-- anything that says "too slow".
--
-- 97% of the work was one join. The velocity figures read copies sold as
-- coalesce(ps.quantity, 1), so product_sales only matters where quantity
-- is neither null nor 1 — 3,331 rows out of 106,381. Every other row
-- contributes exactly 1 whether it is joined or not. The planner did not
-- know that: it nested-looped 102,557 index probes through
-- product_sales_pkey behind a Memoize that never hit once (0 hits,
-- 70,721 evictions), for 410,228 of the function's 422,401 buffer hits.
--
-- Pushing the condition into the join lets the existing partial index
-- idx_product_sales_qty_multi supply those 3,331 rows as a small hash.
-- Verified equal on every SKU before applying: 2,836 SKUs compared, 0
-- mismatches, lifetime total 107,341 both ways.
--
-- Nothing else about the engine changes — same columns, same statuses,
-- same relist and min-SAP rules as 089.
-- Run after 090_segments_center.sql
-- ============================================================

create or replace function public.fn_stock_engine(
  p_window_days integer default 30,
  p_coverage_days integer default 45,
  p_global_min integer default 0,
  p_bestseller_min integer default 20,
  p_bestseller_units integer default 20,
  p_max_order integer default 300,
  p_min_sap_move integer default 2,
  p_relist_qty integer default 10
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
      min(o.order_date) as first_order_date,
      max(o.order_date) as last_order_date,
      avg(nullif(i.price, 0)) filter (
        where o.order_date >= now() - make_interval(days => p_window_days*4)
      ) as avg_price
    from public.order_items i
    join public.orders o on o.order_number = i.order_number
    -- only a quantity that is neither null nor 1 can move the total, and
    -- there is a partial index on exactly those rows; every other row
    -- coalesces to 1 whether it joins or not
    left join public.product_sales ps
      on ps.order_id = i.order_number and ps.sku = i.sku
     and ps.quantity is not null and ps.quantity <> 1
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
      s.first_order_date,
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
      -- the rate it sold at across its whole selling life, which is the
      -- only rate a book at zero on the store still has
      m.lifetime_units::numeric / greatest(
        coalesce(m.last_order_date::date - m.first_order_date::date, 30), 30
      ) as hist_velocity,
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
      greatest(greatest(ceil(c.forecast), c.min_applied) - coalesce(c.ecom_stock, 0), 0) as need,
      (c.ecom_stock = 0 and coalesce(c.sap_stock,0) >= p_min_sap_move and c.lifetime_units > 0) as is_relist
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
    case
      when coalesce(e.sap_stock,0) < p_min_sap_move then 0
      when e.need = 0 and e.is_relist then
        least(greatest(ceil(e.hist_velocity * p_coverage_days), p_relist_qty), e.sap_stock, p_max_order)
      else least(least(e.need, coalesce(e.sap_stock, e.need)), p_max_order)
    end::numeric as move_qty,
    greatest(e.need - coalesce(e.sap_stock, 0), 0)::numeric as shortfall,
    case when e.ecom_stock is not null then greatest(coalesce(e.ecom_stock,0) - ceil(e.forecast), 0) else null end::numeric as surplus,
    case
      when coalesce(e.ecom_stock,0) = 0 and coalesce(e.sap_stock,0) = 0 and e.lifetime_units > 0 then 'oos_reorder'
      when e.need > 0 and coalesce(e.sap_stock,0) < e.need then 'low_sap'
      when e.need > 0 then 'move'
      when e.is_relist then 'relist'
      when e.ecom_stock is not null and coalesce(e.ecom_stock,0) - ceil(e.forecast) > greatest(e.target,10) then 'overstock'
      else 'ok'
    end as status,
    e.vendor, e.cost, round(e.avg_price, 2) as avg_price,
    e.lifetime_units::bigint, e.last_order_date
  from eng e
  order by e.need desc, e.units desc, e.lifetime_units desc;
$$;

-- With the join fixed the remaining cost was the mode() ordered-set
-- aggregate, which must sort ~102k (sku, product_name) pairs — about 8MB,
-- just over the default work_mem, so it spilled to disk and cost 3.4s of
-- temp I/O by itself. The grant is attached to the function, so it does
-- not change work_mem for anything else the connection runs.
alter function public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer)
  set work_mem = '24MB';

-- Measured end to end on the same call the Stock page makes:
--   before  8,394 ms   422,401 buffers   8 MB spilled to disk
--   after     429 ms    12,269 buffers   no spill
