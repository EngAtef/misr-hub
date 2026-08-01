-- ============================================================
-- Migration 058: Google Search Console integration
-- Daily totals + monthly top queries/pages from the GSC API,
-- synced by /api/cron/ga4-sync (same service account as GA4;
-- site URL configured in the Settings "Search Console" card).
-- Run after 057.
-- ============================================================

create table if not exists public.gsc_daily (
  date date primary key,
  clicks numeric,
  impressions numeric,
  ctr numeric,
  position numeric,
  imported_at timestamptz not null default now()
);

create table if not exists public.gsc_queries (
  period_month date not null,
  query text not null,
  clicks numeric,
  impressions numeric,
  ctr numeric,
  position numeric,
  imported_at timestamptz not null default now(),
  primary key (period_month, query)
);

create table if not exists public.gsc_pages (
  period_month date not null,
  page text not null,
  clicks numeric,
  impressions numeric,
  ctr numeric,
  position numeric,
  imported_at timestamptz not null default now(),
  primary key (period_month, page)
);

do $$
declare t text;
begin
  foreach t in array array['gsc_daily','gsc_queries','gsc_pages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format(
      'create policy %I_read on public.%I for select using ((select public.my_role()) in (''admin'',''manager'',''viewer''))', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format(
      'create policy %I_write on public.%I for insert with check ((select public.my_role()) in (''admin'',''manager''))', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      'create policy %I_update on public.%I for update using ((select public.my_role()) in (''admin'',''manager''))', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format(
      'create policy %I_delete on public.%I for delete using ((select public.my_role()) in (''admin'',''manager''))', t, t);
  end loop;
end $$;
