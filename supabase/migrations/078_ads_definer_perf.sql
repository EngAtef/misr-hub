-- 078_ads_definer_perf.sql — run the heavy ads analytics without RLS barriers
--
-- Every SELECT policy involved is already in init-plan form, yet the same
-- query runs 0.55s as owner and 8.8s as `authenticated`: RLS quals act as
-- optimization barriers, so the planner can't push predicates through the
-- hits UNION or the LIKE joins and falls back to nested loops.
--
-- These functions only aggregate data that every role (admin/manager/viewer)
-- may read anyway, so they become SECURITY DEFINER — RLS is checked once via
-- an explicit role gate folded into the first CTE (owner bypasses RLS, and a
-- caller with no role gets an empty result, not an error). Write paths
-- (fn_ads_import, mapping edits) stay SECURITY INVOKER.

-- ---------------------------------------------------------- fn_ads_insights

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
security definer
set search_path to 'public'
as $$
  with base as (
    select i.*
    from public.ad_insights i
    where (p_from is null or i.period_end >= p_from)
      and (p_to is null or i.period_start <= p_to)
      -- the role gate: empty base -> empty result for unauthorised callers
      and (select public.my_role()) in ('admin', 'manager', 'viewer')
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

-- --------------------------------------------------------------- fn_ads_gap

create or replace function public.fn_ads_gap(p_from date, p_to date)
returns table (
  book_label text,
  campaigns text[],
  ads bigint,
  spend numeric,
  meta_purchases numeric,
  meta_value numeric,
  meta_roas numeric,
  ga4_sessions numeric,
  ga4_atc numeric,
  ga4_purchases numeric,
  ga4_revenue numeric,
  ga4_tracked_orders bigint,
  ga4_tracked_revenue numeric,
  store_orders bigint,
  store_units numeric,
  store_revenue numeric,
  store_net_revenue numeric,
  store_cancelled bigint,
  actual_roas numeric,
  claim_vs_reality numeric,
  purchases_vs_orders numeric,
  verdict text,
  gsc_clicks numeric,
  gsc_impressions numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with ads as (
    select coalesce(ma.book_label, mc.book_label) as book_label,
           i.campaign_name, i.spend, i.purchases, i.conversion_value,
           coalesce(ma.skus, mc.skus) as skus,
           coalesce(ma.keyword, mc.keyword) as keyword
    from public.ad_insights i
    left join public.ad_book_map ma
      on ma.match_level = 'ad' and ma.active and ma.pattern = public.norm_ad(i.ad_name)
    left join public.ad_book_map mc
      on mc.match_level = 'campaign' and mc.active and mc.pattern = public.norm_ad(i.campaign_name)
    where i.level = 'ad'
      and i.period_end >= p_from and i.period_start <= p_to
      and (select public.my_role()) in ('admin', 'manager', 'viewer')
  ),
  books as (
    select a.book_label,
           array_agg(distinct a.campaign_name) filter (where a.campaign_name is not null) as campaigns,
           array_agg(distinct public.norm_ad(a.campaign_name))
             filter (where a.campaign_name is not null) as campaign_keys,
           count(*) as ads,
           coalesce(sum(a.spend), 0) as spend,
           coalesce(sum(a.purchases), 0) as meta_purchases,
           coalesce(sum(a.conversion_value), 0) as meta_value
    from ads a
    where a.book_label is not null
    group by 1
  ),
  book_skus as (
    select a.book_label,
           array_agg(distinct s.sku) filter (where s.sku is not null) as skus,
           max(a.keyword) as keyword
    from ads a
    left join lateral unnest(coalesce(a.skus, '{}'::text[])) as s(sku) on true
    where a.book_label is not null
    group by 1
  ),
  hits as (
    select bs.book_label, oi.order_number, oi.sku, oi.price, o.order_status
    from book_skus bs
    join public.order_items oi on oi.sku = any (bs.skus)
    join public.orders o on o.order_number = oi.order_number
     and o.order_date >= p_from and o.order_date < p_to + 1
    where bs.skus is not null and array_length(bs.skus, 1) > 0
    union all
    select bs.book_label, oi.order_number, oi.sku, oi.price, o.order_status
    from book_skus bs
    join public.order_items oi on oi.product_name ilike '%' || bs.keyword || '%'
    join public.orders o on o.order_number = oi.order_number
     and o.order_date >= p_from and o.order_date < p_to + 1
    where (bs.skus is null or array_length(bs.skus, 1) is null) and bs.keyword is not null
  ),
  store as (
    select h.book_label,
           count(distinct h.order_number) filter (where h.order_status <> 'Cancelled') as orders,
           coalesce(sum(coalesce(ps.quantity, 1)) filter (where h.order_status <> 'Cancelled'), 0) as units,
           coalesce(sum(h.price) filter (where h.order_status <> 'Cancelled'), 0) as revenue,
           coalesce(sum(h.price) filter (
             where h.order_status not in ('Cancelled', 'Returned', 'Return Request', 'Return Sent To Erp', 'Delivery Failed')), 0) as net_revenue,
           count(distinct h.order_number) filter (where h.order_status = 'Cancelled') as cancelled
    from hits h
    left join public.product_sales ps on ps.order_id = h.order_number and ps.sku = h.sku
    group by 1
  ),
  src_camp as materialized (
    select campaign, public.norm_ad(campaign) as key
    from (select distinct campaign from public.ga4_sources
          where date between p_from and p_to and campaign is not null) c
  ),
  ga4_src as (
    select b.book_label,
           sum(g.sessions) as sessions,
           sum(g.add_to_carts) as atc,
           sum(g.purchases) as purchases,
           sum(g.revenue) as revenue
    from books b
    join src_camp sc on sc.key = any (b.campaign_keys)
    join public.ga4_sources g
      on g.campaign = sc.campaign and g.date between p_from and p_to
    group by 1
  ),
  tx_camp as materialized (
    select campaign, public.norm_ad(campaign) as key
    from (select distinct campaign from public.ga4_transactions where campaign is not null) c
  ),
  ga4_tx as (
    select b.book_label,
           count(distinct o.order_number) as orders,
           coalesce(sum(o.total_order_amount) filter (where o.order_status <> 'Cancelled'), 0) as revenue
    from books b
    join tx_camp tc on tc.key = any (b.campaign_keys)
    join public.ga4_transactions t on t.campaign = tc.campaign
    join public.orders o
      on o.tx_key = t.transaction_id
     and o.order_date >= p_from and o.order_date < p_to + 1
    group by 1
  ),
  gsc_norm as materialized (
    select q.query, public.norm_ar(q.query) as nq, q.clicks, q.impressions
    from public.gsc_queries q
    where q.period_month >= date_trunc('month', p_from)::date
      and q.period_month <= date_trunc('month', p_to)::date
  ),
  gsc as (
    select b.book_label,
           sum(q.clicks) as clicks,
           sum(q.impressions) as impressions
    from books b
    join lateral (
      select w from unnest(string_to_array(public.norm_ar(b.book_label), ' ')) as w
      where length(w) >= 4
    ) words on true
    join gsc_norm q on q.nq like '%' || words.w || '%'
    group by 1
  )
  select
    b.book_label,
    b.campaigns,
    b.ads,
    round(b.spend, 2),
    b.meta_purchases,
    round(b.meta_value, 2),
    case when b.spend > 0 then round(b.meta_value / b.spend, 2) end as meta_roas,
    gs.sessions, gs.atc, gs.purchases, round(gs.revenue, 2),
    gt.orders, round(gt.revenue, 2),
    coalesce(st.orders, 0),
    coalesce(st.units, 0),
    round(coalesce(st.revenue, 0), 2),
    round(coalesce(st.net_revenue, 0), 2),
    coalesce(st.cancelled, 0),
    case when b.spend > 0 then round(coalesce(st.revenue, 0) / b.spend, 2) end as actual_roas,
    case when coalesce(st.revenue, 0) > 0 then round(b.meta_value / st.revenue, 2) end as claim_vs_reality,
    case when coalesce(st.orders, 0) > 0 then round(b.meta_purchases / st.orders, 2) end as purchases_vs_orders,
    case
      when b.meta_purchases > coalesce(st.orders, 0) then 'impossible'
      when b.meta_value > coalesce(st.revenue, 0) * 1.15 then 'inflated'
      else 'plausible'
    end as verdict,
    g.clicks, g.impressions
  from books b
  left join store st on st.book_label = b.book_label
  left join ga4_src gs on gs.book_label = b.book_label
  left join ga4_tx gt on gt.book_label = b.book_label
  left join gsc g on g.book_label = b.book_label
  order by b.spend desc;
$$;

-- ----------------------------------------------------------- fn_ads_blended

create or replace function public.fn_ads_blended(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with gate as (
    select (select public.my_role()) in ('admin', 'manager', 'viewer') as ok
  ),
  spend as (
    select coalesce(sum(i.spend), 0) as spend,
           coalesce(sum(i.purchases), 0) as meta_purchases,
           coalesce(sum(i.conversion_value), 0) as meta_value,
           coalesce(sum(i.impressions), 0) as impressions,
           coalesce(sum(i.link_clicks), 0) as clicks,
           coalesce(sum(i.landing_page_views), 0) as lpv,
           coalesce(sum(i.adds_to_cart), 0) as atc,
           coalesce(sum(i.checkouts_initiated), 0) as ic
    from public.ad_insights i, gate
    where gate.ok and i.level = 'ad' and i.period_end >= p_from and i.period_start <= p_to
  ),
  store as (
    select count(*) filter (where o.order_status <> 'Cancelled') as orders,
           coalesce(sum(o.total_order_amount) filter (where o.order_status <> 'Cancelled'), 0) as revenue,
           coalesce(sum(o.total_order_amount) filter (
             where o.order_status not in ('Cancelled', 'Returned', 'Return Request', 'Return Sent To Erp', 'Delivery Failed')), 0) as net_revenue,
           count(*) filter (where o.order_status = 'Cancelled') as cancelled,
           count(distinct coalesce(o.master_id, o.customer_id, o.order_number))
             filter (where o.order_status <> 'Cancelled') as buyers
    from public.orders o, gate
    where gate.ok and o.order_date >= p_from and o.order_date < p_to + 1
  )
  select case when (select ok from gate) then jsonb_build_object(
    'spend', sp.spend, 'meta_purchases', sp.meta_purchases, 'meta_value', sp.meta_value,
    'impressions', sp.impressions, 'clicks', sp.clicks, 'lpv', sp.lpv, 'atc', sp.atc, 'ic', sp.ic,
    'store_orders', st.orders, 'store_revenue', st.revenue, 'store_net_revenue', st.net_revenue,
    'store_cancelled', st.cancelled, 'store_buyers', st.buyers,
    'mer', case when sp.spend > 0 then round(st.revenue / sp.spend, 2) end,
    'net_mer', case when sp.spend > 0 then round(st.net_revenue / sp.spend, 2) end,
    'cac', case when st.orders > 0 then round(sp.spend / st.orders, 2) end,
    'aov', case when st.orders > 0 then round(st.revenue / st.orders, 2) end,
    'spend_share_of_revenue', case when st.revenue > 0 then round(sp.spend * 100 / st.revenue, 1) end
  ) else '{}'::jsonb end
  from spend sp, store st;
$$;

revoke all on function public.fn_ads_insights(date, date) from public, anon;
revoke all on function public.fn_ads_gap(date, date) from public, anon;
revoke all on function public.fn_ads_blended(date, date) from public, anon;
grant execute on function public.fn_ads_insights(date, date) to authenticated;
grant execute on function public.fn_ads_gap(date, date) to authenticated;
grant execute on function public.fn_ads_blended(date, date) to authenticated;
