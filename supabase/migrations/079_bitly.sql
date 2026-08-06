-- 079_bitly.sql — Bitly as the fourth witness in the funnel
--
-- Meta reports clicks it charged for. Bitly reports redirects it actually
-- served. GA4 reports sessions that reached the site. The store reports
-- orders. Each step down that chain is a place traffic can evaporate, and
-- only the middle two are independent of the ad platform's own accounting.
--
-- Bitlinks are joined to campaigns through the utm_campaign parameter baked
-- into their destination URL (the agreed UTM standard is
-- utm_campaign={{campaign.name}} & utm_content={{ad.name}}), which is the
-- same key the Gap tab uses for GA4 — so a link, a campaign and an ad all
-- reconcile on one normalised string.

create table if not exists public.bitly_links (
  id text primary key,                       -- "bit.ly/3xYzAbc"
  link text,                                 -- full https:// form
  long_url text,
  title text,
  tags text[],
  archived boolean not null default false,
  group_guid text,
  bitly_created_at timestamptz,
  -- parsed out of long_url at sync time so they are queryable
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  dest_host text,
  dest_path text,
  total_clicks integer not null default 0,   -- over the last synced window
  synced_at timestamptz not null default now()
);

create index if not exists idx_bitly_links_campaign on public.bitly_links (utm_campaign);
create index if not exists idx_bitly_links_clicks on public.bitly_links (total_clicks desc);

create table if not exists public.bitly_clicks_daily (
  bitlink_id text not null references public.bitly_links (id) on delete cascade,
  date date not null,
  clicks integer not null default 0,
  primary key (bitlink_id, date)
);

create index if not exists idx_bitly_clicks_date on public.bitly_clicks_daily (date);

-- referrers and countries share a shape, so one table with a kind column
create table if not exists public.bitly_metrics (
  bitlink_id text not null references public.bitly_links (id) on delete cascade,
  kind text not null check (kind in ('referrer', 'country')),
  value text not null,
  clicks integer not null default 0,
  period_start date not null,
  period_end date not null,
  primary key (bitlink_id, kind, value, period_start)
);

create table if not exists public.bitly_syncs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  links_seen integer not null default 0,
  links_detailed integer not null default 0,
  days_from date,
  days_to date,
  ok boolean not null default false,
  error text,
  ran_by uuid references public.profiles (id),
  ran_by_email text
);

-- ------------------------------------------------------------------ RLS

alter table public.bitly_links enable row level security;
alter table public.bitly_clicks_daily enable row level security;
alter table public.bitly_metrics enable row level security;
alter table public.bitly_syncs enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['bitly_links', 'bitly_clicks_daily', 'bitly_metrics', 'bitly_syncs'] loop
    execute format('drop policy if exists %I on public.%I', tbl || '_read', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_write', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_update', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_delete', tbl);
    execute format(
      'create policy %I on public.%I for select using ((select public.my_role()) in (''admin'',''manager'',''viewer''))',
      tbl || '_read', tbl);
    execute format(
      'create policy %I on public.%I for insert with check ((select public.my_role()) in (''admin'',''manager''))',
      tbl || '_write', tbl);
    execute format(
      'create policy %I on public.%I for update using ((select public.my_role()) in (''admin'',''manager'')) with check ((select public.my_role()) in (''admin'',''manager''))',
      tbl || '_update', tbl);
    execute format(
      'create policy %I on public.%I for delete using ((select public.my_role()) in (''admin'',''manager''))',
      tbl || '_delete', tbl);
  end loop;
end $$;

-- --------------------------------------------------------------- config

-- app_settings is admin-only; expose just the bitly key to admin+manager the
-- same way fn_marketing_config does for the AI/Meta keys.
create or replace function public.fn_bitly_config()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when (select public.my_role()) in ('admin', 'manager')
      then coalesce((select value from public.app_settings where key = 'bitly'), '{}'::jsonb)
    else '{}'::jsonb
  end;
$$;

revoke all on function public.fn_bitly_config() from public, anon;
grant execute on function public.fn_bitly_config() to authenticated;

-- Stores the resolved group guid back so the user never has to look it up.
create or replace function public.fn_bitly_config_set(p_patch jsonb)
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
  values ('bitly', coalesce(p_patch, '{}'::jsonb), auth.uid(), now())
  on conflict (key) do update
    set value = public.app_settings.value || coalesce(p_patch, '{}'::jsonb),
        updated_by = excluded.updated_by,
        updated_at = now();
end $$;

revoke all on function public.fn_bitly_config_set(jsonb) from public, anon;
grant execute on function public.fn_bitly_config_set(jsonb) to authenticated;

-- --------------------------------------------------------------- upserts

-- One round trip for a whole sync batch.
create or replace function public.fn_bitly_upsert_links(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_n integer;
begin
  insert into public.bitly_links (
    id, link, long_url, title, tags, archived, group_guid, bitly_created_at,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    dest_host, dest_path, total_clicks, synced_at)
  select r.id, r.link, r.long_url, r.title, r.tags, coalesce(r.archived, false),
         r.group_guid, r.bitly_created_at,
         r.utm_source, r.utm_medium, r.utm_campaign, r.utm_content, r.utm_term,
         r.dest_host, r.dest_path, coalesce(r.total_clicks, 0), now()
  from jsonb_to_recordset(p_rows) as r (
    id text, link text, long_url text, title text, tags text[], archived boolean,
    group_guid text, bitly_created_at timestamptz,
    utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
    dest_host text, dest_path text, total_clicks integer)
  where r.id is not null
  on conflict (id) do update set
    link = excluded.link, long_url = excluded.long_url, title = excluded.title,
    tags = excluded.tags, archived = excluded.archived, group_guid = excluded.group_guid,
    bitly_created_at = excluded.bitly_created_at,
    utm_source = excluded.utm_source, utm_medium = excluded.utm_medium,
    utm_campaign = excluded.utm_campaign, utm_content = excluded.utm_content,
    utm_term = excluded.utm_term, dest_host = excluded.dest_host, dest_path = excluded.dest_path,
    -- a link absent from the sorted-clicks page keeps its previous count
    total_clicks = greatest(excluded.total_clicks, public.bitly_links.total_clicks),
    synced_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.fn_bitly_upsert_clicks(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_n integer;
begin
  insert into public.bitly_clicks_daily (bitlink_id, date, clicks)
  select r.bitlink_id, r.date, coalesce(r.clicks, 0)
  from jsonb_to_recordset(p_rows) as r (bitlink_id text, date date, clicks integer)
  where r.bitlink_id is not null and r.date is not null
    and exists (select 1 from public.bitly_links l where l.id = r.bitlink_id)
  on conflict (bitlink_id, date) do update set clicks = excluded.clicks;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.fn_bitly_upsert_metrics(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_n integer;
begin
  insert into public.bitly_metrics (bitlink_id, kind, value, clicks, period_start, period_end)
  select r.bitlink_id, r.kind, r.value, coalesce(r.clicks, 0), r.period_start, r.period_end
  from jsonb_to_recordset(p_rows) as r (
    bitlink_id text, kind text, value text, clicks integer, period_start date, period_end date)
  where r.bitlink_id is not null and r.kind in ('referrer', 'country') and r.value is not null
    and exists (select 1 from public.bitly_links l where l.id = r.bitlink_id)
  on conflict (bitlink_id, kind, value, period_start) do update
    set clicks = excluded.clicks, period_end = excluded.period_end;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.fn_bitly_upsert_links(jsonb) from public, anon;
revoke all on function public.fn_bitly_upsert_clicks(jsonb) from public, anon;
revoke all on function public.fn_bitly_upsert_metrics(jsonb) from public, anon;
grant execute on function public.fn_bitly_upsert_links(jsonb) to authenticated;
grant execute on function public.fn_bitly_upsert_clicks(jsonb) to authenticated;
grant execute on function public.fn_bitly_upsert_metrics(jsonb) to authenticated;

-- -------------------------------------------------------------- overview

create or replace function public.fn_bitly_overview(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with gate as (select (select public.my_role()) in ('admin', 'manager', 'viewer') as ok),
  daily as (
    select d.date, sum(d.clicks) as clicks
    from public.bitly_clicks_daily d, gate
    where gate.ok and d.date between p_from and p_to
    group by 1
  ),
  per_link as (
    select l.id, l.link, l.title, l.long_url, l.utm_campaign, l.utm_content,
           coalesce(sum(d.clicks), 0) as clicks
    from public.bitly_links l
    left join public.bitly_clicks_daily d on d.bitlink_id = l.id and d.date between p_from and p_to
    where (select ok from gate)
    group by l.id
  ),
  refs as (
    select m.value, sum(m.clicks) as clicks
    from public.bitly_metrics m, gate
    where gate.ok and m.kind = 'referrer' and m.period_end >= p_from and m.period_start <= p_to
    group by 1 order by 2 desc limit 12
  ),
  countries as (
    select m.value, sum(m.clicks) as clicks
    from public.bitly_metrics m, gate
    where gate.ok and m.kind = 'country' and m.period_end >= p_from and m.period_start <= p_to
    group by 1 order by 2 desc limit 12
  )
  select case when (select ok from gate) then jsonb_build_object(
    'total_clicks', (select coalesce(sum(clicks), 0) from daily),
    'links_total', (select count(*) from public.bitly_links),
    'links_with_clicks', (select count(*) from per_link where clicks > 0),
    'links_tagged', (select count(*) from public.bitly_links where utm_campaign is not null),
    'last_sync', (select max(finished_at) from public.bitly_syncs where ok),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', date, 'clicks', clicks) order by date), '[]'::jsonb) from daily),
    'top_links', (select coalesce(jsonb_agg(to_jsonb(t) order by t.clicks desc), '[]'::jsonb)
                  from (select * from per_link where clicks > 0 order by clicks desc limit 25) t),
    'referrers', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from refs r),
    'countries', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from countries c)
  ) else '{}'::jsonb end;
$$;

revoke all on function public.fn_bitly_overview(date, date) from public, anon;
grant execute on function public.fn_bitly_overview(date, date) to authenticated;

-- ------------------------------------------- the four-witness reconciliation

-- Per Meta campaign: what Meta charged for, what Bitly actually redirected,
-- what GA4 saw arrive, and what the store actually shipped.
create or replace function public.fn_bitly_vs_ads(p_from date, p_to date)
returns table (
  campaign_name text,
  bitlinks bigint,
  spend numeric,
  meta_clicks numeric,
  meta_landing_views numeric,
  bitly_clicks numeric,
  ga4_sessions numeric,
  ga4_orders bigint,
  store_revenue numeric,
  bitly_vs_meta numeric,      -- bitly redirects ÷ meta link clicks
  ga4_vs_bitly numeric,       -- ga4 sessions ÷ bitly redirects
  verdict text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with gate as (select (select public.my_role()) in ('admin', 'manager', 'viewer') as ok),
  camps as (
    select i.campaign_name,
           public.norm_ad(i.campaign_name) as key,
           sum(i.spend) as spend,
           sum(i.link_clicks) as meta_clicks,
           sum(i.landing_page_views) as meta_lpv
    from public.ad_insights i, gate
    where gate.ok and i.level = 'ad'
      and i.period_end >= p_from and i.period_start <= p_to
      and i.campaign_name is not null
    group by 1, 2
  ),
  -- normalise each distinct string once; never inside a join condition
  link_keys as materialized (
    select l.id, public.norm_ad(l.utm_campaign) as key
    from public.bitly_links l
    where l.utm_campaign is not null
  ),
  bitly as (
    select lk.key, count(distinct lk.id) as links, sum(d.clicks) as clicks
    from link_keys lk
    join public.bitly_clicks_daily d on d.bitlink_id = lk.id and d.date between p_from and p_to
    group by 1
  ),
  src_camp as materialized (
    select campaign, public.norm_ad(campaign) as key
    from (select distinct campaign from public.ga4_sources
          where date between p_from and p_to and campaign is not null) c
  ),
  ga4 as (
    select sc.key, sum(g.sessions) as sessions
    from src_camp sc
    join public.ga4_sources g on g.campaign = sc.campaign and g.date between p_from and p_to
    group by 1
  ),
  tx_camp as materialized (
    select campaign, public.norm_ad(campaign) as key
    from (select distinct campaign from public.ga4_transactions where campaign is not null) c
  ),
  orders as (
    select tc.key,
           count(distinct o.order_number) as orders,
           coalesce(sum(o.total_order_amount) filter (where o.order_status <> 'Cancelled'), 0) as revenue
    from tx_camp tc
    join public.ga4_transactions t on t.campaign = tc.campaign
    join public.orders o on o.tx_key = t.transaction_id
     and o.order_date >= p_from and o.order_date < p_to + 1
    group by 1
  )
  select
    c.campaign_name,
    coalesce(b.links, 0),
    round(coalesce(c.spend, 0), 2),
    coalesce(c.meta_clicks, 0),
    coalesce(c.meta_lpv, 0),
    coalesce(b.clicks, 0),
    coalesce(g.sessions, 0),
    coalesce(o.orders, 0),
    round(coalesce(o.revenue, 0), 2),
    case when coalesce(c.meta_clicks, 0) > 0 and b.clicks is not null
         then round(b.clicks::numeric / c.meta_clicks, 2) end,
    case when coalesce(b.clicks, 0) > 0 and g.sessions is not null
         then round(g.sessions::numeric / b.clicks, 2) end,
    case
      when b.clicks is null then 'no_link'
      when coalesce(c.meta_clicks, 0) = 0 then 'no_meta_clicks'
      when b.clicks::numeric / nullif(c.meta_clicks, 0) < 0.5 then 'clicks_lost'
      when coalesce(g.sessions, 0) < b.clicks * 0.6 then 'landing_lost'
      else 'healthy'
    end
  from camps c
  left join bitly b on b.key = c.key
  left join ga4 g on g.key = c.key
  left join orders o on o.key = c.key
  order by c.spend desc nulls last;
$$;

revoke all on function public.fn_bitly_vs_ads(date, date) from public, anon;
grant execute on function public.fn_bitly_vs_ads(date, date) to authenticated;
