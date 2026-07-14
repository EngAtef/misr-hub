-- ============================================================
-- Migration 023: customer lifetime order stats (bulk
-- CustomerOrdersExport file) + analytics RPCs that use them.
-- Run after 022_stock_enhancements.sql
-- ============================================================

-- Lifetime aggregates come from the platform's CustomerOrdersExport
-- (per-customer full history), so they cover orders older than
-- anything in public.orders.
alter table public.customers
  add column if not exists lifetime_orders integer,
  add column if not exists lifetime_delivered integer,
  add column if not exists lifetime_canceled integer,
  add column if not exists lifetime_amount numeric,
  add column if not exists lifetime_delivered_amount numeric,
  add column if not exists lifetime_canceled_amount numeric,
  add column if not exists last_order_at date,
  add column if not exists last_order_state text,
  add column if not exists last_delivered_at date,
  add column if not exists stats_updated_at timestamptz;

create index if not exists idx_customers_last_order_at on public.customers (last_order_at desc nulls last);
create index if not exists idx_customers_lt_delivered_amount on public.customers (lifetime_delivered_amount desc nulls last);

-- Upsert from the bulk export. Stats always take the fresh value;
-- profile fields (name/phone/city/area/addresses) only fill gaps or
-- update when the export has a value.
create or replace function public.fn_upsert_customer_stats(p_rows jsonb)
returns integer
language plpgsql
as $$
declare n integer;
begin
  if public.my_role() not in ('admin','manager') then
    raise exception 'Forbidden';
  end if;
  insert into public.customers (
    customer_id, name, phone, city, area, addresses,
    lifetime_orders, lifetime_delivered, lifetime_canceled,
    lifetime_amount, lifetime_delivered_amount, lifetime_canceled_amount,
    last_order_at, last_order_state, last_delivered_at,
    stats_updated_at, updated_at
  )
  select
    r->>'customer_id',
    nullif(r->>'name',''),
    nullif(r->>'phone',''),
    nullif(r->>'city',''),
    nullif(r->>'area',''),
    nullif(r->>'addresses',''),
    nullif(r->>'lifetime_orders','')::integer,
    nullif(r->>'lifetime_delivered','')::integer,
    nullif(r->>'lifetime_canceled','')::integer,
    nullif(r->>'lifetime_amount','')::numeric,
    nullif(r->>'lifetime_delivered_amount','')::numeric,
    nullif(r->>'lifetime_canceled_amount','')::numeric,
    nullif(r->>'last_order_at','')::date,
    nullif(r->>'last_order_state',''),
    nullif(r->>'last_delivered_at','')::date,
    now(), now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'customer_id','') <> ''
  on conflict (customer_id) do update set
    name = coalesce(excluded.name, customers.name),
    phone = coalesce(excluded.phone, customers.phone),
    city = coalesce(excluded.city, customers.city),
    area = coalesce(excluded.area, customers.area),
    addresses = coalesce(excluded.addresses, customers.addresses),
    lifetime_orders = excluded.lifetime_orders,
    lifetime_delivered = excluded.lifetime_delivered,
    lifetime_canceled = excluded.lifetime_canceled,
    lifetime_amount = excluded.lifetime_amount,
    lifetime_delivered_amount = excluded.lifetime_delivered_amount,
    lifetime_canceled_amount = excluded.lifetime_canceled_amount,
    last_order_at = excluded.last_order_at,
    last_order_state = excluded.last_order_state,
    last_delivered_at = excluded.last_delivered_at,
    stats_updated_at = now(),
    updated_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Headline lifetime KPIs for the Customers page.
create or replace function public.fn_customer_value_summary()
returns json
language sql stable
as $$
  with s as (
    select * from public.customers where stats_updated_at is not null
  )
  select json_build_object(
    'stats_customers', (select count(*) from s),
    'buyers', (select count(*) from s where coalesce(lifetime_orders,0) > 0),
    'delivered_buyers', (select count(*) from s where coalesce(lifetime_delivered,0) > 0),
    'never_ordered', (select count(*) from s where coalesce(lifetime_orders,0) = 0),
    'repeat_buyers', (select count(*) from s where coalesce(lifetime_delivered,0) >= 2),
    'one_timers', (select count(*) from s where coalesce(lifetime_delivered,0) = 1),
    'lifetime_orders_total', (select coalesce(sum(lifetime_orders),0) from s),
    'lifetime_delivered_total', (select coalesce(sum(lifetime_delivered),0) from s),
    'lifetime_canceled_total', (select coalesce(sum(lifetime_canceled),0) from s),
    'lifetime_amount_total', (select coalesce(sum(lifetime_amount),0) from s),
    'delivered_amount_total', (select coalesce(sum(lifetime_delivered_amount),0) from s),
    'canceled_amount_total', (select coalesce(sum(lifetime_canceled_amount),0) from s),
    'avg_ltv', (select round(coalesce(avg(lifetime_delivered_amount),0), 0) from s where coalesce(lifetime_delivered,0) > 0),
    'stats_updated_at', (select max(stats_updated_at) from s)
  );
$$;

-- Top customers by lifetime delivered revenue (VIP list).
create or replace function public.fn_top_lifetime_customers(p_limit integer default 100)
returns table (
  customer_id text, name text, phone text, email text, city text,
  lifetime_orders integer, lifetime_delivered integer, lifetime_canceled integer,
  lifetime_amount numeric, lifetime_delivered_amount numeric,
  last_order_at date, last_order_state text, last_delivered_at date
)
language sql stable
as $$
  select
    c.customer_id, c.name, c.phone, c.email, c.city,
    c.lifetime_orders, c.lifetime_delivered, c.lifetime_canceled,
    c.lifetime_amount, c.lifetime_delivered_amount,
    c.last_order_at, c.last_order_state, c.last_delivered_at
  from public.customers c
  where coalesce(c.lifetime_delivered_amount, 0) > 0
  order by c.lifetime_delivered_amount desc nulls last
  limit p_limit;
$$;

-- Lifetime revenue and buyer quality by city.
create or replace function public.fn_lifetime_city_stats(p_limit integer default 40)
returns table (
  city text, customers bigint, buyers bigint,
  delivered_orders bigint, delivered_amount numeric,
  canceled_orders bigint, canceled_amount numeric,
  avg_ltv numeric
)
language sql stable
as $$
  select
    coalesce(c.city, '—') as city,
    count(*) as customers,
    count(*) filter (where coalesce(c.lifetime_orders,0) > 0) as buyers,
    coalesce(sum(c.lifetime_delivered), 0) as delivered_orders,
    coalesce(sum(c.lifetime_delivered_amount), 0) as delivered_amount,
    coalesce(sum(c.lifetime_canceled), 0) as canceled_orders,
    coalesce(sum(c.lifetime_canceled_amount), 0) as canceled_amount,
    round(coalesce(avg(c.lifetime_delivered_amount) filter (where coalesce(c.lifetime_delivered,0) > 0), 0), 0) as avg_ltv
  from public.customers c
  where c.stats_updated_at is not null
  group by coalesce(c.city, '—')
  order by delivered_amount desc
  limit p_limit;
$$;

-- Win-back audience: proven buyers (>= p_min_delivered lifetime
-- delivered orders) who went quiet for p_months+ months.
create or replace function public.fn_churned_vips(
  p_months integer default 6,
  p_min_delivered integer default 2,
  p_limit integer default 2000
)
returns table (
  customer_id text, name text, phone text, email text, city text,
  lifetime_delivered integer, lifetime_delivered_amount numeric,
  last_order_at date, last_order_state text
)
language sql stable
as $$
  select
    c.customer_id, c.name, c.phone, c.email, c.city,
    c.lifetime_delivered, c.lifetime_delivered_amount,
    c.last_order_at, c.last_order_state
  from public.customers c
  where coalesce(c.lifetime_delivered, 0) >= p_min_delivered
    and c.last_order_at is not null
    and c.last_order_at < (current_date - (p_months || ' months')::interval)
  order by c.lifetime_delivered_amount desc nulls last
  limit p_limit;
$$;

-- Follow-up list: customers whose LAST order never reached
-- "Delivered" and wasn't cancelled (in-flight or returned).
create or replace function public.fn_stuck_last_orders(p_limit integer default 2000)
returns table (
  customer_id text, name text, phone text, email text, city text,
  last_order_at date, last_order_state text,
  lifetime_orders integer, lifetime_delivered integer, lifetime_amount numeric
)
language sql stable
as $$
  select
    c.customer_id, c.name, c.phone, c.email, c.city,
    c.last_order_at, c.last_order_state,
    c.lifetime_orders, c.lifetime_delivered, c.lifetime_amount
  from public.customers c
  where c.last_order_state is not null
    and c.last_order_state not in ('Delivered','Cancelled','Canceled')
  order by c.last_order_at desc nulls last
  limit p_limit;
$$;

-- Never-purchased audience now uses precise lifetime stats when
-- available (lifetime_orders = 0) instead of only "not in orders".
create or replace function public.fn_never_purchased(p_limit integer default 25000)
returns table (
  customer_id text, name text, email text, phone text, city text,
  language text, joined_at timestamptz
)
language sql stable
as $$
  select c.customer_id, c.name, c.email, c.phone, c.city, c.language, c.joined_at
  from public.customers c
  where coalesce(c.lifetime_orders, 0) = 0
    and not exists (select 1 from public.orders o where o.customer_id = c.customer_id)
    and coalesce(c.is_active, true)
  order by c.joined_at desc nulls last
  limit p_limit;
$$;

-- Same hardening as migration 014: pin search_path, keep anon out.
alter function public.fn_upsert_customer_stats(jsonb) set search_path = public;
alter function public.fn_customer_value_summary() set search_path = public;
alter function public.fn_top_lifetime_customers(integer) set search_path = public;
alter function public.fn_lifetime_city_stats(integer) set search_path = public;
alter function public.fn_churned_vips(integer, integer, integer) set search_path = public;
alter function public.fn_stuck_last_orders(integer) set search_path = public;
alter function public.fn_never_purchased(integer) set search_path = public;
revoke execute on function public.fn_upsert_customer_stats(jsonb) from public, anon;
revoke execute on function public.fn_customer_value_summary() from public, anon;
revoke execute on function public.fn_top_lifetime_customers(integer) from public, anon;
revoke execute on function public.fn_lifetime_city_stats(integer) from public, anon;
revoke execute on function public.fn_churned_vips(integer, integer, integer) from public, anon;
revoke execute on function public.fn_stuck_last_orders(integer) from public, anon;
