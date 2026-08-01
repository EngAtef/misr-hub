-- ============================================================
-- Migration 055: GA4 growth reports (phase 1)
-- Daily GA4 metrics + traffic sources + transaction attribution,
-- feeding the Traffic page's Channels / Tracking Health / Product
-- Matrix tabs. Synced by /api/cron/ga4-sync. Run after 054.
-- ============================================================

-- ---------- daily site-wide metrics ----------
create table if not exists public.ga4_daily (
  date date primary key,
  sessions numeric,
  active_users numeric,
  views numeric,
  add_to_carts numeric,
  checkouts numeric,
  purchases numeric,
  revenue numeric,
  imported_at timestamptz not null default now()
);
alter table public.ga4_daily enable row level security;
drop policy if exists ga4daily_read on public.ga4_daily;
create policy ga4daily_read on public.ga4_daily for select
  using ((select public.my_role()) in ('admin','manager','viewer'));
drop policy if exists ga4daily_write on public.ga4_daily;
create policy ga4daily_write on public.ga4_daily for insert
  with check ((select public.my_role()) in ('admin','manager'));
drop policy if exists ga4daily_update on public.ga4_daily;
create policy ga4daily_update on public.ga4_daily for update
  using ((select public.my_role()) in ('admin','manager'));
drop policy if exists ga4daily_delete on public.ga4_daily;
create policy ga4daily_delete on public.ga4_daily for delete
  using ((select public.my_role()) in ('admin','manager'));

-- ---------- daily traffic sources ----------
create table if not exists public.ga4_sources (
  date date not null,
  source text not null default '',
  medium text not null default '',
  campaign text not null default '',
  sessions numeric,
  active_users numeric,
  add_to_carts numeric,
  purchases numeric,
  revenue numeric,
  imported_at timestamptz not null default now(),
  primary key (date, source, medium, campaign)
);
create index if not exists idx_ga4src_campaign on public.ga4_sources (campaign);
alter table public.ga4_sources enable row level security;
drop policy if exists ga4src_read on public.ga4_sources;
create policy ga4src_read on public.ga4_sources for select
  using ((select public.my_role()) in ('admin','manager','viewer'));
drop policy if exists ga4src_write on public.ga4_sources;
create policy ga4src_write on public.ga4_sources for insert
  with check ((select public.my_role()) in ('admin','manager'));
drop policy if exists ga4src_update on public.ga4_sources;
create policy ga4src_update on public.ga4_sources for update
  using ((select public.my_role()) in ('admin','manager'));
drop policy if exists ga4src_delete on public.ga4_sources;
create policy ga4src_delete on public.ga4_sources for delete
  using ((select public.my_role()) in ('admin','manager'));

-- ---------- which channel each GA4 transaction came from ----------
alter table public.ga4_transactions add column if not exists source text;
alter table public.ga4_transactions add column if not exists medium text;
alter table public.ga4_transactions add column if not exists campaign text;

-- ---------- daily GA4 purchases vs actual store orders ----------
create or replace function public.fn_tracking_daily(p_from date, p_to date)
returns table (
  day date,
  ga4_purchases numeric,
  ga4_revenue numeric,
  sessions numeric,
  orders bigint,
  order_revenue numeric
)
language sql stable set search_path = public
as $$
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as day
  ),
  o as (
    select order_date::date as day,
           count(*) as orders,
           coalesce(sum(total_order_amount),0) as revenue
    from public.orders
    where order_status not in ('Cancelled')
      and order_date >= p_from and order_date < p_to + 1
    group by 1
  )
  select d.day,
         coalesce(g.purchases, 0),
         coalesce(g.revenue, 0),
         coalesce(g.sessions, 0),
         coalesce(o.orders, 0),
         coalesce(o.revenue, 0)
  from days d
  left join public.ga4_daily g on g.date = d.day
  left join o on o.day = d.day
  order by d.day;
$$;

-- ---------- channel & campaign ROI ----------
-- GA4 sessions/purchases per channel, actual store orders matched through
-- attributed transaction ids, and Meta claimed spend/purchases per campaign.
create or replace function public.fn_channel_summary(p_from date, p_to date)
returns json
language sql stable set search_path = public
as $$
  with ord as (
    select nullif(ltrim(regexp_replace(order_number, '\D', '', 'g'), '0'), '') as tx,
           order_status, total_order_amount
    from public.orders
    where order_date >= p_from and order_date < p_to + 1
  ),
  tx as (
    select t.transaction_id, t.source, t.medium, t.campaign,
           o.order_status, o.total_order_amount
    from public.ga4_transactions t
    join ord o on o.tx = t.transaction_id
    where t.source is not null
  ),
  src as (
    select source, medium,
           sum(sessions) as sessions, sum(active_users) as users,
           sum(add_to_carts) as add_to_carts,
           sum(purchases) as ga4_purchases, sum(revenue) as ga4_revenue
    from public.ga4_sources
    where date between p_from and p_to
    group by 1, 2
  ),
  src_orders as (
    select source, medium,
           count(*) as orders,
           count(*) filter (where order_status = 'Delivered') as delivered,
           count(*) filter (where order_status = 'Cancelled') as cancelled,
           coalesce(sum(total_order_amount) filter (where order_status <> 'Cancelled'), 0) as order_revenue
    from tx group by 1, 2
  ),
  camp as (
    select campaign,
           sum(sessions) as sessions,
           sum(purchases) as ga4_purchases, sum(revenue) as ga4_revenue
    from public.ga4_sources
    where date between p_from and p_to
      and campaign not in ('', '(not set)', '(direct)', '(organic)', '(referral)')
    group by 1
  ),
  camp_orders as (
    select campaign,
           count(*) as orders,
           count(*) filter (where order_status = 'Delivered') as delivered,
           count(*) filter (where order_status = 'Cancelled') as cancelled,
           coalesce(sum(total_order_amount) filter (where order_status <> 'Cancelled'), 0) as order_revenue
    from tx
    where campaign not in ('', '(not set)')
    group by 1
  ),
  spend as (
    select lower(trim(campaign_name)) as campaign_key,
           sum(amount_spent) as spend,
           sum(reported_purchases) as meta_purchases,
           sum(reported_conversion_value) as meta_revenue
    from public.ad_spend
    where campaign_name is not null
      and report_start <= p_to
      and coalesce(report_end, report_start) >= p_from
    group by 1
  )
  select json_build_object(
    'channels', (
      select coalesce(json_agg(row_to_json(c) order by c.sessions desc), '[]'::json)
      from (
        select s.source, s.medium, s.sessions, s.users, s.add_to_carts,
               s.ga4_purchases, s.ga4_revenue,
               coalesce(so.orders, 0) as orders,
               coalesce(so.delivered, 0) as delivered,
               coalesce(so.cancelled, 0) as cancelled,
               coalesce(so.order_revenue, 0) as order_revenue
        from src s
        left join src_orders so on so.source = s.source and so.medium = s.medium
      ) c
    ),
    'campaigns', (
      select coalesce(json_agg(row_to_json(c) order by c.spend desc nulls last, c.ga4_purchases desc), '[]'::json)
      from (
        select g.campaign, g.sessions, g.ga4_purchases, g.ga4_revenue,
               coalesce(co.orders, 0) as orders,
               coalesce(co.delivered, 0) as delivered,
               coalesce(co.cancelled, 0) as cancelled,
               coalesce(co.order_revenue, 0) as order_revenue,
               sp.spend, sp.meta_purchases, sp.meta_revenue
        from camp g
        left join camp_orders co on co.campaign = g.campaign
        left join spend sp on sp.campaign_key = lower(trim(g.campaign))
      ) c
    )
  );
$$;
