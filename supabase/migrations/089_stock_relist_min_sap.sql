-- ============================================================
-- Migration 089: books sitting in the warehouse at zero on the store,
-- and move lists that ask for a copy the warehouse cannot spare.
--
-- Two faults, both visible on C010338120086P (مطلع النور) — 64 copies in
-- SAP on 9 Aug, 0 on the store, 9 lifetime sales, last one 11 Apr:
--
--  1) The engine forecasts from the last p_window_days of sales. A book
--     that is at zero on the store sells nothing, so velocity is 0,
--     target is 0, need is 0 and the status lands on 'ok' — a tab the
--     page never shows. The book was invisible on every tab and so
--     unfindable by search, unmovable, and its warehouse stock stranded.
--     That is censored demand, not absent demand: the reason it sold
--     nothing this month is that there was nothing to sell.
--     107 SKUs holding 2,231 copies were stuck this way.
--
--     New status 'relist': listed on the store, reads exactly 0 there,
--     has sold before, and the warehouse can spare copies. Its move
--     quantity comes from the rate it sold at while it *was* available
--     (lifetime units over its selling span), floored at p_relist_qty so
--     a slow seller still gets a shelf-worthy stack, and capped by what
--     SAP actually holds.
--
--  2) A move list would ask for a book with 1 copy in SAP. One copy is
--     not worth a warehouse trip and never gets moved, so the line just
--     rotted on the list (31 SKUs on today's numbers). move_qty is now 0
--     below p_min_sap_move; the row still shows, with its shortfall
--     intact, because purchasing still needs to know the demand exists.
--
-- Run after 088_gaps_adwaa_rules.sql
-- ============================================================

drop function if exists public.fn_stock_engine(integer, integer, integer, integer, integer, integer);
drop function if exists public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer);
create function public.fn_stock_engine(
  p_window_days integer default 30,
  p_coverage_days integer default 45,
  p_global_min integer default 0,
  p_bestseller_min integer default 20,
  p_bestseller_units integer default 20,
  p_max_order integer default 300,
  -- fewer copies than this in SAP and there is nothing worth moving
  p_min_sap_move integer default 2,
  -- the smallest stack worth putting back on the store
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
      -- on the store, reading zero, has sold before, and SAP can spare it
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
      -- one or zero copies in the warehouse: nothing to move, whatever
      -- the demand says
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
      -- checked after the need-driven states so a book the window already
      -- asks for keeps its louder status
      when e.is_relist then 'relist'
      when e.ecom_stock is not null and coalesce(e.ecom_stock,0) - ceil(e.forecast) > greatest(e.target,10) then 'overstock'
      else 'ok'
    end as status,
    e.vendor, e.cost, round(e.avg_price, 2) as avg_price,
    e.lifetime_units::bigint, e.last_order_date
  from eng e
  order by e.need desc, e.units desc, e.lifetime_units desc;
$$;

revoke execute on function public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer) to authenticated;
