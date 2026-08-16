-- ============================================================
-- Migration 100: every book the store carries holds at least
-- p_global_min copies (20), and when SAP cannot cover the gap we move
-- what SAP has and report the rest as a shortfall to reorder.
--
-- Two things had to change for that to mean anything:
--
-- 1. The floor was gated on recent sales. min_applied read
--      units >= bestseller_units -> max(bestseller_min, global_min)
--      units > 0                 -> global_min
--      else                      -> 0
--    and 1,975 of the 3,389 books the store lists sold nothing in the
--    window, so they were floored at 0 — a "global" minimum that skipped
--    58% of the shelf. The gate is now p_min_scope: 'listed' (default,
--    every SKU the store carries), 'sold_ever', or 'selling' (the old
--    behaviour, kept so the previous numbers are reproducible).
--
-- 2. The floor must not reach books the store does not carry.
--    ecom_stock IS NULL means "not on the store" (migration 082); left
--    ungated, a floor of 20 would invent need = 20 for all 806
--    never-listed warehouse SKUs and flood Replenish with books nobody
--    has decided to sell. NULL and the unlimited sentinel are floored at
--    0. Verified after applying: 0 null-ecom SKUs carry a floor or a
--    need, 0 unlimited SKUs carry a floor.
--
-- And one consequence worth naming: a relist book (zero on the store,
-- copies in SAP, has sold before) now has need = 20, so under the old
-- CASE order it would have matched 'move'/'low_sap' first and the "In
-- Warehouse, Not on Store" tab would have emptied back out — 116 rows to
-- 0, the very fault 099 was written to fix. Reading zero on the store is
-- a fact about the listing, not a quantity band, so is_relist is now
-- tested before the need branches and keeps its own bucket. Its move qty
-- takes the larger of the new floor and the old lifetime-velocity
-- estimate.
--
-- Impact at p_global_min = 20, p_min_scope = 'listed':
--   move        804 SKUs   5,200 copies SAP can send now
--   low_sap     935 SKUs   2,105 from SAP + 13,284 short
--   relist      116 SKUs     890 from SAP +  1,439 short
--   oos_reorder 203 SKUs                     3,875 short
--   -> 8,195 copies to move, 18,598 to reorder from publishers.
-- No move_qty anywhere exceeds the SKU's SAP stock.
--
-- Run after 099_stock_engine_v3.sql
-- ============================================================

drop function if exists public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer);

create or replace function public.fn_stock_engine(
  p_window_days integer default 30,
  p_coverage_days integer default 45,
  -- the shelf floor: no book the store carries sits below this
  p_global_min integer default 20,
  p_bestseller_min integer default 20,
  p_bestseller_units integer default 20,
  p_max_order integer default 300,
  p_min_sap_move integer default 2,
  p_relist_qty integer default 10,
  p_ad_days integer default 30,
  p_unlimited_at integer default 5000,
  p_overstock_min integer default 20,
  -- who the floor applies to: 'listed' | 'sold_ever' | 'selling'
  p_min_scope text default 'listed'
)
returns table (
  sku text, product_name text, category text,
  units bigint, velocity numeric, forecast numeric,
  min_applied integer, target numeric,
  ecom_stock integer, sap_stock integer,
  cover_days numeric, need numeric, move_qty numeric, shortfall numeric,
  surplus numeric, status text,
  vendor text, cost numeric, avg_price numeric,
  lifetime_units bigint, last_order_date timestamptz,
  hist_velocity numeric, expected numeric,
  on_ads boolean, ad_spend numeric,
  is_unlimited boolean, never_sold boolean
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
    left join public.product_sales ps
      on ps.order_id = i.order_number and ps.sku = i.sku
     and ps.quantity is not null and ps.quantity <> 1
    where o.order_status not in ('Cancelled')
    group by 1
  ),
  ads as (
    select coalesce(a.spend, 0) as spend,
           coalesce(ma.skus, mc.skus) as skus
    from public.ad_insights a
    left join public.ad_map_effective ma
      on ma.match_level = 'ad' and ma.active and ma.pattern = public.norm_ad(a.ad_name)
    left join public.ad_map_effective mc
      on mc.match_level = 'campaign' and mc.active and mc.pattern = public.norm_ad(a.campaign_name)
    where p_ad_days > 0
      and a.level = 'ad'
      and a.period_end >= current_date - p_ad_days
      and coalesce(a.spend, 0) > 0
  ),
  ad_sku as (
    select u.sku, sum(a.spend) as ad_spend
    from ads a
    cross join lateral unnest(coalesce(a.skus, '{}'::text[])) as u(sku)
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
      m.lifetime_units::numeric / greatest(
        coalesce(m.last_order_date::date - m.first_order_date::date, 30), 30
      ) as hist_velocity,
      coalesce(
        m.min_override,
        case
          -- the floor is about what the store carries: a SKU with no
          -- e-commerce record is not on the shelf, and one reading the
          -- unlimited sentinel never runs down
          when m.ecom_stock is null then 0
          when m.ecom_stock >= p_unlimited_at then 0
          when m.units >= p_bestseller_units then greatest(p_bestseller_min, p_global_min)
          when p_min_scope = 'selling'   and m.units = 0 then 0
          when p_min_scope = 'sold_ever' and m.lifetime_units = 0 then 0
          else p_global_min
        end
      ) as min_applied
    from merged m
    where m.lifetime_units > 0 or coalesce(m.ecom_stock,0) > 0 or coalesce(m.sap_stock,0) > 0
  ),
  eng as (
    select c.*,
      a.ad_spend,
      (a.ad_spend is not null) as on_ads,
      (c.ecom_stock is not null and c.ecom_stock >= p_unlimited_at) as is_unlimited,
      greatest(ceil(c.forecast), c.min_applied) as target,
      greatest(greatest(ceil(c.forecast), c.min_applied) - coalesce(c.ecom_stock, 0), 0) as need,
      (c.ecom_stock = 0 and coalesce(c.sap_stock,0) >= p_min_sap_move and c.lifetime_units > 0) as is_relist,
      ceil(greatest(c.velocity, case when c.lifetime_units > 0 then c.hist_velocity else 0 end)
           * p_coverage_days) as expected
    from calc c
    left join ad_sku a on a.sku = c.sku
  ),
  final as (
    select e.*,
      case
        when e.ecom_stock is null or e.is_unlimited then null
        else greatest(e.ecom_stock - e.expected, 0)
      end as surplus_calc
    from eng e
  )
  select
    f.sku, f.product_name, f.category,
    f.units::bigint,
    round(f.velocity, 3) as velocity,
    round(f.forecast, 1) as forecast,
    f.min_applied::integer,
    f.target::numeric,
    f.ecom_stock, f.sap_stock,
    case when f.ecom_stock is null or f.is_unlimited or f.velocity = 0 then null
         else round(f.ecom_stock / f.velocity, 1) end as cover_days,
    f.need::numeric,
    -- what SAP can actually give: the ask, capped by the warehouse and by
    -- p_max_order. Whatever SAP cannot cover stays in `shortfall`.
    case
      when coalesce(f.sap_stock,0) < p_min_sap_move then 0
      when f.is_relist then
        least(greatest(f.need, ceil(f.hist_velocity * p_coverage_days), p_relist_qty), f.sap_stock, p_max_order)
      else least(least(f.need, coalesce(f.sap_stock, f.need)), p_max_order)
    end::numeric as move_qty,
    greatest(f.need - coalesce(f.sap_stock, 0), 0)::numeric as shortfall,
    f.surplus_calc::numeric as surplus,
    case
      when coalesce(f.ecom_stock,0) = 0 and coalesce(f.sap_stock,0) = 0 and f.lifetime_units > 0 then 'oos_reorder'
      -- reading zero on the store is a fact about the listing, not a
      -- quantity band: tested before need so the shelf floor cannot empty
      -- this bucket back out
      when f.is_relist then 'relist'
      when f.need > 0 and coalesce(f.sap_stock,0) < f.need then 'low_sap'
      when f.need > 0 then 'move'
      when f.ecom_stock is null and coalesce(f.sap_stock,0) >= p_min_sap_move
           and f.lifetime_units = 0 then 'never_listed'
      when not f.is_unlimited and not f.on_ads and f.lifetime_units > 0
           and coalesce(f.surplus_calc, 0) >= p_overstock_min then 'overstock'
      else 'ok'
    end as status,
    f.vendor, f.cost, round(f.avg_price, 2) as avg_price,
    f.lifetime_units::bigint, f.last_order_date,
    round(f.hist_velocity, 3) as hist_velocity,
    f.expected::numeric,
    f.on_ads, round(coalesce(f.ad_spend, 0), 2) as ad_spend,
    f.is_unlimited,
    (f.lifetime_units = 0) as never_sold
  from final f
  order by f.need desc, f.units desc, f.lifetime_units desc;
$$;

alter function public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text)
  set work_mem = '24MB';

grant execute on function public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text)
  to authenticated;

-- the jsonb wrapper has to follow the signature (see 099 for why it exists)
create or replace function public.fn_stock_engine_json(
  p_window_days integer default 30,
  p_coverage_days integer default 45,
  p_global_min integer default 20,
  p_bestseller_min integer default 20,
  p_bestseller_units integer default 20,
  p_max_order integer default 300,
  p_min_sap_move integer default 2,
  p_relist_qty integer default 10,
  p_ad_days integer default 30,
  p_unlimited_at integer default 5000,
  p_overstock_min integer default 20,
  p_min_scope text default 'listed'
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(to_jsonb(e) order by e.need desc, e.units desc, e.lifetime_units desc),
    '[]'::jsonb
  )
  from public.fn_stock_engine(
    p_window_days, p_coverage_days, p_global_min, p_bestseller_min,
    p_bestseller_units, p_max_order, p_min_sap_move, p_relist_qty,
    p_ad_days, p_unlimited_at, p_overstock_min, p_min_scope
  ) e;
$$;

grant execute on function public.fn_stock_engine_json(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text)
  to authenticated;
