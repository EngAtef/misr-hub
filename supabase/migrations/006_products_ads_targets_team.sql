-- ============================================================
-- Misr Hub - Migration 006
-- Products/SKU, purchasers, stock reorder, ads, targets, team, settings
-- Run after 005_secure_signups.sql
-- ============================================================

create table if not exists public.stock_items (
  sku text primary key,
  product_name text,
  current_stock integer,
  lead_time_days integer default 7,
  notes text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

create table if not exists public.ad_spend (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'facebook',
  batch_label text,
  campaign_name text,
  ad_group text,
  ad_name text,
  reach numeric,
  impressions numeric,
  amount_spent numeric,
  reported_purchases numeric,
  cost_per_purchase numeric,
  reported_conversion_value numeric,
  frequency numeric,
  clicks_all numeric,
  link_clicks numeric,
  report_start date,
  report_end date,
  match_keyword text,
  mapped_sku text,
  imported_by uuid references public.profiles (id),
  imported_at timestamptz not null default now()
);
create index if not exists idx_adspend_dates on public.ad_spend (report_start, report_end);
create index if not exists idx_adspend_batch on public.ad_spend (batch_label);

create table if not exists public.targets (
  id uuid primary key default gen_random_uuid(),
  period_month date not null unique,
  quarter text,
  label text,
  total_target numeric not null default 0,
  kids_target numeric default 0,
  cultural_target numeric default 0,
  aov numeric default 550,
  conv_rate numeric default 0.015,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.team_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  title text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

alter table public.stock_items enable row level security;
alter table public.ad_spend enable row level security;
alter table public.targets enable row level security;
alter table public.team_contacts enable row level security;
alter table public.app_settings enable row level security;

do $$
declare t text;
begin
  foreach t in array array['stock_items','ad_spend','targets','team_contacts'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select using (public.my_role() in (''admin'',''manager'',''viewer''))', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for insert with check (public.my_role() in (''admin'',''manager''))', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('create policy %I_update on public.%I for update using (public.my_role() in (''admin'',''manager''))', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('create policy %I_delete on public.%I for delete using (public.my_role() in (''admin'',''manager''))', t, t);
  end loop;
end $$;

drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings for select using (public.my_role() = 'admin');
drop policy if exists settings_write on public.app_settings;
create policy settings_write on public.app_settings for insert with check (public.my_role() = 'admin');
drop policy if exists settings_update on public.app_settings;
create policy settings_update on public.app_settings for update using (public.my_role() = 'admin');

create or replace function public.fn_product_stats(p_from timestamptz, p_to timestamptz, p_search text default null, p_limit integer default 200)
returns table (sku text, product_name text, units bigint, orders bigint, revenue numeric)
language sql stable
as $$
  select
    coalesce(nullif(i.sku, ''), '(no sku)') as sku,
    mode() within group (order by i.product_name) as product_name,
    count(*) as units,
    count(distinct i.order_number) as orders,
    coalesce(sum(i.price), 0) as revenue
  from public.order_items i
  join public.orders o on o.order_number = i.order_number
  where o.order_status not in ('Cancelled')
    and (p_from is null or o.order_date >= p_from)
    and (p_to is null or o.order_date < p_to)
    and (p_search is null or p_search = '' or i.product_name ilike '%'||p_search||'%' or i.sku ilike '%'||p_search||'%')
  group by 1
  order by units desc
  limit p_limit;
$$;

create or replace function public.fn_sku_purchasers(p_sku text, p_keyword text, p_from timestamptz, p_to timestamptz, p_limit integer default 5000)
returns table (
  order_number text, order_date timestamptz, order_status text,
  customer_id text, customer_name text, customer_phone text, city text, area text,
  product_name text, sku text, units bigint, book_amount numeric, order_total numeric,
  payment_method text
)
language sql stable
as $$
  select
    o.order_number, o.order_date, o.order_status,
    o.customer_id, o.customer_name, o.customer_phone, o.city, o.area,
    mode() within group (order by i.product_name) as product_name,
    max(i.sku) as sku,
    count(*) as units,
    coalesce(sum(i.price), 0) as book_amount,
    max(o.total_order_amount) as order_total,
    max(o.payment_method) as payment_method
  from public.order_items i
  join public.orders o on o.order_number = i.order_number
  where (
      (p_sku is not null and p_sku <> '' and i.sku = p_sku)
      or (p_keyword is not null and p_keyword <> '' and i.product_name ilike '%'||p_keyword||'%')
    )
    and (p_from is null or o.order_date >= p_from)
    and (p_to is null or o.order_date < p_to)
  group by o.order_number, o.order_date, o.order_status, o.customer_id, o.customer_name, o.customer_phone, o.city, o.area
  order by o.order_date desc
  limit p_limit;
$$;

create or replace function public.fn_reorder_suggestions(
  p_period_days integer default 30,
  p_cover_days integer default 30,
  p_min_units integer default 3
)
returns table (
  sku text, product_name text,
  units_recent bigint, units_prior bigint,
  velocity_per_day numeric, trend_pct numeric,
  projected_demand numeric, current_stock integer,
  lead_time_days integer, days_of_cover numeric,
  suggested_reorder numeric, priority text
)
language sql stable
as $$
  with recent as (
    select coalesce(nullif(i.sku,''),'(no sku)') as sku,
           mode() within group (order by i.product_name) as product_name,
           count(*) as units
    from public.order_items i
    join public.orders o on o.order_number = i.order_number
    where o.order_status not in ('Cancelled')
      and o.order_date >= now() - make_interval(days => p_period_days)
    group by 1
  ),
  prior as (
    select coalesce(nullif(i.sku,''),'(no sku)') as sku, count(*) as units
    from public.order_items i
    join public.orders o on o.order_number = i.order_number
    where o.order_status not in ('Cancelled')
      and o.order_date >= now() - make_interval(days => p_period_days*2)
      and o.order_date < now() - make_interval(days => p_period_days)
    group by 1
  )
  select
    r.sku,
    r.product_name,
    r.units as units_recent,
    coalesce(p.units,0) as units_prior,
    round(r.units::numeric / greatest(p_period_days,1), 3) as velocity_per_day,
    case when coalesce(p.units,0) = 0 then null
         else round((r.units - p.units)::numeric * 100 / p.units, 1) end as trend_pct,
    round(r.units::numeric / greatest(p_period_days,1) * (p_cover_days + coalesce(s.lead_time_days,7)), 1) as projected_demand,
    s.current_stock,
    coalesce(s.lead_time_days,7) as lead_time_days,
    case when s.current_stock is null then null
         when r.units = 0 then null
         else round(s.current_stock::numeric / (r.units::numeric / greatest(p_period_days,1)), 1) end as days_of_cover,
    greatest(round(r.units::numeric / greatest(p_period_days,1) * (p_cover_days + coalesce(s.lead_time_days,7)) - coalesce(s.current_stock,0), 0), 0) as suggested_reorder,
    case
      when s.current_stock is not null and r.units > 0
           and s.current_stock::numeric / (r.units::numeric / greatest(p_period_days,1)) < coalesce(s.lead_time_days,7)
        then 'urgent'
      when s.current_stock is null and r.units >= p_min_units * 3 then 'high'
      when coalesce(p.units,0) > 0 and (r.units - p.units)::numeric / p.units > 0.5 then 'rising'
      else 'normal'
    end as priority
  from recent r
  left join prior p on p.sku = r.sku
  left join public.stock_items s on s.sku = r.sku
  where r.units >= p_min_units
  order by r.units desc;
$$;

create or replace function public.fn_ads_performance(p_from date, p_to date, p_batch text default null)
returns table (
  id uuid, source text, campaign_name text, ad_name text,
  match_keyword text, mapped_sku text,
  spend numeric, reported_purchases numeric, reported_value numeric,
  link_clicks numeric,
  actual_orders bigint, actual_units bigint, actual_revenue numeric,
  reported_roas numeric, actual_roas numeric, actual_cr numeric,
  report_start date, report_end date
)
language sql stable
as $$
  select
    a.id, a.source, a.campaign_name, a.ad_name,
    a.match_keyword, a.mapped_sku,
    a.amount_spent as spend, a.reported_purchases, a.reported_conversion_value as reported_value,
    a.link_clicks,
    act.orders as actual_orders, act.units as actual_units, act.revenue as actual_revenue,
    case when a.amount_spent > 0 then round(a.reported_conversion_value / a.amount_spent, 2) end as reported_roas,
    case when a.amount_spent > 0 then round(act.revenue / a.amount_spent, 2) end as actual_roas,
    case when a.link_clicks > 0 then round(act.orders::numeric * 100 / a.link_clicks, 2) end as actual_cr,
    a.report_start, a.report_end
  from public.ad_spend a
  left join lateral (
    select count(distinct o.order_number) as orders,
           count(*) as units,
           coalesce(sum(i.price),0) as revenue
    from public.order_items i
    join public.orders o on o.order_number = i.order_number
    where o.order_status not in ('Cancelled')
      and o.order_date >= coalesce(a.report_start, p_from)
      and o.order_date < coalesce(a.report_end, p_to) + interval '1 day'
      and (
        (a.mapped_sku is not null and a.mapped_sku <> '' and i.sku = a.mapped_sku)
        or ((a.mapped_sku is null or a.mapped_sku = '') and a.match_keyword is not null and a.match_keyword <> ''
            and i.product_name ilike '%'||a.match_keyword||'%')
      )
  ) act on true
  where (p_batch is null or a.batch_label = p_batch)
    and (p_from is null or a.report_end >= p_from)
    and (p_to is null or a.report_start <= p_to)
  order by a.amount_spent desc nulls last;
$$;

create or replace function public.fn_targets_overview()
returns table (
  period_month date, quarter text, label text,
  total_target numeric, kids_target numeric, cultural_target numeric,
  actual_revenue numeric, actual_orders bigint, progress_pct numeric,
  aov numeric, conv_rate numeric
)
language sql stable
as $$
  select
    t.period_month, t.quarter, t.label,
    t.total_target, t.kids_target, t.cultural_target,
    coalesce(a.rev,0) as actual_revenue,
    coalesce(a.ord,0) as actual_orders,
    case when t.total_target > 0 then round(coalesce(a.rev,0)*100/t.total_target,1) else 0 end as progress_pct,
    t.aov, t.conv_rate
  from public.targets t
  left join lateral (
    select sum(o.total_order_amount) as rev, count(*) as ord
    from public.orders o
    where o.order_status not in ('Cancelled','Returned','Return Sent To Erp')
      and o.order_date >= t.period_month
      and o.order_date < (t.period_month + interval '1 month')
  ) a on true
  order by t.period_month;
$$;
