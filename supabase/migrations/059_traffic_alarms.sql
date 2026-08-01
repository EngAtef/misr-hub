-- ============================================================
-- Migration 059: traffic alarm engine + drill-down helpers
-- fn_traffic_alarms(): 9 proactive checks over the GA4/GSC sync
-- tables; fn_campaign_orders(): matched-order drill-down for a
-- campaign; fn_channel_quality(): repeat-customer rate per source;
-- ga4_hours: hour x weekday heatmap data. Run after 058.
-- ============================================================

create table if not exists public.ga4_hours (
  period_month date not null,
  dow smallint not null,
  hour smallint not null,
  sessions numeric,
  purchases numeric,
  imported_at timestamptz not null default now(),
  primary key (period_month, dow, hour)
);
alter table public.ga4_hours enable row level security;
drop policy if exists ga4hours_read on public.ga4_hours;
create policy ga4hours_read on public.ga4_hours for select
  using ((select public.my_role()) in ('admin','manager','viewer'));
drop policy if exists ga4hours_write on public.ga4_hours;
create policy ga4hours_write on public.ga4_hours for insert
  with check ((select public.my_role()) in ('admin','manager'));
drop policy if exists ga4hours_update on public.ga4_hours;
create policy ga4hours_update on public.ga4_hours for update
  using ((select public.my_role()) in ('admin','manager'));
drop policy if exists ga4hours_delete on public.ga4_hours;
create policy ga4hours_delete on public.ga4_hours for delete
  using ((select public.my_role()) in ('admin','manager'));

-- matched orders for one campaign (drill-down)
create or replace function public.fn_campaign_orders(p_campaign text, p_from date, p_to date, p_limit integer default 200)
returns table (order_number text, order_date timestamptz, order_status text, total_order_amount numeric, city text, source text, medium text)
language sql stable set search_path = public
as $$
  select o.order_number, o.order_date, o.order_status, o.total_order_amount, o.city, t.source, t.medium
  from public.ga4_transactions t
  join (
    select *, nullif(ltrim(regexp_replace(order_number, '\D', '', 'g'), '0'), '') as tx
    from public.orders
    where order_date >= p_from and order_date < p_to + 1
  ) o on o.tx = t.transaction_id
  where t.campaign = p_campaign
  order by o.order_date desc
  limit p_limit;
$$;

-- repeat-customer quality per traffic source
create or replace function public.fn_channel_quality(p_from date, p_to date)
returns table (source text, customers bigint, repeat_customers bigint, orders bigint, revenue numeric)
language sql stable set search_path = public
as $$
  with matched as (
    select t.source, o.customer_id, o.total_order_amount, o.order_status
    from public.ga4_transactions t
    join (
      select *, nullif(ltrim(regexp_replace(order_number, '\D', '', 'g'), '0'), '') as tx
      from public.orders
      where order_date >= p_from and order_date < p_to + 1
    ) o on o.tx = t.transaction_id
    where t.source is not null and o.customer_id is not null
  )
  select m.source,
         count(distinct m.customer_id) as customers,
         count(distinct m.customer_id) filter (where coalesce(c.lifetime_orders, 0) > 1) as repeat_customers,
         count(*) as orders,
         coalesce(sum(m.total_order_amount) filter (where m.order_status <> 'Cancelled'), 0) as revenue
  from matched m
  left join public.customers c on c.customer_id = m.customer_id
  group by 1
  having count(distinct m.customer_id) >= 5
  order by customers desc;
$$;

-- proactive alarms over traffic + ecommerce data.
-- Returns [{kind, severity, data}] — the client renders localized text.
create or replace function public.fn_traffic_alarms()
returns json
language sql stable set search_path = public
as $$
with
tx_norm as (
  select t.campaign, o.order_status, o.total_order_amount, o.order_date
  from public.ga4_transactions t
  join (
    select nullif(ltrim(regexp_replace(order_number, '\D', '', 'g'), '0'), '') as tx,
           order_status, total_order_amount, order_date
    from public.orders where order_date >= current_date - 45
  ) o on o.tx = t.transaction_id
),
camp_spend as (
  select lower(trim(campaign_name)) as ckey, max(campaign_name) as name, sum(amount_spent) as spend
  from public.ad_spend
  where campaign_name is not null and coalesce(report_end, report_start) >= current_date - 10
  group by 1
  having sum(amount_spent) > 0
),
camp_orders as (
  select lower(trim(campaign)) as ckey, count(*) as orders,
         coalesce(sum(total_order_amount) filter (where order_status <> 'Cancelled'), 0) as revenue
  from tx_norm
  where campaign is not null and order_date >= current_date - 10
  group by 1
),
dead as (
  select s.name, s.spend from camp_spend s
  left join camp_orders o on o.ckey = s.ckey
  where coalesce(o.orders, 0) = 0 and s.spend >= 500
  order by s.spend desc limit 5
),
lowroas as (
  select s.name, s.spend, o.revenue from camp_spend s
  join camp_orders o on o.ckey = s.ckey
  where o.orders > 0 and o.revenue < s.spend and s.spend >= 500
  order by s.spend - o.revenue desc limit 5
),
anom as (
  select y.sessions as yesterday, round(b.avg_sessions) as avg_sessions
  from (select sessions from public.ga4_daily where date = current_date - 1) y,
       (select avg(sessions) as avg_sessions from public.ga4_daily
        where extract(dow from date) = extract(dow from current_date - 1)
          and date < current_date - 1 and date >= current_date - 29) b
  where b.avg_sessions > 50 and y.sessions is not null
    and (y.sessions < 0.5 * b.avg_sessions or y.sessions > 2 * b.avg_sessions)
),
oos as (
  select i.item_name, i.items_viewed
  from public.ga4_items i
  join public.stock_items s on trim(s.product_name) = trim(i.item_name)
  where i.period_month = date_trunc('month', current_date)::date
    and coalesce(s.ecom_stock, 0) = 0 and i.items_viewed >= 100
  order by i.items_viewed desc limit 8
),
collapse as (
  select c.item_name,
         round(c.items_purchased * 1000 / nullif(c.items_viewed, 0)) / 10 as cur_rate,
         round(p.items_purchased * 1000 / nullif(p.items_viewed, 0)) / 10 as prev_rate
  from public.ga4_items c
  join public.ga4_items p on p.item_name = c.item_name
   and p.period_month = (date_trunc('month', current_date) - interval '1 month')::date
  where c.period_month = date_trunc('month', current_date)::date
    and c.items_viewed >= 200 and p.items_viewed >= 200
    and p.items_purchased / nullif(p.items_viewed, 0) > 0.005
    and c.items_purchased / nullif(c.items_viewed, 0) < 0.5 * (p.items_purchased / nullif(p.items_viewed, 0))
  limit 5
),
leak as (
  select round(r.rate * 100) as recent_pct, round(pr.rate * 100) as prior_pct
  from (select sum(purchases) / nullif(sum(checkouts), 0) as rate
        from public.ga4_daily where date >= current_date - 7 and date < current_date) r,
       (select sum(purchases) / nullif(sum(checkouts), 0) as rate
        from public.ga4_daily where date >= current_date - 37 and date < current_date - 7) pr
  where pr.rate > 0 and r.rate is not null and r.rate < 0.7 * pr.rate
),
gsc_m as (select max(period_month) as m from public.gsc_queries),
rank_moves as (
  select c.query, round(c.position * 10) / 10 as cur_pos, round(p.position * 10) / 10 as prev_pos, c.impressions
  from public.gsc_queries c
  join public.gsc_queries p on p.query = c.query
   and p.period_month = ((select m from gsc_m) - interval '1 month')::date
  where c.period_month = (select m from gsc_m) and c.impressions >= 100
),
rank_drops as (
  select * from rank_moves where cur_pos - prev_pos >= 3 order by impressions desc limit 5
),
rank_wins as (
  select * from rank_moves where prev_pos > 10 and cur_pos <= 10 order by impressions desc limit 5
),
city_del as (
  select city,
    count(*) filter (where order_date >= current_date - 30) as cur_orders,
    count(*) filter (where order_date >= current_date - 30 and order_status = 'Delivered')::numeric
      / nullif(count(*) filter (where order_date >= current_date - 30), 0) as cur_rate,
    count(*) filter (where order_date >= current_date - 60 and order_date < current_date - 30) as prev_orders,
    count(*) filter (where order_date >= current_date - 60 and order_date < current_date - 30 and order_status = 'Delivered')::numeric
      / nullif(count(*) filter (where order_date >= current_date - 60 and order_date < current_date - 30), 0) as prev_rate
  from public.orders
  where order_date >= current_date - 60 and coalesce(city, '') <> ''
  group by city
),
city_drops as (
  select city, round(cur_rate * 100) as cur_pct, round(prev_rate * 100) as prev_pct
  from city_del
  where cur_orders >= 20 and prev_orders >= 20 and cur_rate < prev_rate - 0.15
  order by prev_rate - cur_rate desc limit 5
),
mtd as (
  select
    (select coalesce(sum(sessions), 0) from public.ga4_daily where date >= date_trunc('month', current_date)) as s_cur,
    (select coalesce(sum(sessions), 0) from public.ga4_daily
      where date >= date_trunc('month', current_date) - interval '1 month'
        and date < date_trunc('month', current_date) - interval '1 month'
            + (current_date - date_trunc('month', current_date)::date + 1) * interval '1 day') as s_prev,
    (select count(*) from public.orders where order_date >= date_trunc('month', current_date) and order_status <> 'Cancelled') as o_cur,
    (select count(*) from public.orders
      where order_date >= date_trunc('month', current_date) - interval '1 month'
        and order_date < date_trunc('month', current_date) - interval '1 month'
            + (current_date - date_trunc('month', current_date)::date + 1) * interval '1 day'
        and order_status <> 'Cancelled') as o_prev,
    (select coalesce(sum(total_order_amount), 0) from public.orders
      where order_date >= date_trunc('month', current_date) and order_status <> 'Cancelled') as r_cur,
    (select coalesce(sum(total_order_amount), 0) from public.orders
      where order_date >= date_trunc('month', current_date) - interval '1 month'
        and order_date < date_trunc('month', current_date) - interval '1 month'
            + (current_date - date_trunc('month', current_date)::date + 1) * interval '1 day'
        and order_status <> 'Cancelled') as r_prev
)
select coalesce(json_agg(row_to_json(x)), '[]'::json) from (
  select 'dead_spend' as kind, 'red' as severity, json_build_object('name', name, 'spend', spend) as data from dead
  union all
  select 'low_roas', 'red', json_build_object('name', name, 'spend', spend, 'revenue', revenue) from lowroas
  union all
  select 'traffic_anomaly', case when yesterday < avg_sessions then 'red' else 'amber' end,
         json_build_object('yesterday', yesterday, 'avg', avg_sessions) from anom
  union all
  select 'oos_traffic', 'amber', json_build_object('name', item_name, 'views', items_viewed) from oos
  union all
  select 'conversion_collapse', 'amber', json_build_object('name', item_name, 'cur', cur_rate, 'prev', prev_rate) from collapse
  union all
  select 'checkout_leak', 'red', json_build_object('recent', recent_pct, 'prior', prior_pct) from leak
  union all
  select 'rank_drop', 'amber', json_build_object('query', query, 'cur', cur_pos, 'prev', prev_pos, 'impressions', impressions) from rank_drops
  union all
  select 'rank_win', 'info', json_build_object('query', query, 'cur', cur_pos, 'prev', prev_pos, 'impressions', impressions) from rank_wins
  union all
  select 'city_delivery', 'amber', json_build_object('city', city, 'cur', cur_pct, 'prev', prev_pct) from city_drops
  union all
  select 'pace_driver', 'info',
         json_build_object('r_cur', r_cur, 'r_prev', r_prev, 's_cur', s_cur, 's_prev', s_prev, 'o_cur', o_cur, 'o_prev', o_prev)
  from mtd where r_prev > 0 and r_cur < 0.9 * r_prev
) x;
$$;
