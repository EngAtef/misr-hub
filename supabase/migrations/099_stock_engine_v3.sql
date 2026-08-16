-- ============================================================
-- Migration 099: the Stock page was judging the catalogue on a
-- thousand rows, counting a pivot-table footer as a warehouse, and
-- calling deliberately stocked books "overstock".
--
-- Four separate faults, all visible on one screen:
--
-- 1. TRUNCATION. The page calls fn_stock_engine straight through
--    supabase.rpc(), and PostgREST caps every response at max-rows =
--    1,000 with no error (see src/lib/rpc-all.ts). The engine returns
--    4,500 rows. Because the ORDER BY is `need desc, units desc`, the
--    1,000 that survived were the ones with demand — so every bucket
--    whose defining trait is need = 0 was cut off mid-list:
--      status          in DB    on screen
--      relist            107        0
--      overstock       2,013      732
--      oos_reorder       203       14
--    "In Warehouse, Not on Store" showing (0) was not a rule bug: a
--    relist row has need = 0 and zero recent units, so it sorted last
--    and none of the 107 made the cut. Fixed client-side with rpcAll().
--
-- 2. A PIVOT FOOTER BECAME A SKU. stock_items holds a row with
--    sku = 'Grand Total' and sap_stock = 964,235 — half of the 1,923,910
--    the page reported as warehouse stock. parseStockFile assumed the
--    SAP total row carries no Material; in the pivoted export the label
--    "Grand Total" lands in the Material column itself. Real SAP stock
--    is 959,675. Row deleted here, parser guarded in parse-stock.ts.
--
-- 3. 99,996 IS NOT A QUANTITY. 72 SKUs (school-book titles) read
--    exactly 99,996 on the store — the platform's "unlimited / made to
--    order" sentinel. They accounted for 7,199,712 of the 7,274,818
--    units the store claimed to hold: 99% of reported e-com stock was
--    one magic number. They are now flagged is_unlimited and can never
--    be surplus.
--
-- 4. OVERSTOCK IGNORED WHY THE STOCK IS THERE. The old rule was
--    ecom_stock - ceil(forecast) > greatest(target, 10), and forecast
--    comes from the last p_window_days only. A book with no sales in
--    the window scores forecast 0 and target 0, so eleven copies of
--    anything quiet was "overstock" — 1,020 of the 2,013 rows had zero
--    sales in the window. Worse, a book stocked up *for a campaign*
--    looks exactly like a book nobody wants. Now:
--      - demand comes from greatest(recent velocity, lifetime velocity),
--        so a book that sold 200 copies before the window still has a
--        demand rate and is not called surplus for one quiet month;
--      - a SKU carrying Meta spend in the last p_ad_days is never
--        overstock — the stock is there on purpose;
--      - a book that has never sold at all has no demand baseline, so
--        it is not "overstock" either; it is flagged never_sold;
--      - the surplus must clear p_overstock_min to be worth a row.
--    2,013 -> 390 actionable rows (73 unlimited, 138 on ads, 92 never
--    sold, the rest cleared by the lifetime-velocity floor).
--
-- Also new: status 'never_listed'. 806 SKUs hold 1.07m warehouse copies
-- with no e-commerce record at all (ecom_stock IS NULL means "not on the
-- store", per migration 082) and no online sales ever. They are the
-- literal reading of "in warehouse, not on store" and were in no bucket
-- before. 'relist' keeps its old, narrower meaning: was on the store,
-- reads 0 now, has sold before.
--
-- Run after 098_targets_orders_placed.sql
-- ============================================================

-- ----------------------------------------------------------- the footer
--
-- Not a material: an Excel pivot's grand-total label that landed in the
-- Material column. Deleted from the live table and from every snapshot
-- day it was stamped into, so history stops reporting it too.
delete from public.stock_snapshots where sku in ('Grand Total', 'Overall Result');
delete from public.stock_items    where sku in ('Grand Total', 'Overall Result');

-- ------------------------------------------------------------ the engine
--
-- The return type gains columns, so the old signature has to go rather
-- than be replaced in place.
drop function if exists public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer);

create or replace function public.fn_stock_engine(
  p_window_days integer default 30,
  p_coverage_days integer default 45,
  p_global_min integer default 0,
  p_bestseller_min integer default 20,
  p_bestseller_units integer default 20,
  p_max_order integer default 300,
  p_min_sap_move integer default 2,
  p_relist_qty integer default 10,
  -- a SKU with Meta spend inside this many days is stocked on purpose
  p_ad_days integer default 30,
  -- e-com stock at or above this is the platform's "unlimited" sentinel,
  -- not a count of anything
  p_unlimited_at integer default 5000,
  -- below this, a surplus is not worth a line in a report
  p_overstock_min integer default 20
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
  -- new in 099
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
    -- only a quantity that is neither null nor 1 can move the total, and
    -- there is a partial index on exactly those rows; every other row
    -- coalesces to 1 whether it joins or not
    left join public.product_sales ps
      on ps.order_id = i.order_number and ps.sku = i.sku
     and ps.quantity is not null and ps.quantity <> 1
    where o.order_status not in ('Cancelled')
    group by 1
  ),
  -- Which SKUs are we spending money on right now? Same resolution the
  -- Ads Center uses: an ad matches its own map row first, its campaign's
  -- second, and a list target expands to the list's SKUs (ad_map_effective).
  -- Spend is reported whole, not divided: it is the size of the campaign
  -- standing behind this book, not the book's share of it.
  ads as (
    select coalesce(a.spend, 0) as spend,
           coalesce(ma.skus, mc.skus) as skus
    from public.ad_insights a
    left join public.ad_map_effective ma
      on ma.match_level = 'ad' and ma.active and ma.pattern = public.norm_ad(a.ad_name)
    left join public.ad_map_effective mc
      on mc.match_level = 'campaign' and mc.active and mc.pattern = public.norm_ad(a.campaign_name)
    -- p_ad_days = 0 means "ignore ads entirely"; without this guard it
    -- would mean "ads that ran today", because current_date - 0 is today
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
      a.ad_spend,
      (a.ad_spend is not null) as on_ads,
      -- 99,996 on the store is the platform saying "unlimited", not a count
      (c.ecom_stock is not null and c.ecom_stock >= p_unlimited_at) as is_unlimited,
      greatest(ceil(c.forecast), c.min_applied) as target,
      greatest(greatest(ceil(c.forecast), c.min_applied) - coalesce(c.ecom_stock, 0), 0) as need,
      (c.ecom_stock = 0 and coalesce(c.sap_stock,0) >= p_min_sap_move and c.lifetime_units > 0) as is_relist,
      -- surplus is measured against the better of the two demand rates, so
      -- one quiet month cannot turn a proven book into dead weight
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
    case
      when coalesce(f.sap_stock,0) < p_min_sap_move then 0
      when f.need = 0 and f.is_relist then
        least(greatest(ceil(f.hist_velocity * p_coverage_days), p_relist_qty), f.sap_stock, p_max_order)
      else least(least(f.need, coalesce(f.sap_stock, f.need)), p_max_order)
    end::numeric as move_qty,
    greatest(f.need - coalesce(f.sap_stock, 0), 0)::numeric as shortfall,
    f.surplus_calc::numeric as surplus,
    case
      when coalesce(f.ecom_stock,0) = 0 and coalesce(f.sap_stock,0) = 0 and f.lifetime_units > 0 then 'oos_reorder'
      when f.need > 0 and coalesce(f.sap_stock,0) < f.need then 'low_sap'
      when f.need > 0 then 'move'
      when f.is_relist then 'relist'
      -- never had an e-commerce record and never sold online: warehouse
      -- stock the store has simply never carried
      when f.ecom_stock is null and coalesce(f.sap_stock,0) >= p_min_sap_move
           and f.lifetime_units = 0 then 'never_listed'
      -- a sentinel quantity, a live campaign, or no sale ever are each on
      -- their own enough to disqualify a surplus
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

-- The mode() ordered-set aggregate sorts ~102k (sku, product_name) pairs,
-- about 8MB — just over the default work_mem, so it spilled to disk and
-- cost 3.4s of temp I/O by itself (see 091). The grant rides on the
-- function, so nothing else on the connection is affected.
alter function public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer)
  set work_mem = '24MB';

grant execute on function public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer)
  to authenticated;

-- --------------------------------------------------------- one row out
--
-- rpcAll() is the house pattern for beating the 1,000-row cap, but it
-- beats it by calling the function once per page, and this function costs
-- ~550ms a run — paging 4,499 rows would spend ~2.8s repeating the same
-- scan five times. Returning a single jsonb value means max-rows never
-- applies at all: one row, one run, 2.4 MB. The engine above stays the
-- single source of truth; this only packages it.
create or replace function public.fn_stock_engine_json(
  p_window_days integer default 30,
  p_coverage_days integer default 45,
  p_global_min integer default 0,
  p_bestseller_min integer default 20,
  p_bestseller_units integer default 20,
  p_max_order integer default 300,
  p_min_sap_move integer default 2,
  p_relist_qty integer default 10,
  p_ad_days integer default 30,
  p_unlimited_at integer default 5000,
  p_overstock_min integer default 20
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
    p_ad_days, p_unlimited_at, p_overstock_min
  ) e;
$$;

grant execute on function public.fn_stock_engine_json(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer)
  to authenticated;
