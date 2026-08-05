-- 074_ads_analytics.sql — Ads Center analytics
--
-- The attribution model, in one paragraph:
--
--   Meta's own "Purchases" number counts any site purchase within its
--   attribution window after a click, so it over-credits badly (July 2026:
--   the ريم campaign claimed 128 purchases when the whole store only sold 72
--   of her books). Instead we map every ad to the BOOK it promotes, measure
--   that book's real orders in the ad's own reporting window, then split
--   those sales across the ads promoting it in proportion to spend. The split
--   means the per-ad numbers can be summed without double counting: they add
--   back up to exactly the book's real sales.
--
--   Because a book's sales include organic demand, the honest reading is
--   "revenue this ad is responsible for at most". The blended MER on the
--   summary card is the ceiling-free number to steer by.

-- ------------------------------------------------- periods & import list

create or replace function public.fn_ads_periods()
returns table (
  import_id uuid, account_label text, period_start date, period_end date,
  period_key text, period_label text, days integer,
  row_count integer, ad_rows bigint, spend numeric,
  reported_purchases numeric, reported_value numeric,
  file_name text, imported_at timestamptz, imported_by_email text
)
language sql
stable
set search_path to 'public'
as $$
  select a.id, a.account_label, a.period_start, a.period_end,
         a.period_start::text || '_' || a.period_end::text as period_key,
         to_char(a.period_start, 'DD Mon') || ' → ' || to_char(a.period_end, 'DD Mon YYYY') as period_label,
         (a.period_end - a.period_start + 1)::integer as days,
         a.row_count,
         count(i.id) filter (where i.level = 'ad') as ad_rows,
         coalesce(sum(i.spend) filter (where i.level = 'ad'), 0) as spend,
         coalesce(sum(i.purchases) filter (where i.level = 'ad'), 0) as reported_purchases,
         coalesce(sum(i.conversion_value) filter (where i.level = 'ad'), 0) as reported_value,
         a.file_name, a.imported_at, p.email
  from public.ad_imports a
  left join public.ad_insights i on i.import_id = a.id
  left join public.profiles p on p.id = a.imported_by
  group by a.id, p.email
  order by a.period_start desc, a.account_label;
$$;

-- ------------------------------------------------------ the main dataset

create or replace function public.fn_ads_insights(p_from date default null, p_to date default null)
returns table (
  id uuid, import_id uuid, account_label text, level text,
  campaign_name text, adset_name text, ad_name text,
  period_start date, period_end date, period_key text, days integer,
  delivery_status text,
  reach numeric, impressions numeric, frequency numeric, spend numeric, cpm numeric,
  link_clicks numeric, ctr_all numeric, landing_page_views numeric,
  adds_to_cart numeric, checkouts_initiated numeric,
  purchases numeric, conversion_value numeric, cost_per_purchase numeric, results_roas numeric,
  -- derived funnel economics
  cpc numeric, lp_rate numeric, atc_rate numeric, ic_rate numeric,
  purchase_rate numeric, cvr numeric,
  cost_per_lpv numeric, cost_per_atc numeric, cost_per_ic numeric,
  reported_roas numeric, daily_spend numeric,
  -- book mapping
  book_label text, book_skus text[], map_source text,
  -- the book's real sales in this ad's window (shared by all its ads)
  book_orders bigint, book_units numeric, book_revenue numeric,
  book_net_revenue numeric, book_delivered_revenue numeric,
  book_cancelled_orders bigint, book_buyers bigint,
  book_stock integer, book_avg_price numeric,
  -- this ad's spend-weighted share of the above
  spend_share numeric,
  att_orders numeric, att_units numeric, att_revenue numeric,
  att_net_revenue numeric, att_cancelled_orders numeric,
  actual_roas numeric, net_roas numeric, actual_cpa numeric, cancel_rate numeric
)
language sql
stable
set search_path to 'public'
as $$
  with base as (
    select i.*
    from public.ad_insights i
    where (p_from is null or i.period_end >= p_from)
      and (p_to is null or i.period_start <= p_to)
  ),
  mapped as (
    -- ad-level rows only; an ad-name mapping wins over a campaign-name one
    select b.id, b.period_start, b.period_end, coalesce(b.spend, 0) as spend,
           coalesce(ma.book_label, mc.book_label) as book_label,
           coalesce(ma.skus, mc.skus) as skus,
           coalesce(ma.keyword, mc.keyword) as keyword,
           case when ma.book_label is not null then 'ad'
                when mc.book_label is not null then 'campaign' end as map_source
    from base b
    left join public.ad_book_map ma
      on ma.match_level = 'ad' and ma.active and ma.pattern = public.norm_ad(b.ad_name)
    left join public.ad_book_map mc
      on mc.match_level = 'campaign' and mc.active and mc.pattern = public.norm_ad(b.campaign_name)
    where b.level = 'ad'
  ),
  -- one book can be promoted by several ads with different SKU lists — union them
  book_defs as (
    select m.book_label,
           array_agg(distinct s.sku) filter (where s.sku is not null) as skus,
           max(m.keyword) as keyword
    from mapped m
    left join lateral unnest(coalesce(m.skus, '{}'::text[])) as s(sku) on true
    where m.book_label is not null
    group by 1
  ),
  book_period as (
    select distinct m.book_label, m.period_start, m.period_end
    from mapped m where m.book_label is not null
  ),
  sales as (
    select bp.book_label, bp.period_start, bp.period_end,
           count(distinct o.order_number) filter (where o.order_status <> 'Cancelled') as orders,
           coalesce(sum(coalesce(ps.quantity, 1)) filter (where o.order_status <> 'Cancelled'), 0) as units,
           coalesce(sum(oi.price) filter (where o.order_status <> 'Cancelled'), 0) as revenue,
           coalesce(sum(oi.price) filter (
             where o.order_status not in ('Cancelled', 'Returned', 'Return Request', 'Return Sent To Erp', 'Delivery Failed')), 0) as net_revenue,
           coalesce(sum(oi.price) filter (where o.order_status = 'Delivered'), 0) as delivered_revenue,
           count(distinct o.order_number) filter (where o.order_status = 'Cancelled') as cancelled_orders,
           count(distinct coalesce(o.master_id, o.customer_id, o.order_number))
             filter (where o.order_status <> 'Cancelled') as buyers
    from book_period bp
    join book_defs bd on bd.book_label = bp.book_label
    join public.order_items oi
      on (
           (bd.skus is not null and array_length(bd.skus, 1) > 0 and oi.sku = any (bd.skus))
        or ((bd.skus is null or array_length(bd.skus, 1) is null) and bd.keyword is not null
            and public.norm_ad(oi.product_name) like '%' || public.norm_ad(bd.keyword) || '%')
         )
    join public.orders o
      on o.order_number = oi.order_number
     and o.order_date >= bp.period_start
     and o.order_date < bp.period_end + 1
    left join public.product_sales ps on ps.order_id = oi.order_number and ps.sku = oi.sku
    group by 1, 2, 3
  ),
  stock as (
    select bd.book_label,
           sum(si.ecom_stock)::integer as stock,
           avg(nullif(si.cost, 0)) as avg_cost
    from book_defs bd
    join lateral unnest(coalesce(bd.skus, '{}'::text[])) as s(sku) on true
    join public.stock_items si on si.sku = s.sku
    group by 1
  ),
  shares as (
    select m.id, m.book_label, m.map_source, m.spend,
           sum(m.spend) over w as book_spend,
           count(*) over w as book_ads
    from mapped m
    where m.book_label is not null
    window w as (partition by m.book_label, m.period_start, m.period_end)
  )
  select
    b.id, b.import_id, b.account_label, b.level,
    b.campaign_name, b.adset_name, b.ad_name,
    b.period_start, b.period_end,
    b.period_start::text || '_' || b.period_end::text as period_key,
    (b.period_end - b.period_start + 1)::integer as days,
    b.delivery_status,
    b.reach, b.impressions, b.frequency, b.spend,
    coalesce(b.cpm, case when b.impressions > 0 then round(b.spend * 1000 / b.impressions, 2) end) as cpm,
    b.link_clicks, b.ctr_all, b.landing_page_views,
    b.adds_to_cart, b.checkouts_initiated,
    b.purchases, b.conversion_value, b.cost_per_purchase, b.results_roas,
    case when b.link_clicks > 0 then round(b.spend / b.link_clicks, 2) end as cpc,
    case when b.link_clicks > 0 then round(b.landing_page_views * 100 / b.link_clicks, 1) end as lp_rate,
    case when b.landing_page_views > 0 then round(b.adds_to_cart * 100 / b.landing_page_views, 1) end as atc_rate,
    case when b.adds_to_cart > 0 then round(b.checkouts_initiated * 100 / b.adds_to_cart, 1) end as ic_rate,
    case when b.checkouts_initiated > 0 then round(b.purchases * 100 / b.checkouts_initiated, 1) end as purchase_rate,
    case when b.link_clicks > 0 then round(b.purchases * 100 / b.link_clicks, 2) end as cvr,
    case when b.landing_page_views > 0 then round(b.spend / b.landing_page_views, 2) end as cost_per_lpv,
    case when b.adds_to_cart > 0 then round(b.spend / b.adds_to_cart, 2) end as cost_per_atc,
    case when b.checkouts_initiated > 0 then round(b.spend / b.checkouts_initiated, 2) end as cost_per_ic,
    case when b.spend > 0 then round(coalesce(b.conversion_value, 0) / b.spend, 2) end as reported_roas,
    round(coalesce(b.spend, 0) / greatest(b.period_end - b.period_start + 1, 1), 2) as daily_spend,
    m.book_label,
    bd.skus as book_skus,
    m.map_source,
    s.orders, s.units, s.revenue, s.net_revenue, s.delivered_revenue,
    s.cancelled_orders, s.buyers,
    st.stock,
    case when s.units > 0 then round(s.revenue / s.units, 2) end as book_avg_price,
    sh.share as spend_share,
    round(coalesce(s.orders, 0) * sh.share, 2) as att_orders,
    round(coalesce(s.units, 0) * sh.share, 2) as att_units,
    round(coalesce(s.revenue, 0) * sh.share, 2) as att_revenue,
    round(coalesce(s.net_revenue, 0) * sh.share, 2) as att_net_revenue,
    round(coalesce(s.cancelled_orders, 0) * sh.share, 2) as att_cancelled_orders,
    case when b.spend > 0 then round(coalesce(s.revenue, 0) * sh.share / b.spend, 2) end as actual_roas,
    case when b.spend > 0 then round(coalesce(s.net_revenue, 0) * sh.share / b.spend, 2) end as net_roas,
    case when coalesce(s.orders, 0) * sh.share > 0 then round(b.spend / (s.orders * sh.share), 2) end as actual_cpa,
    case when coalesce(s.orders, 0) + coalesce(s.cancelled_orders, 0) > 0
         then round(s.cancelled_orders * 100.0 / (s.orders + s.cancelled_orders), 1) end as cancel_rate
  from base b
  left join mapped m on m.id = b.id
  left join book_defs bd on bd.book_label = m.book_label
  left join sales s
    on s.book_label = m.book_label and s.period_start = b.period_start and s.period_end = b.period_end
  left join stock st on st.book_label = m.book_label
  left join lateral (
    select case when sh0.book_spend > 0 then sh0.spend / sh0.book_spend
                else 1.0 / greatest(sh0.book_ads, 1) end as share
    from shares sh0 where sh0.id = b.id
  ) sh on true
  order by b.period_start desc, b.spend desc nulls last;
$$;

-- --------------------------------------------------- unmapped ad backlog

-- Which ad names still have no book attached, worst (most spend) first.
create or replace function public.fn_ads_unmapped(p_from date default null, p_to date default null)
returns table (
  ad_name text, pattern text, campaigns text[], accounts text[],
  spend numeric, purchases numeric, conversion_value numeric, periods bigint
)
language sql
stable
set search_path to 'public'
as $$
  select max(i.ad_name) as ad_name,
         public.norm_ad(i.ad_name) as pattern,
         array_agg(distinct i.campaign_name) filter (where i.campaign_name is not null) as campaigns,
         array_agg(distinct i.account_label) as accounts,
         coalesce(sum(i.spend), 0) as spend,
         coalesce(sum(i.purchases), 0) as purchases,
         coalesce(sum(i.conversion_value), 0) as conversion_value,
         count(distinct i.period_start) as periods
  from public.ad_insights i
  where i.level = 'ad'
    and (p_from is null or i.period_end >= p_from)
    and (p_to is null or i.period_start <= p_to)
    and not exists (
      select 1 from public.ad_book_map m
      where m.active
        and ((m.match_level = 'ad' and m.pattern = public.norm_ad(i.ad_name))
          or (m.match_level = 'campaign' and m.pattern = public.norm_ad(i.campaign_name)))
    )
  group by public.norm_ad(i.ad_name)
  order by 5 desc;
$$;

-- Best-effort SKU suggestions for an ad name: books whose (normalised) title
-- shares a word with the ad name, ranked by how well they sold in the window.
create or replace function public.fn_ads_map_suggest(p_name text, p_from date default null, p_to date default null, p_limit integer default 8)
returns table (sku text, product_name text, units bigint, revenue numeric, score integer)
language sql
stable
set search_path to 'public'
as $$
  with words as (
    select w from unnest(string_to_array(public.norm_ad(p_name), ' ')) as w
    where length(w) >= 3 and w !~ '^(copy|new|video|design|carousel|gif|static|ad|ads|v1|v2)$'
  ),
  sold as (
    select oi.sku,
           mode() within group (order by oi.product_name) as product_name,
           sum(coalesce(ps.quantity, 1))::bigint as units,
           coalesce(sum(oi.price), 0) as revenue
    from public.order_items oi
    join public.orders o on o.order_number = oi.order_number and o.order_status <> 'Cancelled'
    left join public.product_sales ps on ps.order_id = oi.order_number and ps.sku = oi.sku
    where coalesce(oi.sku, '') <> ''
      and (p_from is null or o.order_date >= p_from)
      and (p_to is null or o.order_date < p_to + 1)
    group by 1
  )
  select s.sku, s.product_name, s.units, s.revenue,
         (select count(*)::integer from words w where public.norm_ad(s.product_name) like '%' || w.w || '%') as score
  from sold s
  where exists (select 1 from words w where public.norm_ad(s.product_name) like '%' || w.w || '%')
  order by score desc, units desc
  limit p_limit;
$$;

-- --------------------------------------------------------- map maintenance

-- Upsert a mapping. p_skus = null keeps the keyword fallback path.
create or replace function public.fn_ads_map_set(
  p_match_level text,
  p_raw_name text,
  p_book_label text,
  p_skus text[] default null,
  p_keyword text default null
)
returns uuid
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if coalesce(public.norm_ad(p_raw_name), '') = '' then
    raise exception 'name is required';
  end if;
  insert into public.ad_book_map (match_level, pattern, raw_name, book_label, skus, keyword, is_auto, active, updated_by, updated_at)
  values (coalesce(p_match_level, 'ad'), public.norm_ad(p_raw_name), p_raw_name,
          coalesce(nullif(trim(p_book_label), ''), p_raw_name),
          nullif(p_skus, '{}'), nullif(trim(coalesce(p_keyword, '')), ''), false, true, auth.uid(), now())
  on conflict (match_level, pattern) do update
    set raw_name = excluded.raw_name,
        book_label = excluded.book_label,
        skus = excluded.skus,
        keyword = excluded.keyword,
        is_auto = false,
        active = true,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.fn_ads_map_list()
returns table (
  id uuid, match_level text, pattern text, raw_name text, book_label text,
  skus text[], keyword text, is_auto boolean, active boolean, updated_at timestamptz,
  ad_count bigint, spend numeric
)
language sql
stable
set search_path to 'public'
as $$
  select m.id, m.match_level, m.pattern, m.raw_name, m.book_label, m.skus, m.keyword,
         m.is_auto, m.active, m.updated_at,
         count(i.id) as ad_count,
         coalesce(sum(i.spend), 0) as spend
  from public.ad_book_map m
  left join public.ad_insights i
    on i.level = 'ad'
   and ((m.match_level = 'ad' and public.norm_ad(i.ad_name) = m.pattern)
     or (m.match_level = 'campaign' and public.norm_ad(i.campaign_name) = m.pattern))
  group by m.id
  order by spend desc, m.book_label;
$$;

revoke all on function public.fn_ads_map_set(text, text, text, text[], text) from public, anon;
grant execute on function public.fn_ads_map_set(text, text, text, text[], text) to authenticated;

-- ------------------------------------------------------------- settings

-- Break-even ROAS etc. live in app_settings so the whole team shares them.
create or replace function public.fn_ads_settings()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  -- defaults first so a stored key always wins
  select case when (select public.my_role()) in ('admin', 'manager', 'viewer')
    then jsonb_build_object(
           'gross_margin_pct', 35,   -- book margin used for profit-ROAS
           'target_roas', 3,         -- what a healthy ad should return
           'min_spend', 300,         -- below this a verdict is "not enough data"
           'frequency_cap', 3.5      -- above this the creative is burning out
         ) || coalesce((select value from public.app_settings where key = 'ads'), '{}'::jsonb)
    else '{}'::jsonb end;
$$;

revoke all on function public.fn_ads_settings() from public, anon;
grant execute on function public.fn_ads_settings() to authenticated;

create or replace function public.fn_ads_settings_set(p_value jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (select public.my_role()) not in ('admin', 'manager') then
    raise exception 'not allowed';
  end if;
  insert into public.app_settings (key, value, updated_by, updated_at)
  values ('ads', coalesce(p_value, '{}'::jsonb), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end $$;

revoke all on function public.fn_ads_settings_set(jsonb) from public, anon;
grant execute on function public.fn_ads_settings_set(jsonb) to authenticated;

-- ------------------------------------------------------ store-wide context

-- Blended view: everything the store sold in a window vs everything we spent.
-- This is the number that cannot be gamed by attribution windows.
create or replace function public.fn_ads_blended(p_from date, p_to date)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with spend as (
    select coalesce(sum(i.spend), 0) as spend,
           coalesce(sum(i.purchases), 0) as meta_purchases,
           coalesce(sum(i.conversion_value), 0) as meta_value,
           coalesce(sum(i.impressions), 0) as impressions,
           coalesce(sum(i.link_clicks), 0) as clicks,
           coalesce(sum(i.landing_page_views), 0) as lpv,
           coalesce(sum(i.adds_to_cart), 0) as atc,
           coalesce(sum(i.checkouts_initiated), 0) as ic
    from public.ad_insights i
    where i.level = 'ad' and i.period_end >= p_from and i.period_start <= p_to
  ),
  store as (
    select count(*) filter (where o.order_status <> 'Cancelled') as orders,
           coalesce(sum(o.total_order_amount) filter (where o.order_status <> 'Cancelled'), 0) as revenue,
           coalesce(sum(o.total_order_amount) filter (
             where o.order_status not in ('Cancelled', 'Returned', 'Return Request', 'Return Sent To Erp', 'Delivery Failed')), 0) as net_revenue,
           count(*) filter (where o.order_status = 'Cancelled') as cancelled,
           count(distinct coalesce(o.master_id, o.customer_id, o.order_number))
             filter (where o.order_status <> 'Cancelled') as buyers
    from public.orders o
    where o.order_date >= p_from and o.order_date < p_to + 1
  )
  select jsonb_build_object(
    'spend', sp.spend, 'meta_purchases', sp.meta_purchases, 'meta_value', sp.meta_value,
    'impressions', sp.impressions, 'clicks', sp.clicks, 'lpv', sp.lpv, 'atc', sp.atc, 'ic', sp.ic,
    'store_orders', st.orders, 'store_revenue', st.revenue, 'store_net_revenue', st.net_revenue,
    'store_cancelled', st.cancelled, 'store_buyers', st.buyers,
    'mer', case when sp.spend > 0 then round(st.revenue / sp.spend, 2) end,
    'net_mer', case when sp.spend > 0 then round(st.net_revenue / sp.spend, 2) end,
    'cac', case when st.orders > 0 then round(sp.spend / st.orders, 2) end,
    'aov', case when st.orders > 0 then round(st.revenue / st.orders, 2) end,
    'spend_share_of_revenue', case when st.revenue > 0 then round(sp.spend * 100 / st.revenue, 1) end
  )
  from spend sp, store st;
$$;

-- -------------------------------------------------------------- grants

grant execute on function public.fn_ads_periods() to authenticated;
grant execute on function public.fn_ads_insights(date, date) to authenticated;
grant execute on function public.fn_ads_unmapped(date, date) to authenticated;
grant execute on function public.fn_ads_map_suggest(text, date, date, integer) to authenticated;
grant execute on function public.fn_ads_map_list() to authenticated;
grant execute on function public.fn_ads_blended(date, date) to authenticated;

revoke all on function public.fn_ads_periods() from public, anon;
revoke all on function public.fn_ads_insights(date, date) from public, anon;
revoke all on function public.fn_ads_unmapped(date, date) from public, anon;
revoke all on function public.fn_ads_map_suggest(text, date, date, integer) from public, anon;
revoke all on function public.fn_ads_map_list() from public, anon;
revoke all on function public.fn_ads_blended(date, date) from public, anon;
