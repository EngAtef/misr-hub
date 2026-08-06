-- 077_ads_gap.sql — the "Meta says vs reality" reconciliation, per book
--
-- Three witnesses for every advertised book, all inside the ads' own window:
--
--   Meta      what Ads Manager claims (purchases + conversion value)
--   GA4       what analytics tracked for those campaigns (utm_campaign carries
--             the Meta campaign name, so norm_ad() joins the two worlds), and
--             which of those tracked transactions exist as real store orders
--   Store     the book's actual orders across ALL channels — the hard ceiling
--
-- Meta claiming more than the store ceiling is physically impossible credit
-- (the ريم بسيوني July case). GSC clicks/impressions ride along as the
-- organic-demand context for each book.

create or replace function public.fn_ads_gap(p_from date, p_to date)
returns table (
  book_label text,
  campaigns text[],
  ads bigint,
  spend numeric,
  -- Meta's claim
  meta_purchases numeric,
  meta_value numeric,
  meta_roas numeric,
  -- GA4's view of those campaigns
  ga4_sessions numeric,
  ga4_atc numeric,
  ga4_purchases numeric,
  ga4_revenue numeric,
  ga4_tracked_orders bigint,
  ga4_tracked_revenue numeric,
  -- the store's reality (all channels)
  store_orders bigint,
  store_units numeric,
  store_revenue numeric,
  store_net_revenue numeric,
  store_cancelled bigint,
  actual_roas numeric,
  -- gap diagnostics
  claim_vs_reality numeric,        -- meta_value / store_revenue
  purchases_vs_orders numeric,     -- meta_purchases / store_orders
  verdict text,                    -- impossible | inflated | plausible
  -- organic context
  gsc_clicks numeric,
  gsc_impressions numeric
)
language sql
stable
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
  -- GA4 traffic rows for each book's campaigns (utm_campaign = Meta campaign name)
  ga4_src as (
    select b.book_label,
           sum(g.sessions) as sessions,
           sum(g.add_to_carts) as atc,
           sum(g.purchases) as purchases,
           sum(g.revenue) as revenue
    from books b
    join public.ga4_sources g
      on g.date between p_from and p_to
     and g.campaign is not null
     and public.norm_ad(g.campaign) = any (b.campaign_keys)
    group by 1
  ),
  -- GA4 transactions for those campaigns that exist as real store orders
  ga4_tx as (
    select b.book_label,
           count(distinct o.order_number) as orders,
           coalesce(sum(o.total_order_amount) filter (where o.order_status <> 'Cancelled'), 0) as revenue
    from books b
    join public.ga4_transactions t
      on t.campaign is not null and public.norm_ad(t.campaign) = any (b.campaign_keys)
    join public.orders o
      on o.tx_key = t.transaction_id
     and o.order_date >= p_from and o.order_date < p_to + 1
    group by 1
  ),
  -- organic search demand: GSC queries containing a significant word of the label
  gsc as (
    select b.book_label,
           sum(q.clicks) as clicks,
           sum(q.impressions) as impressions
    from books b
    join lateral (
      select w from unnest(string_to_array(public.norm_ar(b.book_label), ' ')) as w
      where length(w) >= 4
    ) words on true
    join public.gsc_queries q
      on q.period_month >= date_trunc('month', p_from)::date
     and q.period_month <= date_trunc('month', p_to)::date
     and public.norm_ar(q.query) like '%' || words.w || '%'
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

revoke all on function public.fn_ads_gap(date, date) from public, anon;
grant execute on function public.fn_ads_gap(date, date) to authenticated;
