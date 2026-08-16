-- ============================================================
-- Migration 101: a shelf floor of 20 across the catalogue generated a
-- 1,031-line move list, and 476 of those lines asked the warehouse for
-- one to four copies. The user's words: "too much to move".
--
-- The mechanism: min 20 makes every listed book below 20 a `need`, SAP
-- caps the move at what it holds, and for hundreds of slow titles that
-- is a top-up of 2 or 3 onto a shelf that already holds 15. Each is a
-- warehouse trip for nothing.
--
-- New p_min_move_line (default 5): a proposed move smaller than this is
-- dropped when the store already holds at least that many; a shelf that
-- is nearly empty still takes whatever SAP has. shortfall is untouched
-- (purchasing still needs the demand signal), and a row the threshold
-- zeroes out with nothing to reorder falls back to 'ok' instead of
-- sitting on Replenish as a "move" of zero.
--
-- Measured on the settings the user was running (window 30, cover 15,
-- min 20, scope sold_ever, bestseller 50, max 100, ads off):
--   1,031 lines / 5,751 copies  ->  637 lines / 4,713 copies at 5.
-- Also p_ad_days now defaults to 0 — ads are out of the picture until
-- asked for again; the column and the join stay for when they are.
--
-- Run after 100_stock_min_shelf.sql
-- ============================================================

drop function if exists public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text);
drop function if exists public.fn_stock_engine_json(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text);

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
  -- 0 = ads play no part; the join stays for when they are wanted again
  p_ad_days integer default 0,
  p_unlimited_at integer default 5000,
  p_overstock_min integer default 20,
  -- who the floor applies to: 'listed' | 'sold_ever' | 'selling'
  p_min_scope text default 'listed',
  -- a top-up smaller than this is not worth a warehouse trip unless the
  -- store itself is already below it
  p_min_move_line integer default 5
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
      end as surplus_calc,
      -- what SAP can actually give: the ask, capped by the warehouse and by
      -- p_max_order — before asking whether it is worth a trip
      case
        when coalesce(e.sap_stock,0) < p_min_sap_move then 0
        when e.is_relist then
          least(greatest(e.need, ceil(e.hist_velocity * p_coverage_days), p_relist_qty), e.sap_stock, p_max_order)
        else least(least(e.need, coalesce(e.sap_stock, e.need)), p_max_order)
      end as raw_move
    from eng e
  ),
  lined as (
    select f.*,
      -- a top-up of two or three copies onto a shelf that already holds
      -- fifteen is a warehouse trip for nothing; a shelf that is nearly
      -- empty takes whatever SAP has
      case
        when f.raw_move > 0 and f.raw_move < p_min_move_line
             and coalesce(f.ecom_stock, 0) >= p_min_move_line then 0
        else f.raw_move
      end as move_final
    from final f
  )
  select
    l.sku, l.product_name, l.category,
    l.units::bigint,
    round(l.velocity, 3) as velocity,
    round(l.forecast, 1) as forecast,
    l.min_applied::integer,
    l.target::numeric,
    l.ecom_stock, l.sap_stock,
    case when l.ecom_stock is null or l.is_unlimited or l.velocity = 0 then null
         else round(l.ecom_stock / l.velocity, 1) end as cover_days,
    l.need::numeric,
    l.move_final::numeric as move_qty,
    -- whatever SAP cannot cover stays here for purchasing, trip or no trip
    greatest(l.need - coalesce(l.sap_stock, 0), 0)::numeric as shortfall,
    l.surplus_calc::numeric as surplus,
    case
      when coalesce(l.ecom_stock,0) = 0 and coalesce(l.sap_stock,0) = 0 and l.lifetime_units > 0 then 'oos_reorder'
      -- reading zero on the store is a fact about the listing, not a
      -- quantity band: tested before need so the shelf floor cannot empty
      -- this bucket back out
      when l.is_relist then 'relist'
      when l.need > 0 and coalesce(l.sap_stock,0) < l.need then 'low_sap'
      -- a line the trip threshold zeroed out with nothing to reorder is
      -- not a task for anyone
      when l.need > 0 and l.move_final > 0 then 'move'
      when l.ecom_stock is null and coalesce(l.sap_stock,0) >= p_min_sap_move
           and l.lifetime_units = 0 then 'never_listed'
      when not l.is_unlimited and not l.on_ads and l.lifetime_units > 0
           and coalesce(l.surplus_calc, 0) >= p_overstock_min then 'overstock'
      else 'ok'
    end as status,
    l.vendor, l.cost, round(l.avg_price, 2) as avg_price,
    l.lifetime_units::bigint, l.last_order_date,
    round(l.hist_velocity, 3) as hist_velocity,
    l.expected::numeric,
    l.on_ads, round(coalesce(l.ad_spend, 0), 2) as ad_spend,
    l.is_unlimited,
    (l.lifetime_units = 0) as never_sold
  from lined l
  order by l.need desc, l.units desc, l.lifetime_units desc;
$$;

alter function public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer)
  set work_mem = '24MB';

grant execute on function public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer)
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
  p_ad_days integer default 0,
  p_unlimited_at integer default 5000,
  p_overstock_min integer default 20,
  p_min_scope text default 'listed',
  p_min_move_line integer default 5
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
    p_ad_days, p_unlimited_at, p_overstock_min, p_min_scope, p_min_move_line
  ) e;
$$;

grant execute on function public.fn_stock_engine_json(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer)
  to authenticated;
