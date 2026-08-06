-- 076_ads_insights_fast.sql — fn_ads_insights timed out for real users
--
-- The sales CTE joined order_items with
--     (skus present AND oi.sku = any(skus)) OR (keyword ILIKE ...)
-- An OR across a join disables index use entirely, so Postgres seq-scanned
-- ~100k order_items once per (book × period) and ran norm_ad()'s regexes on
-- every row. As the service role that merely felt slow; under `authenticated`
-- Supabase's 8s statement_timeout killed it, and the page showed an empty
-- state (see: timeout-looks-like-empty-state).
--
-- Fix: split into a SKU branch (uses idx_items_sku) and a keyword branch
-- (plain ILIKE on product_name, no per-row normalisation), UNION'd. A book
-- uses exactly one branch, so the union never double counts.

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
  cpc numeric, lp_rate numeric, atc_rate numeric, ic_rate numeric,
  purchase_rate numeric, cvr numeric,
  cost_per_lpv numeric, cost_per_atc numeric, cost_per_ic numeric,
  reported_roas numeric, daily_spend numeric,
  book_label text, book_skus text[], map_source text,
  book_orders bigint, book_units numeric, book_revenue numeric,
  book_net_revenue numeric, book_delivered_revenue numeric,
  book_cancelled_orders bigint, book_buyers bigint,
  book_stock integer, book_avg_price numeric,
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
  -- one row per matched order item, produced by whichever branch the book uses
  hits as (
    select bp.book_label, bp.period_start, bp.period_end,
           oi.order_number, oi.sku, oi.price, o.order_status, o.master_id, o.customer_id
    from book_period bp
    join book_defs bd on bd.book_label = bp.book_label
     and bd.skus is not null and array_length(bd.skus, 1) > 0
    join public.order_items oi on oi.sku = any (bd.skus)
    join public.orders o
      on o.order_number = oi.order_number
     and o.order_date >= bp.period_start
     and o.order_date < bp.period_end + 1
    union all
    select bp.book_label, bp.period_start, bp.period_end,
           oi.order_number, oi.sku, oi.price, o.order_status, o.master_id, o.customer_id
    from book_period bp
    join book_defs bd on bd.book_label = bp.book_label
     and (bd.skus is null or array_length(bd.skus, 1) is null)
     and bd.keyword is not null
    join public.order_items oi on oi.product_name ilike '%' || bd.keyword || '%'
    join public.orders o
      on o.order_number = oi.order_number
     and o.order_date >= bp.period_start
     and o.order_date < bp.period_end + 1
  ),
  sales as (
    select h.book_label, h.period_start, h.period_end,
           count(distinct h.order_number) filter (where h.order_status <> 'Cancelled') as orders,
           coalesce(sum(coalesce(ps.quantity, 1)) filter (where h.order_status <> 'Cancelled'), 0) as units,
           coalesce(sum(h.price) filter (where h.order_status <> 'Cancelled'), 0) as revenue,
           coalesce(sum(h.price) filter (
             where h.order_status not in ('Cancelled', 'Returned', 'Return Request', 'Return Sent To Erp', 'Delivery Failed')), 0) as net_revenue,
           coalesce(sum(h.price) filter (where h.order_status = 'Delivered'), 0) as delivered_revenue,
           count(distinct h.order_number) filter (where h.order_status = 'Cancelled') as cancelled_orders,
           count(distinct coalesce(h.master_id, h.customer_id, h.order_number))
             filter (where h.order_status <> 'Cancelled') as buyers
    from hits h
    left join public.product_sales ps on ps.order_id = h.order_number and ps.sku = h.sku
    group by 1, 2, 3
  ),
  stock as (
    select bd.book_label, sum(si.ecom_stock)::integer as stock
    from book_defs bd
    join lateral unnest(coalesce(bd.skus, '{}'::text[])) as s(sku) on true
    join public.stock_items si on si.sku = s.sku
    group by 1
  ),
  shares as (
    select m.id, sum(m.spend) over w as book_spend, count(*) over w as book_ads, m.spend
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
