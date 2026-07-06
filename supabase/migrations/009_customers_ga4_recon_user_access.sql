-- ============================================================
-- Migration 009: customers DB, GA4 order/item reconciliation,
-- per-user page access checklists.
-- Run after 008_promax_ga4_permissions.sql
-- (Applied to production via Supabase MCP on 2026-07-06; the
--  fn_tracking_summary version here includes payment_breakdown.)
-- ============================================================

create table if not exists public.customers (
  customer_id text primary key,
  name text, email text, birthdate date, phone text,
  total_orders integer, language text, is_active boolean,
  joined_at timestamptz, city text, area text, addresses text,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_customers_phone on public.customers (phone);
alter table public.customers enable row level security;
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select using (public.my_role() in ('admin','manager','viewer'));
drop policy if exists customers_write on public.customers;
create policy customers_write on public.customers for insert with check (public.my_role() in ('admin','manager'));
drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers for update using (public.my_role() in ('admin','manager'));

create or replace function public.fn_upsert_customers(p_rows jsonb)
returns integer
language plpgsql
as $$
declare n integer;
begin
  if public.my_role() not in ('admin','manager') then
    raise exception 'Forbidden';
  end if;
  insert into public.customers (customer_id, name, email, birthdate, phone, total_orders, language, is_active, joined_at, city, area, addresses, updated_at)
  select
    r->>'customer_id',
    nullif(r->>'name',''),
    nullif(r->>'email',''),
    nullif(r->>'birthdate','')::date,
    nullif(r->>'phone',''),
    nullif(r->>'total_orders','')::integer,
    nullif(r->>'language',''),
    case when r->>'is_active' in ('1','true') then true when r->>'is_active' in ('0','false') then false else null end,
    nullif(r->>'joined_at','')::timestamptz,
    nullif(r->>'city',''),
    nullif(r->>'area',''),
    nullif(r->>'addresses',''),
    now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'customer_id','') <> ''
  on conflict (customer_id) do update set
    name = coalesce(excluded.name, customers.name),
    email = coalesce(excluded.email, customers.email),
    birthdate = coalesce(excluded.birthdate, customers.birthdate),
    phone = coalesce(excluded.phone, customers.phone),
    total_orders = coalesce(excluded.total_orders, customers.total_orders),
    language = coalesce(excluded.language, customers.language),
    is_active = coalesce(excluded.is_active, customers.is_active),
    joined_at = coalesce(excluded.joined_at, customers.joined_at),
    city = coalesce(excluded.city, customers.city),
    area = coalesce(excluded.area, customers.area),
    addresses = coalesce(excluded.addresses, customers.addresses),
    updated_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

create table if not exists public.ga4_transactions (
  transaction_id text primary key,
  period_month date not null,
  purchases numeric,
  revenue numeric,
  imported_at timestamptz not null default now()
);
create index if not exists idx_ga4tx_month on public.ga4_transactions (period_month);
alter table public.ga4_transactions enable row level security;
drop policy if exists ga4tx_read on public.ga4_transactions;
create policy ga4tx_read on public.ga4_transactions for select using (public.my_role() in ('admin','manager','viewer'));
drop policy if exists ga4tx_write on public.ga4_transactions;
create policy ga4tx_write on public.ga4_transactions for insert with check (public.my_role() in ('admin','manager'));
drop policy if exists ga4tx_update on public.ga4_transactions;
create policy ga4tx_update on public.ga4_transactions for update using (public.my_role() in ('admin','manager'));
drop policy if exists ga4tx_delete on public.ga4_transactions;
create policy ga4tx_delete on public.ga4_transactions for delete using (public.my_role() in ('admin','manager'));

create table if not exists public.ga4_items (
  period_month date not null,
  item_name text not null,
  items_viewed numeric,
  items_added numeric,
  items_purchased numeric,
  item_revenue numeric,
  imported_at timestamptz not null default now(),
  primary key (period_month, item_name)
);
alter table public.ga4_items enable row level security;
drop policy if exists ga4items_read on public.ga4_items;
create policy ga4items_read on public.ga4_items for select using (public.my_role() in ('admin','manager','viewer'));
drop policy if exists ga4items_write on public.ga4_items;
create policy ga4items_write on public.ga4_items for insert with check (public.my_role() in ('admin','manager'));
drop policy if exists ga4items_delete on public.ga4_items;
create policy ga4items_delete on public.ga4_items for delete using (public.my_role() in ('admin','manager'));

create or replace function public.fn_tracking_summary(p_month date)
returns json
language sql stable
as $$
  with o as (
    select order_number, total_order_amount, source, payment_method
    from public.orders
    where order_date >= p_month and order_date < p_month + interval '1 month'
  ),
  g as (
    select transaction_id, revenue from public.ga4_transactions where period_month = p_month
  )
  select json_build_object(
    'orders', (select count(*) from o),
    'orders_revenue', (select coalesce(sum(total_order_amount),0) from o),
    'ga4_transactions', (select count(*) from g),
    'ga4_revenue', (select coalesce(sum(revenue),0) from g),
    'tracked', (select count(*) from o where exists (select 1 from g where g.transaction_id = o.order_number)),
    'untracked', (select count(*) from o where not exists (select 1 from g where g.transaction_id = o.order_number)),
    'untracked_revenue', (select coalesce(sum(o.total_order_amount),0) from o where not exists (select 1 from g where g.transaction_id = o.order_number)),
    'ga4_only', (select count(*) from g where not exists (select 1 from o where o.order_number = g.transaction_id)),
    'untracked_by_source', (
      select coalesce(json_object_agg(coalesce(source,'unknown'), cnt), '{}'::json) from (
        select source, count(*) as cnt from o
        where not exists (select 1 from g where g.transaction_id = o.order_number)
        group by source
      ) s
    ),
    'payment_breakdown', (
      select coalesce(json_agg(row_to_json(p)), '[]'::json) from (
        select
          coalesce(payment_method,'unknown') as payment_method,
          count(*) filter (where not exists (select 1 from g where g.transaction_id = o.order_number)) as untracked,
          count(*) as total
        from o
        group by payment_method
        order by 2 desc
      ) p
    )
  );
$$;

create or replace function public.fn_untracked_orders(p_month date, p_limit integer default 500)
returns table (
  order_number text, order_date timestamptz, order_status text,
  payment_method text, source text, city text, total_order_amount numeric
)
language sql stable
as $$
  select o.order_number, o.order_date, o.order_status, o.payment_method, o.source, o.city, o.total_order_amount
  from public.orders o
  where o.order_date >= p_month and o.order_date < p_month + interval '1 month'
    and not exists (
      select 1 from public.ga4_transactions g
      where g.period_month = p_month and g.transaction_id = o.order_number
    )
  order by o.total_order_amount desc nulls last
  limit p_limit;
$$;

create or replace function public.fn_item_tracking_gaps(p_month date, p_limit integer default 40)
returns table (
  item_name text, ga4_purchased numeric, actual_units bigint, gap numeric, ga4_revenue numeric, actual_revenue numeric
)
language sql stable
as $$
  with actual as (
    select i.product_name, count(*) as units, coalesce(sum(i.price),0) as revenue
    from public.order_items i
    join public.orders o on o.order_number = i.order_number
    where o.order_date >= p_month and o.order_date < p_month + interval '1 month'
      and o.order_status not in ('Cancelled')
    group by 1
  ),
  g as (
    select item_name, items_purchased, item_revenue from public.ga4_items where period_month = p_month
  )
  select
    coalesce(a.product_name, g.item_name) as item_name,
    coalesce(g.items_purchased, 0) as ga4_purchased,
    coalesce(a.units, 0) as actual_units,
    coalesce(a.units, 0) - coalesce(g.items_purchased, 0) as gap,
    coalesce(g.item_revenue, 0) as ga4_revenue,
    coalesce(a.revenue, 0) as actual_revenue
  from actual a
  full outer join g on g.item_name = a.product_name
  where coalesce(a.units,0) >= 10 or coalesce(g.items_purchased,0) >= 10
  order by abs(coalesce(a.units, 0) - coalesce(g.items_purchased, 0)) desc
  limit p_limit;
$$;

create table if not exists public.user_page_access (
  user_id uuid not null references public.profiles (id) on delete cascade,
  page_key text not null,
  allowed boolean not null default true,
  primary key (user_id, page_key)
);
alter table public.user_page_access enable row level security;
drop policy if exists upa_read_own on public.user_page_access;
create policy upa_read_own on public.user_page_access
  for select using (user_id = auth.uid() or public.my_role() = 'admin');
drop policy if exists upa_admin_write on public.user_page_access;
create policy upa_admin_write on public.user_page_access
  for insert with check (public.my_role() = 'admin');
drop policy if exists upa_admin_update on public.user_page_access;
create policy upa_admin_update on public.user_page_access
  for update using (public.my_role() = 'admin');
drop policy if exists upa_admin_delete on public.user_page_access;
create policy upa_admin_delete on public.user_page_access
  for delete using (public.my_role() = 'admin');
