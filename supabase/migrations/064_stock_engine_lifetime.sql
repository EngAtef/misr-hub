-- ============================================================
-- Migration 064: the stock engine forgot books that ran out.
--
-- fn_stock_engine only looked back p_window_days*4 (120 days by
-- default) and gated rows on:
--     units > 0 or units_hist >= 10 or ecom_stock > 0 or sap_stock > 0
-- So a book with 0 stock in BOTH the shop and SAP, whose last sales are
-- older than 120 days (or that sold 9 copies rather than 10), vanished
-- from the page entirely — exactly the books most in need of a reorder
-- decision. 166 SKUs with real sales history were invisible this way.
--
-- The gate is now "has ever sold, or has stock somewhere". Never-sold
-- books with no stock still stay out of the reorder engine — they belong
-- on the Products page, which lists the whole catalog. lifetime_units
-- and last_order_date come back with each row so a long-dormant
-- out-of-stock title can be judged on its full history.
-- Run after 063_products_catalog_store.sql
-- ============================================================

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
      count(*) filter (where o.order_date >= now() - make_interval(days => p_window_days)) as units,
      count(*) filter (where o.order_date >= now() - make_interval(days => p_window_days*4)
                         and o.order_date < now() - make_interval(days => p_window_days)) as units_hist,
      count(*) as lifetime_units,
      max(o.order_date) as last_order_date,
      avg(nullif(i.price, 0)) filter (
        where o.order_date >= now() - make_interval(days => p_window_days*4)
      ) as avg_price
    from public.order_items i
    join public.orders o on o.order_number = i.order_number
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
    -- anything that has ever sold, or that we hold stock of anywhere
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
    e.units,
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
      -- nothing left anywhere and the book has a sales record: reorder,
      -- however long ago those sales were
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
