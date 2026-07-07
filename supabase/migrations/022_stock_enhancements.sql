-- ============================================================
-- Migration 022: Stock section enhancements
-- 1) stock_snapshots — history of every stock upload (trends + freshness)
-- 2) stock_move_lists / stock_move_items — saved, trackable move lists
-- 3) fn_stock_engine now returns vendor + cost (EGP values in the UI)
-- 4) fn_upsert_stock records a daily snapshot per SKU on each upload
-- Run after 021.
-- ============================================================

-- 1) Snapshots ------------------------------------------------
create table if not exists public.stock_snapshots (
  snapshot_date date not null default (now() at time zone 'utc')::date,
  sku text not null,
  ecom_stock integer,
  sap_stock integer,
  created_at timestamptz not null default now(),
  primary key (snapshot_date, sku)
);
create index if not exists idx_snap_sku on public.stock_snapshots (sku, snapshot_date desc);

alter table public.stock_snapshots enable row level security;
drop policy if exists snap_read on public.stock_snapshots;
create policy snap_read on public.stock_snapshots for select
  using (public.my_role() in ('admin','manager','viewer'));
drop policy if exists snap_write on public.stock_snapshots;
create policy snap_write on public.stock_snapshots for insert
  with check (public.my_role() in ('admin','manager'));
drop policy if exists snap_update on public.stock_snapshots;
create policy snap_update on public.stock_snapshots for update
  using (public.my_role() in ('admin','manager'));

-- Seed history with today's values so trends start now
insert into public.stock_snapshots (snapshot_date, sku, ecom_stock, sap_stock)
select (now() at time zone 'utc')::date, s.sku, s.ecom_stock, s.sap_stock
from public.stock_items s
where s.ecom_stock is not null or s.sap_stock is not null
on conflict (snapshot_date, sku) do nothing;

-- 2) Move lists ----------------------------------------------
create table if not exists public.stock_move_lists (
  id uuid primary key default gen_random_uuid(),
  list_number text not null,
  status text not null default 'pending' check (status in ('pending','moved','cancelled')),
  notes text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.stock_move_items (
  id bigint generated always as identity primary key,
  list_id uuid not null references public.stock_move_lists(id) on delete cascade,
  sku text not null,
  product_name text,
  qty integer not null,
  shortfall integer not null default 0
);
create index if not exists idx_move_items_list on public.stock_move_items (list_id);

alter table public.stock_move_lists enable row level security;
alter table public.stock_move_items enable row level security;
drop policy if exists sml_read on public.stock_move_lists;
create policy sml_read on public.stock_move_lists for select
  using (public.my_role() in ('admin','manager','viewer'));
drop policy if exists sml_write on public.stock_move_lists;
create policy sml_write on public.stock_move_lists for insert
  with check (public.my_role() in ('admin','manager'));
drop policy if exists sml_update on public.stock_move_lists;
create policy sml_update on public.stock_move_lists for update
  using (public.my_role() in ('admin','manager'));
drop policy if exists sml_delete on public.stock_move_lists;
create policy sml_delete on public.stock_move_lists for delete
  using (public.my_role() in ('admin','manager'));
drop policy if exists smi_read on public.stock_move_items;
create policy smi_read on public.stock_move_items for select
  using (public.my_role() in ('admin','manager','viewer'));
drop policy if exists smi_write on public.stock_move_items;
create policy smi_write on public.stock_move_items for insert
  with check (public.my_role() in ('admin','manager'));
drop policy if exists smi_delete on public.stock_move_items;
create policy smi_delete on public.stock_move_items for delete
  using (public.my_role() in ('admin','manager'));

create or replace function public.fn_next_move_list_number()
returns text language sql volatile set search_path = public
as $$
  select 'ML-' || to_char(now() at time zone 'utc', 'YYMMDD') || '-' ||
    lpad((count(*) + 1)::text, 2, '0')
  from public.stock_move_lists
  where created_at >= date_trunc('day', now() at time zone 'utc');
$$;
revoke execute on function public.fn_next_move_list_number() from public, anon;

-- 3) Engine returns vendor + cost -----------------------------
drop function if exists public.fn_stock_engine(integer, integer, integer, integer, integer, integer);
create function public.fn_stock_engine(
  p_window_days integer default 30,
  p_coverage_days integer default 45,
  p_global_min integer default 0,
  p_bestseller_min integer default 20,
  p_bestseller_units integer default 20,
  p_max_order integer default 300
)
returns table (
  sku text, product_name text, category text,
  units bigint, velocity numeric, forecast numeric,
  min_applied integer, target numeric,
  ecom_stock integer, sap_stock integer,
  cover_days numeric, need numeric, move_qty numeric, shortfall numeric,
  surplus numeric, status text,
  vendor text, cost numeric, avg_price numeric
)
language sql stable set search_path = public
as $$
  with sales as (
    select coalesce(nullif(i.sku,''),'(no sku)') as sku,
      mode() within group (order by i.product_name) as product_name,
      count(*) filter (where o.order_date >= now() - make_interval(days => p_window_days)) as units,
      count(*) filter (where o.order_date >= now() - make_interval(days => p_window_days*4)
                         and o.order_date < now() - make_interval(days => p_window_days)) as units_hist,
      avg(nullif(i.price, 0)) as avg_price
    from public.order_items i
    join public.orders o on o.order_number = i.order_number
    where o.order_status not in ('Cancelled')
      and o.order_date >= now() - make_interval(days => p_window_days*4)
    group by 1
  ),
  merged as (
    select
      coalesce(s.sku, st.sku) as sku,
      coalesce(s.product_name, st.product_name) as product_name,
      st.category,
      coalesce(s.units, 0) as units,
      coalesce(s.units_hist, 0) as units_hist,
      s.avg_price,
      st.ecom_stock, st.sap_stock, st.min_override,
      st.vendor, st.cost
    from sales s
    full outer join public.stock_items st on st.sku = s.sku
  ),
  calc as (
    select m.*,
      m.units::numeric / greatest(p_window_days,1) as velocity,
      (m.units::numeric / greatest(p_window_days,1)) * p_coverage_days as forecast,
      coalesce(
        m.min_override,
        case when m.units >= p_bestseller_units then greatest(p_bestseller_min, p_global_min)
             when m.units > 0 then p_global_min
             else 0 end
      ) as min_applied
    from merged m
    where m.units > 0 or m.units_hist >= 10 or coalesce(m.ecom_stock,0) > 0 or coalesce(m.sap_stock,0) > 0
  ),
  eng as (
    select c.*,
      greatest(ceil(c.forecast), c.min_applied) as target,
      greatest(greatest(ceil(c.forecast), c.min_applied) - coalesce(c.ecom_stock, 0), 0) as need
    from calc c
  )
  select
    e.sku, e.product_name, e.category,
    e.units,
    round(e.velocity, 3) as velocity,
    round(e.forecast, 1) as forecast,
    e.min_applied::integer,
    e.target::numeric,
    e.ecom_stock, e.sap_stock,
    case when e.ecom_stock is null or e.velocity = 0 then null
         else round(e.ecom_stock / e.velocity, 1) end as cover_days,
    e.need::numeric,
    least(least(e.need, coalesce(e.sap_stock, e.need)), p_max_order)::numeric as move_qty,
    greatest(e.need - coalesce(e.sap_stock, 0), 0)::numeric as shortfall,
    case when e.ecom_stock is not null then greatest(coalesce(e.ecom_stock,0) - ceil(e.forecast), 0) else null end::numeric as surplus,
    case
      when coalesce(e.ecom_stock,0) = 0 and coalesce(e.sap_stock,0) = 0 and e.units = 0 and e.units_hist >= 10 then 'oos_reorder'
      when coalesce(e.ecom_stock,0) = 0 and coalesce(e.sap_stock,0) = 0 and e.units > 0 then 'oos_reorder'
      when e.need > 0 and coalesce(e.sap_stock,0) < e.need then 'low_sap'
      when e.need > 0 then 'move'
      when e.ecom_stock is not null and coalesce(e.ecom_stock,0) - ceil(e.forecast) > greatest(e.target,10) then 'overstock'
      else 'ok'
    end as status,
    e.vendor, e.cost, round(e.avg_price, 2) as avg_price
  from eng e
  order by e.need desc, e.units desc;
$$;

-- 4) Upsert records a daily snapshot --------------------------
create or replace function public.fn_upsert_stock(p_rows jsonb)
returns integer
language plpgsql set search_path = public
as $$
declare n integer;
begin
  if public.my_role() not in ('admin','manager') then raise exception 'Forbidden'; end if;
  insert into public.stock_items (sku, product_name, ecom_stock, sap_stock, category, vendor, cost, updated_at)
  select
    r->>'sku', nullif(r->>'product_name',''),
    nullif(r->>'ecom_stock','')::integer, nullif(r->>'sap_stock','')::integer,
    nullif(r->>'category',''), nullif(r->>'vendor',''), nullif(r->>'cost','')::numeric, now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'sku','') <> ''
  on conflict (sku) do update set
    product_name = coalesce(excluded.product_name, stock_items.product_name),
    ecom_stock = coalesce(excluded.ecom_stock, stock_items.ecom_stock),
    sap_stock = coalesce(excluded.sap_stock, stock_items.sap_stock),
    category = coalesce(excluded.category, stock_items.category),
    vendor = coalesce(excluded.vendor, stock_items.vendor),
    cost = coalesce(excluded.cost, stock_items.cost),
    updated_at = now();
  get diagnostics n = row_count;

  -- record post-merge values as today's snapshot for the touched SKUs
  insert into public.stock_snapshots (snapshot_date, sku, ecom_stock, sap_stock)
  select (now() at time zone 'utc')::date, s.sku, s.ecom_stock, s.sap_stock
  from public.stock_items s
  where s.sku in (select r->>'sku' from jsonb_array_elements(p_rows) r where coalesce(r->>'sku','') <> '')
  on conflict (snapshot_date, sku) do update set
    ecom_stock = excluded.ecom_stock,
    sap_stock = excluded.sap_stock,
    created_at = now();

  return n;
end;
$$;
