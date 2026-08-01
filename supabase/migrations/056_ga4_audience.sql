-- ============================================================
-- Migration 056: GA4 growth reports (phase 2)
-- Monthly site-search terms, cities, devices and landing pages,
-- plus an orders-by-city helper for the city gap report.
-- Synced by /api/cron/ga4-sync. Run after 055.
-- ============================================================

create table if not exists public.ga4_search_terms (
  period_month date not null,
  term text not null,
  sessions numeric,
  searches numeric,
  imported_at timestamptz not null default now(),
  primary key (period_month, term)
);

create table if not exists public.ga4_cities (
  period_month date not null,
  city text not null,
  sessions numeric,
  active_users numeric,
  add_to_carts numeric,
  purchases numeric,
  revenue numeric,
  imported_at timestamptz not null default now(),
  primary key (period_month, city)
);

create table if not exists public.ga4_devices (
  period_month date not null,
  device text not null,
  sessions numeric,
  active_users numeric,
  add_to_carts numeric,
  purchases numeric,
  revenue numeric,
  imported_at timestamptz not null default now(),
  primary key (period_month, device)
);

create table if not exists public.ga4_landing (
  period_month date not null,
  landing_page text not null,
  sessions numeric,
  active_users numeric,
  bounce_rate numeric,
  purchases numeric,
  revenue numeric,
  imported_at timestamptz not null default now(),
  primary key (period_month, landing_page)
);

do $$
declare t text;
begin
  foreach t in array array['ga4_search_terms','ga4_cities','ga4_devices','ga4_landing'] loop
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

-- actual orders per city in a window (for the GA4 city gap report)
create or replace function public.fn_orders_by_city(p_from date, p_to date, p_limit integer default 60)
returns table (city text, orders bigint, delivered bigint, revenue numeric)
language sql stable set search_path = public
as $$
  select coalesce(nullif(trim(city), ''), '—') as city,
         count(*) as orders,
         count(*) filter (where order_status = 'Delivered') as delivered,
         coalesce(sum(total_order_amount) filter (where order_status <> 'Cancelled'), 0) as revenue
  from public.orders
  where order_date >= p_from and order_date < p_to + 1
  group by 1
  order by orders desc
  limit p_limit;
$$;
