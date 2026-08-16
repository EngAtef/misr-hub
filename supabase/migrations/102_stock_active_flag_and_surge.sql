-- ============================================================
-- Migration 102: two things the team's hand-made restock lists knew and
-- the engine did not. Found 2026-08-16 by scoring three colleagues'
-- lists (Rehab, Mai, Mohammed Hassan) against sales and stock.
--
-- 1. THE STORE SWITCHES PRODUCTS OFF. The ProductStockExport carries an
--    `active` flag — 616 of 3,774 SKUs are 0 (duplicates, "listed under
--    another code", closed old editions, retired bundles). The engine had
--    no idea: on the current run it asked the warehouse for 48 move lines
--    / 419 copies of books nobody can buy, and Rehab's tool skipped every
--    one of them ("Excluded inactive products: Yes"). The flag is now
--    stock_items.ecom_active, written by the store-side upload; an
--    inactive SKU gets status 'inactive' with no move and no shortfall.
--    NULL (a hand-made sheet that carries no flag) counts as active —
--    only an explicit 0 from the store can switch a book off.
--
-- 2. THIS WEEK BEATS THIS MONTH. Mai gave the six calligraphy books 50
--    each; the engine said 36-42. She was right: they sold 23-28 copies
--    in the last 7 days against 68-87 in 30 — back to school — and a
--    30-day rate under-provisions exactly the books that are taking off.
--    Velocity is now the higher of the window rate and the last
--    p_recent_days rate, once at least p_surge_min copies sold in that
--    stretch so one busy afternoon does not count. Output `surge` says
--    which rate won. Calligraphy now scores 44-52; حول العالم فى 200 يوم
--    (17 sold this week, 19 in the month, 32 on the shelf, 3,761 in SAP)
--    goes from nothing to a move.
--
-- Run after 101_stock_min_move_line.sql
-- ============================================================

alter table public.stock_items add column if not exists ecom_active boolean;

-- the store-side upload carries the flag; a hand-made sheet does not, and
-- must not clear it
create or replace function public.fn_upsert_stock_side(
  p_rows jsonb,
  p_side text,
  p_taken_at timestamptz default now()
)
returns integer
language plpgsql set search_path = public
as $$
declare n integer;
begin
  if public.my_role() not in ('admin','manager') then raise exception 'Forbidden'; end if;
  if p_side not in ('ecom','sap','both') then raise exception 'Unknown stock side: %', p_side; end if;

  insert into public.stock_items (
    sku, product_name, ecom_stock, sap_stock, category, vendor,
    ecom_stock_at, sap_stock_at, ecom_active, updated_at
  )
  select distinct on (r->>'sku')
    r->>'sku',
    nullif(r->>'product_name',''),
    case when p_side in ('ecom','both') then nullif(r->>'ecom_stock','')::integer end,
    case when p_side in ('sap','both')  then nullif(r->>'sap_stock','')::integer  end,
    nullif(r->>'category',''),
    nullif(r->>'vendor',''),
    case when p_side in ('ecom','both') then p_taken_at end,
    case when p_side in ('sap','both')  then p_taken_at end,
    case when p_side in ('ecom','both') then nullif(r->>'ecom_active','')::boolean end,
    now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'sku','') <> ''
  order by r->>'sku'
  on conflict (sku) do update set
    product_name  = coalesce(excluded.product_name, stock_items.product_name),
    ecom_stock    = case when p_side in ('ecom','both') then excluded.ecom_stock else stock_items.ecom_stock end,
    sap_stock     = case when p_side in ('sap','both')  then excluded.sap_stock  else stock_items.sap_stock  end,
    ecom_stock_at = case when p_side in ('ecom','both') then p_taken_at else stock_items.ecom_stock_at end,
    sap_stock_at  = case when p_side in ('sap','both')  then p_taken_at else stock_items.sap_stock_at  end,
    ecom_active   = case when p_side in ('ecom','both') and excluded.ecom_active is not null
                         then excluded.ecom_active else stock_items.ecom_active end,
    category      = coalesce(excluded.category, stock_items.category),
    vendor        = coalesce(excluded.vendor, stock_items.vendor),
    updated_at    = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

drop function if exists public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer);
drop function if exists public.fn_stock_engine_json(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer);

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
  -- a title selling faster this stretch than over the window is sized on
  -- this stretch instead
  p_recent_days integer default 7,
  p_surge_min integer default 5
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
  -- new in 102
  recent_units bigint, surge boolean, is_active boolean
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
    l.is_active
  from lined l
  order by l.need desc, l.units desc, l.lifetime_units desc;
$$;

alter function public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer, integer, integer)
  set work_mem = '24MB';
grant execute on function public.fn_stock_engine(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer, integer, integer)
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
  p_min_move_line integer default 5,
  p_recent_days integer default 7,
  p_surge_min integer default 5
)
returns jsonb
language sql stable set search_path = public
as $$
  select coalesce(
    jsonb_agg(to_jsonb(e) order by e.need desc, e.units desc, e.lifetime_units desc),
    '[]'::jsonb
  )
  from public.fn_stock_engine(
    p_window_days, p_coverage_days, p_global_min, p_bestseller_min,
    p_bestseller_units, p_max_order, p_min_sap_move, p_relist_qty,
    p_ad_days, p_unlimited_at, p_overstock_min, p_min_scope, p_min_move_line,
    p_recent_days, p_surge_min
  ) e;
$$;
grant execute on function public.fn_stock_engine_json(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer, integer, integer)
  to authenticated;

-- One-off seed, done by hand on 2026-08-16 from that day's
-- ProductStockExport (Mohammed Hassan's file): 616 SKUs set inactive, every
-- other listed SKU set active. From here on the Data Center's store upload
-- keeps the flag current — no need to repeat.
