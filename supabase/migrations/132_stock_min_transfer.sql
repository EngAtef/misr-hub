-- ============================================================
-- Migration 132: a per-book transfer floor the user controls.
--
-- "If I said minimum 20 and SAP has 6, the 6 should be the transfer."
-- p_min_transfer lifts every line that is getting a move anyway up to at
-- least this many copies — but never above what SAP actually holds, and
-- never above p_max_order. It only raises lines that already exist
-- (raw_move > 0): it does not invent a move for a book with no need, so
-- relist / never_listed / inactive semantics are untouched. Default 0 =
-- off, so nothing changes until the page sends a value.
--
-- Applied before the p_min_move_line trip check: a line the floor lifts
-- past the threshold is now worth the trip.
--
-- Engine body otherwise identical to 103; json wrapper identical to 116
-- (weight attach, no re-sort). Run after 131_global_target.sql
-- ============================================================

drop function if exists public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer, integer, integer);
drop function if exists public.fn_stock_engine_json(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer, integer, integer);

create or replace function public.fn_stock_engine(
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
  p_min_move_line integer default 5,
  p_recent_days integer default 7,
  p_surge_min integer default 5,
  -- new in 132: no transfer line smaller than this, SAP permitting
  p_min_transfer integer default 0
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
  is_unlimited boolean, never_sold boolean,
  recent_units bigint, surge boolean, is_active boolean,
  ecom_note text
)
language sql stable set search_path = public
as $$
  with sales as (
    select coalesce(nullif(i.sku,''),'(no sku)') as sku,
      mode() within group (order by i.product_name) as product_name,
      coalesce(sum(coalesce(ps.quantity, 1)) filter (
        where o.order_date >= now() - make_interval(days => p_window_days)), 0) as units,
      coalesce(sum(coalesce(ps.quantity, 1)) filter (
        where o.order_date >= now() - make_interval(days => p_recent_days)), 0) as units_recent,
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
      coalesce(s.units_recent, 0) as units_recent,
      coalesce(s.units_hist, 0) as units_hist,
      coalesce(s.lifetime_units, 0) as lifetime_units,
      s.first_order_date,
      s.last_order_date,
      coalesce(s.avg_price, p.price) as avg_price,
      st.ecom_stock, st.sap_stock, st.min_override,
      -- unknown counts as active: only an explicit 0 from the store file
      -- can switch a book off
      coalesce(st.ecom_active, true) as is_active,
      st.ecom_note,
      coalesce(st.vendor, p.vendor, p.publisher) as vendor,
      st.cost
    from sales s
    full outer join public.stock_items st on st.sku = s.sku
    left join public.products p on p.sku = coalesce(s.sku, st.sku)
  ),
  calc as (
    select m.*,
      -- the window rate, lifted to the recent rate when the recent stretch
      -- is both faster and big enough to mean something
      (m.units_recent >= p_surge_min
        and m.units_recent::numeric / greatest(p_recent_days,1) > m.units::numeric / greatest(p_window_days,1)) as surge,
      greatest(
        m.units::numeric / greatest(p_window_days,1),
        case when m.units_recent >= p_surge_min
             then m.units_recent::numeric / greatest(p_recent_days,1) else 0 end
      ) as velocity,
      m.lifetime_units::numeric / greatest(
        coalesce(m.last_order_date::date - m.first_order_date::date, 30), 30
      ) as hist_velocity,
      coalesce(
        m.min_override,
        case
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
      c.velocity * p_coverage_days as forecast,
      a.ad_spend,
      (a.ad_spend is not null) as on_ads,
      (c.ecom_stock is not null and c.ecom_stock >= p_unlimited_at) as is_unlimited,
      greatest(ceil(c.velocity * p_coverage_days), c.min_applied) as target,
      greatest(greatest(ceil(c.velocity * p_coverage_days), c.min_applied) - coalesce(c.ecom_stock, 0), 0) as need,
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
      -- what SAP can actually give, before asking whether it is worth a trip
      case
        when not e.is_active then 0
        when coalesce(e.sap_stock,0) < p_min_sap_move then 0
        when e.is_relist then
          least(greatest(e.need, ceil(e.hist_velocity * p_coverage_days), p_relist_qty), e.sap_stock, p_max_order)
        else least(least(e.need, coalesce(e.sap_stock, e.need)), p_max_order)
      end as raw_move
    from eng e
  ),
  floored as (
    select f.*,
      -- the transfer floor: a line that moves at all moves at least
      -- p_min_transfer copies — unless SAP holds fewer, in which case
      -- everything SAP has goes (minimum 20, SAP 6 → move 6)
      case
        when p_min_transfer > 0 and f.raw_move > 0
          then least(greatest(f.raw_move, p_min_transfer), coalesce(f.sap_stock, f.raw_move), p_max_order)
        else f.raw_move
      end as floored_move
    from final f
  ),
  lined as (
    select f.*,
      -- a top-up of two or three copies onto a shelf that already holds
      -- fifteen is a warehouse trip for nothing; a shelf that is nearly
      -- empty takes whatever SAP has
      case
        when f.floored_move > 0 and f.floored_move < p_min_move_line
             and coalesce(f.ecom_stock, 0) >= p_min_move_line then 0
        else f.floored_move
      end as move_final
    from floored f
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
    -- a switched-off book is nobody's shortfall either
    case when l.is_active then greatest(l.need - coalesce(l.sap_stock, 0), 0) else 0 end::numeric as shortfall,
    l.surplus_calc::numeric as surplus,
    case
      when not l.is_active then 'inactive'
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
    (l.lifetime_units = 0) as never_sold,
    l.units_recent::bigint as recent_units,
    l.surge,
    l.is_active,
    l.ecom_note
  from lined l
  order by l.need desc, l.units desc, l.lifetime_units desc;
$$;

alter function public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer, integer, integer, integer)
  set work_mem = '24MB';
grant execute on function public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer, integer, integer, integer)
  to authenticated;

-- the jsonb wrapper follows the signature (see 099 for why it exists;
-- 116 for the weight attach and why jsonb_agg keeps the engine's order)
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
  p_min_move_line integer default 5,
  p_recent_days integer default 7,
  p_surge_min integer default 5,
  p_min_transfer integer default 0
)
returns jsonb
language sql stable
set search_path = public
set work_mem = '32MB'
as $$
  select coalesce(jsonb_agg(
    to_jsonb(e) || jsonb_build_object(
      'unit_weight_kg', (select p.weight_kg from public.products p where p.sku = e.sku)
    )
  ), '[]'::jsonb)
  from public.fn_stock_engine(
    p_window_days, p_coverage_days, p_global_min, p_bestseller_min,
    p_bestseller_units, p_max_order, p_min_sap_move, p_relist_qty,
    p_ad_days, p_unlimited_at, p_overstock_min, p_min_scope, p_min_move_line,
    p_recent_days, p_surge_min, p_min_transfer
  ) e;
$$;
grant execute on function public.fn_stock_engine_json(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer, integer, integer, integer)
  to authenticated;
