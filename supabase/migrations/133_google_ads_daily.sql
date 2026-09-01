-- ============================================================
-- Migration 133: Google Ads daily performance.
--
-- Filled by /api/cron/ga4-sync via the GA4 Data API: the Google Ads
-- account is LINKED to the GA4 property, so campaign cost/clicks/
-- impressions flow through the existing service account — no Google
-- Ads API developer token needed. sessions/purchases/revenue are
-- GA4-attributed (same last-click model as ga4_sources), so ROAS here
-- is directly comparable with the rest of the Traffic page.
-- One row per (date, campaign); sync upserts, so re-syncs are safe.
-- ============================================================

create table if not exists public.google_ads_daily (
  date date not null,
  campaign text not null,
  cost numeric,
  clicks numeric,
  impressions numeric,
  sessions numeric,
  purchases numeric,
  revenue numeric,
  imported_at timestamptz not null default now(),
  primary key (date, campaign)
);

alter table public.google_ads_daily enable row level security;

drop policy if exists gads_read on public.google_ads_daily;
create policy gads_read on public.google_ads_daily for select
  using ((select public.my_role()) in ('admin','manager','viewer'));

drop policy if exists gads_write on public.google_ads_daily;
create policy gads_write on public.google_ads_daily for insert
  with check ((select public.my_role()) in ('admin','manager'));

drop policy if exists gads_update on public.google_ads_daily;
create policy gads_update on public.google_ads_daily for update
  using ((select public.my_role()) in ('admin','manager'));

drop policy if exists gads_delete on public.google_ads_daily;
create policy gads_delete on public.google_ads_daily for delete
  using ((select public.my_role()) in ('admin','manager'));
