-- ============================================================
-- Misr Hub - Operations Platform
-- Migration 001: schema, roles, RLS, analytics functions
-- Run this whole file in Supabase SQL Editor (or supabase db push)
-- ============================================================

-- ---------- PROFILES & ROLES ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'viewer' check (role in ('admin', 'manager', 'viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Role helper (security definer avoids RLS recursion on profiles)
create or replace function public.role_of(uid uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = uid and is_active;
$$;

create or replace function public.my_role()
returns text
language sql stable security definer set search_path = public
as $$
  select public.role_of(auth.uid());
$$;

-- Auto-create a profile whenever a user is created in Supabase Auth.
-- The very first user of the system automatically becomes admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_role text := 'viewer';
begin
  if not exists (select 1 from public.profiles where role = 'admin') then
    v_role := 'admin';
  end if;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'role', v_role)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- ORDERS ----------

create table if not exists public.orders (
  order_number text primary key,
  customer_id text,
  awb_number text,
  erp_sales_order_number text,
  order_date timestamptz,
  shipping_date timestamptz,
  delivery_date timestamptz,
  delivery_status text,
  order_status text,
  payment_method text,
  plan_installment text,
  transaction_number text,
  erp_customer_account text,
  customer_name text,
  customer_phone text,
  customer_ip text,
  is_bundle boolean,
  promo_amount numeric,
  actual_delivery_fees numeric,
  original_delivery_fees numeric,
  purchase_fees numeric,
  provider_purchase_fees numeric,
  total_cart_amount numeric,
  total_order_amount numeric,
  online_paid_amount numeric,
  total_cash_amount numeric,
  loyalty_discount numeric,
  cod_amount numeric,
  insurance_amount numeric,
  branch_name text,
  address_name text,
  city text,
  area text,
  district text,
  full_address text,
  customer_notes text,
  admin_notes text,
  cancellation_reason text,
  cancellation_note text,
  store_name text,
  time_slot text,
  source text,
  created_by text,
  applied_offer text,
  applied_promotion text,
  campaign_id text,
  erp_send_date timestamptz,
  erp_delivery_number text,
  customer_rating numeric,
  driver_rating numeric,
  items_count integer,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_order_date on public.orders (order_date);
create index if not exists idx_orders_status on public.orders (order_status);
create index if not exists idx_orders_delivery_status on public.orders (delivery_status);
create index if not exists idx_orders_payment on public.orders (payment_method);
create index if not exists idx_orders_city on public.orders (city);
create index if not exists idx_orders_source on public.orders (source);
create index if not exists idx_orders_customer on public.orders (customer_id);
create index if not exists idx_orders_phone on public.orders (customer_phone);

create table if not exists public.order_items (
  order_number text not null references public.orders (order_number) on delete cascade,
  position integer not null,
  product_name text,
  sku text,
  price numeric,
  primary key (order_number, position)
);

create index if not exists idx_items_sku on public.order_items (sku);
create index if not exists idx_items_product on public.order_items (product_name);

create table if not exists public.order_events (
  order_number text not null references public.orders (order_number) on delete cascade,
  seq integer not null,
  state_name text,
  admin_name text,
  state_date timestamptz,
  primary key (order_number, seq)
);

create index if not exists idx_events_admin on public.order_events (admin_name);
create index if not exists idx_events_state on public.order_events (state_name);
create index if not exists idx_events_date on public.order_events (state_date);

-- ---------- UPLOADS & AUDIT ----------

create table if not exists public.uploads (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  uploaded_by uuid references public.profiles (id),
  uploaded_by_email text,
  total_rows integer not null default 0,
  processed_rows integer not null default 0,
  failed_rows integer not null default 0,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid,
  user_email text,
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_created on public.audit_log (created_at desc);

-- ---------- ROW LEVEL SECURITY ----------

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
alter table public.uploads enable row level security;
alter table public.audit_log enable row level security;

-- Profiles: users can see their own profile; admins can see and edit all
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid() or public.my_role() = 'admin');

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update using (public.my_role() = 'admin');

-- Data tables: any active role can read. Writes happen only through
-- the server API (service role bypasses RLS), never from the browser.
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders
  for select using (public.my_role() in ('admin', 'manager', 'viewer'));

drop policy if exists items_read on public.order_items;
create policy items_read on public.order_items
  for select using (public.my_role() in ('admin', 'manager', 'viewer'));

drop policy if exists events_read on public.order_events;
create policy events_read on public.order_events
  for select using (public.my_role() in ('admin', 'manager', 'viewer'));

drop policy if exists uploads_read on public.uploads;
create policy uploads_read on public.uploads
  for select using (public.my_role() in ('admin', 'manager'));

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select using (public.my_role() = 'admin');

-- ---------- ANALYTICS FUNCTIONS ----------
-- All functions are read-only and rely on the caller having read access.

create or replace function public.fn_kpis(p_from timestamptz, p_to timestamptz)
returns json
language sql stable
as $$
  select json_build_object(
    'total_orders', count(*),
    'gross_revenue', coalesce(sum(total_order_amount), 0),
    'net_revenue', coalesce(sum(total_order_amount) filter (where order_status not in ('Cancelled', 'Returned', 'Return Sent To Erp')), 0),
    'delivered_orders', count(*) filter (where order_status = 'Delivered'),
    'cancelled_orders', count(*) filter (where order_status = 'Cancelled'),
    'returned_orders', count(*) filter (where order_status in ('Returned', 'Return Sent To Erp', 'Return Request')),
    'in_progress_orders', count(*) filter (where order_status in ('Placed', 'Confirmed', 'Shipped', 'Out For Delivery', 'Picked by courier', 'Send To Erp')),
    'cod_orders', count(*) filter (where payment_method = 'Cash On Delivery'),
    'cod_amount', coalesce(sum(cod_amount), 0),
    'online_paid_amount', coalesce(sum(online_paid_amount), 0),
    'avg_order_value', coalesce(avg(total_order_amount), 0),
    'unique_customers', count(distinct customer_id),
    'avg_customer_rating', avg(customer_rating) filter (where customer_rating > 0),
    'avg_driver_rating', avg(driver_rating) filter (where driver_rating > 0),
    'avg_delivery_days', avg(extract(epoch from (delivery_date - order_date)) / 86400.0) filter (where delivery_date is not null and order_date is not null)
  )
  from public.orders
  where (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < p_to);
$$;

create or replace function public.fn_orders_by_day(p_from timestamptz, p_to timestamptz)
returns table (day date, orders bigint, revenue numeric, delivered bigint, cancelled bigint)
language sql stable
as $$
  select
    date_trunc('day', order_date)::date as day,
    count(*) as orders,
    coalesce(sum(total_order_amount), 0) as revenue,
    count(*) filter (where order_status = 'Delivered') as delivered,
    count(*) filter (where order_status = 'Cancelled') as cancelled
  from public.orders
  where order_date is not null
    and (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < p_to)
  group by 1
  order by 1;
$$;

create or replace function public.fn_breakdown(p_dim text, p_from timestamptz, p_to timestamptz, p_limit integer default 30)
returns table (label text, orders bigint, revenue numeric, delivered bigint, cancelled_or_returned bigint)
language sql stable
as $$
  select
    coalesce(nullif(trim(case p_dim
      when 'city' then city
      when 'area' then area
      when 'payment_method' then payment_method
      when 'order_status' then order_status
      when 'delivery_status' then delivery_status
      when 'source' then source
      when 'store_name' then store_name
      when 'branch_name' then branch_name
      when 'cancellation_reason' then cancellation_reason
      when 'applied_promotion' then applied_promotion
      when 'campaign_id' then campaign_id
    end), ''), '(none)') as label,
    count(*) as orders,
    coalesce(sum(total_order_amount), 0) as revenue,
    count(*) filter (where order_status = 'Delivered') as delivered,
    count(*) filter (where order_status in ('Cancelled', 'Returned', 'Return Sent To Erp', 'Return Request')) as cancelled_or_returned
  from public.orders
  where (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < p_to)
  group by 1
  order by 2 desc
  limit p_limit;
$$;

create or replace function public.fn_top_products(p_from timestamptz, p_to timestamptz, p_limit integer default 25)
returns table (product_name text, sku text, quantity bigint, revenue numeric)
language sql stable
as $$
  select
    coalesce(i.product_name, '(unknown)') as product_name,
    max(i.sku) as sku,
    count(*) as quantity,
    coalesce(sum(i.price), 0) as revenue
  from public.order_items i
  join public.orders o on o.order_number = i.order_number
  where (p_from is null or o.order_date >= p_from)
    and (p_to is null or o.order_date < p_to)
    and o.order_status not in ('Cancelled')
  group by 1
  order by 3 desc
  limit p_limit;
$$;

create or replace function public.fn_delivery_buckets(p_from timestamptz, p_to timestamptz)
returns table (bucket text, bucket_order integer, orders bigint)
language sql stable
as $$
  with d as (
    select extract(epoch from (delivery_date - order_date)) / 86400.0 as days
    from public.orders
    where delivery_date is not null and order_date is not null
      and (p_from is null or order_date >= p_from)
      and (p_to is null or order_date < p_to)
  )
  select
    case
      when days < 1 then 'Same day'
      when days < 2 then '1 day'
      when days < 3 then '2 days'
      when days < 5 then '3-4 days'
      when days < 8 then '5-7 days'
      else '8+ days'
    end as bucket,
    case
      when days < 1 then 0
      when days < 2 then 1
      when days < 3 then 2
      when days < 5 then 3
      when days < 8 then 4
      else 5
    end as bucket_order,
    count(*) as orders
  from d
  group by 1, 2
  order by 2;
$$;

create or replace function public.fn_team_activity(p_from timestamptz, p_to timestamptz, p_limit integer default 30)
returns table (admin_name text, actions bigint, orders_touched bigint, last_action timestamptz)
language sql stable
as $$
  select
    e.admin_name,
    count(*) as actions,
    count(distinct e.order_number) as orders_touched,
    max(e.state_date) as last_action
  from public.order_events e
  where coalesce(trim(e.admin_name), '') <> ''
    and (p_from is null or e.state_date >= p_from)
    and (p_to is null or e.state_date < p_to)
  group by 1
  order by 2 desc
  limit p_limit;
$$;

create or replace function public.fn_customer_insights(p_from timestamptz, p_to timestamptz)
returns json
language sql stable
as $$
  with c as (
    select customer_id, count(*) as n, sum(total_order_amount) as spent
    from public.orders
    where customer_id is not null
      and (p_from is null or order_date >= p_from)
      and (p_to is null or order_date < p_to)
    group by 1
  )
  select json_build_object(
    'total_customers', (select count(*) from c),
    'repeat_customers', (select count(*) from c where n > 1),
    'avg_orders_per_customer', (select coalesce(avg(n), 0) from c),
    'avg_spend_per_customer', (select coalesce(avg(spent), 0) from c)
  );
$$;

create or replace function public.fn_data_range()
returns json
language sql stable
as $$
  select json_build_object(
    'min_date', min(order_date),
    'max_date', max(order_date),
    'total_orders', count(*)
  ) from public.orders;
$$;

-- Done. Create your first user in Supabase Auth (Authentication -> Users
-- -> Add user) — the first user automatically becomes admin.
