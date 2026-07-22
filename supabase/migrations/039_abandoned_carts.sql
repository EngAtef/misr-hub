-- ============================================================
-- Migration 039: Abandoned Cart Recovery Center.
-- Sources: platform exports
--   * customers_abandoned_cart_export  -> abandoned_carts (one row per cart:
--     name/email/phone, skus, value, timestamps, ip/agent/url)
--   * customer_cart_export             -> abandoned_cart_items (one row per item)
--   * revenue_lost / average_revenue_lost over time -> abandoned_daily
-- Carts are keyed by md5(name|created|value|count) so re-uploads upsert the
-- snapshot while PRESERVING recall workflow fields (status/notes/recovery).
-- fn_abandoned_link() cross-matches carts against customers (phone/email)
-- and against orders to auto-mark carts recovered (an order from the same
-- phone within 45 days of abandoning).
-- Run after 038_rls_initplan.sql
-- ============================================================

-- ---- phone normalization helper (immutable so it can be indexed) ----
create or replace function public.norm_eg_phone(p text)
returns text
language sql immutable
set search_path = public
as $$
  select case
    when d is null or d = '' then null
    when d like '0020%' then '20' || substring(d from 5)
    when d like '20%' and length(d) >= 12 then d
    when d like '0%' then '20' || substring(d from 2)
    when d like '1%' and length(d) = 10 then '20' || d
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) s
$$;
revoke all on function public.norm_eg_phone(text) from public, anon;
grant execute on function public.norm_eg_phone(text) to authenticated;

-- Where did the abandoned session come from? Parsed from the cart URL.
create or replace function public.fn_traffic_hint(p_url text)
returns text
language sql immutable
set search_path = public
as $$
  select case
    when p_url is null or p_url = '' then 'unknown'
    when p_url ilike '%fbclid=%' or p_url ilike '%utm_source=facebook%' or p_url ilike '%utm_source=fb%' or p_url ilike '%utm_source=ig%' or p_url ilike '%utm_source=instagram%' then 'facebook'
    when p_url ilike '%gclid=%' or p_url ilike '%utm_source=google%' then 'google'
    when p_url ilike '%ttclid=%' or p_url ilike '%utm_source=tiktok%' then 'tiktok'
    when p_url ilike '%utm_source=%' then 'other_campaign'
    else 'direct'
  end
$$;
revoke all on function public.fn_traffic_hint(text) from public, anon;
grant execute on function public.fn_traffic_hint(text) to authenticated;

-- ---- tables ----
create table if not exists public.abandoned_carts (
  cart_key text primary key,
  full_name text,
  email text,
  phone text,
  phone_norm text,
  products_count integer,
  skus text[],
  cart_value numeric,
  created_at timestamptz,
  cart_updated_at timestamptz,
  notified_at timestamptz,
  user_ip text,
  user_agent text,
  web_url text,
  traffic_hint text,
  is_guest boolean not null default true,
  customer_id text,
  -- recall workflow (survives re-uploads)
  recall_status text not null default 'new'
    check (recall_status in ('new','contacted','responded','recovered','lost','excluded')),
  recall_note text,
  recalled_at timestamptz,
  recalled_by text,
  recovered_order_number text,
  recovered_at timestamptz,
  recovered_value numeric,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ab_carts_created on public.abandoned_carts (created_at desc);
create index if not exists idx_ab_carts_phone on public.abandoned_carts (phone_norm) where phone_norm is not null;
create index if not exists idx_ab_carts_status on public.abandoned_carts (recall_status);
create index if not exists idx_ab_carts_value on public.abandoned_carts (cart_value desc);
create index if not exists idx_ab_carts_customer on public.abandoned_carts (customer_id) where customer_id is not null;

create table if not exists public.abandoned_cart_items (
  item_key text primary key,
  cart_name text,
  sku text,
  product_name text,
  qty integer,
  email text,
  phone text,
  created_at timestamptz
);
create index if not exists idx_ab_items_sku on public.abandoned_cart_items (sku);
create index if not exists idx_ab_items_created on public.abandoned_cart_items (created_at desc);
create index if not exists idx_ab_items_cart on public.abandoned_cart_items (cart_name, created_at);

create table if not exists public.abandoned_daily (
  day date primary key,
  lost_value numeric,
  avg_cart_value numeric,
  updated_at timestamptz not null default now()
);

-- expression indexes so cross-matching carts<->customers/orders is fast
create index if not exists idx_customers_phone_norm on public.customers (public.norm_eg_phone(phone));
create index if not exists idx_orders_phone_norm on public.orders (public.norm_eg_phone(customer_phone));

-- ---- RLS ----
alter table public.abandoned_carts enable row level security;
alter table public.abandoned_cart_items enable row level security;
alter table public.abandoned_daily enable row level security;

drop policy if exists ab_carts_read on public.abandoned_carts;
create policy ab_carts_read on public.abandoned_carts for select using ((select public.my_role()) in ('admin','manager','viewer'));
drop policy if exists ab_carts_write on public.abandoned_carts;
create policy ab_carts_write on public.abandoned_carts for insert with check ((select public.my_role()) in ('admin','manager'));
drop policy if exists ab_carts_update on public.abandoned_carts;
create policy ab_carts_update on public.abandoned_carts for update using ((select public.my_role()) in ('admin','manager'));
drop policy if exists ab_carts_delete on public.abandoned_carts;
create policy ab_carts_delete on public.abandoned_carts for delete using ((select public.my_role()) = 'admin');

drop policy if exists ab_items_read on public.abandoned_cart_items;
create policy ab_items_read on public.abandoned_cart_items for select using ((select public.my_role()) in ('admin','manager','viewer'));
drop policy if exists ab_items_write on public.abandoned_cart_items;
create policy ab_items_write on public.abandoned_cart_items for insert with check ((select public.my_role()) in ('admin','manager'));
drop policy if exists ab_items_update on public.abandoned_cart_items;
create policy ab_items_update on public.abandoned_cart_items for update using ((select public.my_role()) in ('admin','manager'));
drop policy if exists ab_items_delete on public.abandoned_cart_items;
create policy ab_items_delete on public.abandoned_cart_items for delete using ((select public.my_role()) = 'admin');

drop policy if exists ab_daily_read on public.abandoned_daily;
create policy ab_daily_read on public.abandoned_daily for select using ((select public.my_role()) in ('admin','manager','viewer'));
drop policy if exists ab_daily_write on public.abandoned_daily;
create policy ab_daily_write on public.abandoned_daily for insert with check ((select public.my_role()) in ('admin','manager'));
drop policy if exists ab_daily_update on public.abandoned_daily;
create policy ab_daily_update on public.abandoned_daily for update using ((select public.my_role()) in ('admin','manager'));

-- nav permission: visible to managers + viewers by default
insert into public.page_permissions (page_key, allow_manager, allow_viewer)
values ('abandoned', true, true)
on conflict (page_key) do nothing;

-- ---- import RPCs ----
create or replace function public.fn_upsert_abandoned_carts(p_rows jsonb)
returns integer
language plpgsql set search_path = public
as $$
declare n integer;
begin
  if public.my_role() not in ('admin','manager') then
    raise exception 'Forbidden';
  end if;
  insert into public.abandoned_carts (
    cart_key, full_name, email, phone, phone_norm, products_count, skus,
    cart_value, created_at, cart_updated_at, notified_at, user_ip,
    user_agent, web_url, traffic_hint, is_guest, updated_at
  )
  select distinct on (k.cart_key)
    k.cart_key,
    nullif(k.r->>'full_name',''),
    lower(nullif(k.r->>'email','')),
    nullif(k.r->>'phone',''),
    public.norm_eg_phone(k.r->>'phone'),
    nullif(k.r->>'products_count','')::integer,
    case when coalesce(k.r->>'skus','') = '' then null
         else string_to_array(k.r->>'skus', ',') end,
    nullif(k.r->>'cart_value','')::numeric,
    nullif(k.r->>'created_at','')::timestamptz,
    nullif(k.r->>'cart_updated_at','')::timestamptz,
    nullif(k.r->>'notified_at','')::timestamptz,
    nullif(k.r->>'user_ip',''),
    left(nullif(k.r->>'user_agent',''), 300),
    left(nullif(k.r->>'web_url',''), 600),
    public.fn_traffic_hint(k.r->>'web_url'),
    coalesce(k.r->>'full_name','') like 'Guest-%'
      or (coalesce(k.r->>'phone','') = '' and coalesce(k.r->>'email','') = ''),
    now()
  from (
    select r,
      md5(coalesce(r->>'full_name','') || '|' || coalesce(r->>'created_at','') || '|' ||
          coalesce(r->>'cart_value','') || '|' || coalesce(r->>'products_count','')) as cart_key
    from jsonb_array_elements(p_rows) r
    where coalesce(r->>'created_at','') <> ''
  ) k
  on conflict (cart_key) do update set
    email = coalesce(excluded.email, abandoned_carts.email),
    phone = coalesce(excluded.phone, abandoned_carts.phone),
    phone_norm = coalesce(excluded.phone_norm, abandoned_carts.phone_norm),
    products_count = excluded.products_count,
    skus = excluded.skus,
    cart_updated_at = excluded.cart_updated_at,
    notified_at = excluded.notified_at,
    user_ip = excluded.user_ip,
    user_agent = excluded.user_agent,
    web_url = excluded.web_url,
    traffic_hint = excluded.traffic_hint,
    is_guest = excluded.is_guest,
    updated_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.fn_upsert_abandoned_carts(jsonb) from public, anon;

create or replace function public.fn_upsert_abandoned_items(p_rows jsonb)
returns integer
language plpgsql set search_path = public
as $$
declare n integer;
begin
  if public.my_role() not in ('admin','manager') then
    raise exception 'Forbidden';
  end if;
  insert into public.abandoned_cart_items (
    item_key, cart_name, sku, product_name, qty, email, phone, created_at
  )
  select distinct on (k.item_key)
    k.item_key,
    nullif(k.r->>'cart_name',''),
    nullif(k.r->>'sku',''),
    nullif(k.r->>'product_name',''),
    coalesce(nullif(k.r->>'qty','')::integer, 1),
    lower(nullif(k.r->>'email','')),
    nullif(k.r->>'phone',''),
    nullif(k.r->>'created_at','')::timestamptz
  from (
    select r,
      md5(coalesce(r->>'cart_name','') || '|' || coalesce(r->>'created_at','') || '|' || coalesce(r->>'sku','')) as item_key
    from jsonb_array_elements(p_rows) r
    where coalesce(r->>'sku','') <> '' or coalesce(r->>'product_name','') <> ''
  ) k
  on conflict (item_key) do update set
    product_name = excluded.product_name,
    qty = excluded.qty,
    email = coalesce(excluded.email, abandoned_cart_items.email),
    phone = coalesce(excluded.phone, abandoned_cart_items.phone);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.fn_upsert_abandoned_items(jsonb) from public, anon;

create or replace function public.fn_upsert_abandoned_daily(p_rows jsonb)
returns integer
language plpgsql set search_path = public
as $$
declare n integer;
begin
  if public.my_role() not in ('admin','manager') then
    raise exception 'Forbidden';
  end if;
  insert into public.abandoned_daily (day, lost_value, avg_cart_value, updated_at)
  select
    (r->>'day')::date,
    max(nullif(r->>'lost_value','')::numeric),
    max(nullif(r->>'avg_cart_value','')::numeric),
    now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'day','') <> ''
  group by 1
  on conflict (day) do update set
    lost_value = coalesce(excluded.lost_value, abandoned_daily.lost_value),
    avg_cart_value = coalesce(excluded.avg_cart_value, abandoned_daily.avg_cart_value),
    updated_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.fn_upsert_abandoned_daily(jsonb) from public, anon;

-- ---- cross-matching: customers + auto-recovery detection ----
create or replace function public.fn_abandoned_link()
returns jsonb
language plpgsql set search_path = public
as $$
declare
  v_customers integer := 0;
  v_emails integer := 0;
  v_recovered integer := 0;
begin
  if public.my_role() not in ('admin','manager') then
    raise exception 'Forbidden';
  end if;

  -- match registered customers by normalized phone
  update public.abandoned_carts ac
  set customer_id = c.customer_id, is_guest = false
  from public.customers c
  where ac.customer_id is null
    and ac.phone_norm is not null
    and public.norm_eg_phone(c.phone) = ac.phone_norm;
  get diagnostics v_customers = row_count;

  -- then by email for carts that had no phone match
  update public.abandoned_carts ac
  set customer_id = c.customer_id, is_guest = false
  from public.customers c
  where ac.customer_id is null
    and ac.email is not null
    and lower(c.email) = ac.email;
  get diagnostics v_emails = row_count;

  -- auto-recovery: same phone placed a (non-cancelled) order within 45
  -- days AFTER abandoning -> the cart came back on its own or via recall
  with m as (
    select ac.cart_key, o.order_number, o.order_date, o.total_order_amount,
           row_number() over (partition by ac.cart_key order by o.order_date) as rn
    from public.abandoned_carts ac
    join public.orders o
      on public.norm_eg_phone(o.customer_phone) = ac.phone_norm
     and o.order_date >= ac.created_at
     and o.order_date < ac.created_at + interval '45 days'
     and coalesce(o.order_status, '') not in ('Cancelled')
    where ac.phone_norm is not null
      and ac.recovered_order_number is null
  )
  update public.abandoned_carts ac
  set recovered_order_number = m.order_number,
      recovered_at = m.order_date,
      recovered_value = m.total_order_amount,
      recall_status = case when ac.recall_status in ('new','contacted','responded')
                           then 'recovered' else ac.recall_status end,
      updated_at = now()
  from m
  where m.rn = 1 and ac.cart_key = m.cart_key;
  get diagnostics v_recovered = row_count;

  return jsonb_build_object(
    'matched_by_phone', v_customers,
    'matched_by_email', v_emails,
    'auto_recovered', v_recovered
  );
end;
$$;
revoke execute on function public.fn_abandoned_link() from public, anon;

-- ---- analysis RPCs ----
-- single aggregate scan (a subquery-per-metric version took ~2.5s on 52k carts)
create or replace function public.fn_abandoned_summary()
returns jsonb
language sql stable set search_path = public
as $$
  with base as (
    select cart_value, phone_norm, email, customer_id, recall_status,
      traffic_hint, notified_at, recovered_value, imported_at,
      (phone_norm is not null or email is not null) as reachable,
      extract(epoch from (now() - created_at)) / 86400.0 as age_days
    from public.abandoned_carts
  ),
  rep as (
    select count(*) as n from (
      select 1 from public.abandoned_carts
      where phone_norm is not null
      group by phone_norm having count(*) > 1
    ) x
  ),
  agg as (
    select
      count(*) as total_carts,
      coalesce(sum(cart_value), 0) as total_value,
      coalesce(avg(cart_value), 0) as avg_cart_value,
      count(*) filter (where reachable) as reachable_carts,
      coalesce(sum(cart_value) filter (where reachable), 0) as reachable_value,
      count(*) filter (where not reachable) as guest_carts,
      count(*) filter (where customer_id is not null) as known_customers,
      count(*) filter (where reachable and customer_id is null) as prospects,
      count(*) filter (where recall_status = 'recovered') as recovered_carts,
      coalesce(sum(coalesce(recovered_value, cart_value)) filter (where recall_status = 'recovered'), 0) as recovered_value,
      count(*) filter (where recall_status = 'contacted') as contacted,
      count(*) filter (where recall_status = 'responded') as responded,
      count(*) filter (where recall_status = 'lost') as lost,
      count(*) filter (where recall_status = 'new') as new_carts,
      count(*) filter (where age_days <= 7) as hot_carts,
      coalesce(sum(cart_value) filter (where age_days <= 7), 0) as hot_value,
      count(*) filter (where age_days <= 7 and reachable) as hot_reachable,
      count(*) filter (where age_days <= 30) as last30_carts,
      coalesce(sum(cart_value) filter (where age_days <= 30), 0) as last30_value,
      count(*) filter (where traffic_hint = 'facebook') as facebook_carts,
      count(*) filter (where notified_at is not null) as notified_carts,
      max(imported_at) as last_import
    from base
  )
  select jsonb_build_object(
    'total_carts', a.total_carts,
    'total_value', a.total_value,
    'avg_cart_value', a.avg_cart_value,
    'reachable_carts', a.reachable_carts,
    'reachable_value', a.reachable_value,
    'guest_carts', a.guest_carts,
    'known_customers', a.known_customers,
    'prospects', a.prospects,
    'recovered_carts', a.recovered_carts,
    'recovered_value', a.recovered_value,
    'contacted', a.contacted,
    'responded', a.responded,
    'lost', a.lost,
    'new_carts', a.new_carts,
    'hot_carts', a.hot_carts,
    'hot_value', a.hot_value,
    'hot_reachable', a.hot_reachable,
    'last30_carts', a.last30_carts,
    'last30_value', a.last30_value,
    'repeat_abandoners', r.n,
    'facebook_carts', a.facebook_carts,
    'notified_carts', a.notified_carts,
    'items_rows', (select count(*) from public.abandoned_cart_items),
    'last_import', a.last_import
  )
  from agg a, rep r
$$;
revoke execute on function public.fn_abandoned_summary() from public, anon;

create or replace function public.fn_abandoned_segments()
returns table (segment text, carts bigint, reachable bigint, total_value numeric, recovered bigint)
language sql stable set search_path = public
as $$
  with base as (
    select *,
      (phone_norm is not null or email is not null) as is_reachable,
      extract(epoch from (now() - created_at)) / 86400.0 as age_days,
      phone_norm in (
        select phone_norm from public.abandoned_carts
        where phone_norm is not null group by phone_norm having count(*) > 1
      ) as is_repeat
    from public.abandoned_carts
  )
  select s.segment, s.carts, s.reachable, s.total_value, s.recovered
  from (
    select 'hot_0_7' as segment, count(*) as carts, count(*) filter (where is_reachable) as reachable,
           coalesce(sum(cart_value),0) as total_value, count(*) filter (where recall_status='recovered') as recovered, 1 as ord
    from base where age_days <= 7
    union all
    select 'warm_8_30', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), count(*) filter (where recall_status='recovered'), 2
    from base where age_days > 7 and age_days <= 30
    union all
    select 'cool_31_90', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), count(*) filter (where recall_status='recovered'), 3
    from base where age_days > 30 and age_days <= 90
    union all
    select 'cold_90p', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), count(*) filter (where recall_status='recovered'), 4
    from base where age_days > 90
    union all
    select 'vip_1000', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), count(*) filter (where recall_status='recovered'), 5
    from base where cart_value >= 1000
    union all
    select 'known_customer', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), count(*) filter (where recall_status='recovered'), 6
    from base where customer_id is not null
    union all
    select 'prospect', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), count(*) filter (where recall_status='recovered'), 7
    from base where is_reachable and customer_id is null
    union all
    select 'repeat_abandoner', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), count(*) filter (where recall_status='recovered'), 8
    from base where is_repeat
    union all
    select 'facebook', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), count(*) filter (where recall_status='recovered'), 9
    from base where traffic_hint = 'facebook'
    union all
    select 'guest_anon', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), count(*) filter (where recall_status='recovered'), 10
    from base where not is_reachable
  ) s
  order by s.ord
$$;
revoke execute on function public.fn_abandoned_segments() from public, anon;

create or replace function public.fn_abandoned_carts_list(
  p_segment text default null,
  p_status text[] default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  cart_key text, full_name text, email text, phone text, phone_norm text,
  products_count integer, skus text[], cart_value numeric,
  created_at timestamptz, notified_at timestamptz, web_url text,
  traffic_hint text, is_guest boolean, customer_id text,
  recall_status text, recall_note text, recalled_at timestamptz, recalled_by text,
  recovered_order_number text, recovered_at timestamptz, recovered_value numeric,
  age_days numeric, is_repeat boolean,
  customer_name text, customer_city text,
  lifetime_orders integer, lifetime_delivered_amount numeric,
  full_count bigint
)
language sql stable set search_path = public
as $$
  with rep as (
    select phone_norm from public.abandoned_carts
    where phone_norm is not null group by phone_norm having count(*) > 1
  ),
  base as (
    select ac.*,
      (ac.phone_norm is not null or ac.email is not null) as reachable,
      round((extract(epoch from (now() - ac.created_at)) / 86400.0)::numeric, 1) as age_days_c,
      (ac.phone_norm in (select phone_norm from rep)) as is_repeat_c
    from public.abandoned_carts ac
  )
  select
    b.cart_key, b.full_name, b.email, b.phone, b.phone_norm,
    b.products_count, b.skus, b.cart_value,
    b.created_at, b.notified_at, b.web_url,
    b.traffic_hint, b.is_guest, b.customer_id,
    b.recall_status, b.recall_note, b.recalled_at, b.recalled_by,
    b.recovered_order_number, b.recovered_at, b.recovered_value,
    b.age_days_c, coalesce(b.is_repeat_c, false),
    c.name, c.city,
    coalesce(c.lifetime_orders, c.total_orders), c.lifetime_delivered_amount,
    count(*) over () as full_count
  from base b
  left join public.customers c on c.customer_id = b.customer_id
  where (p_status is null or b.recall_status = any(p_status))
    and (p_search is null or p_search = ''
      or b.full_name ilike '%' || p_search || '%'
      or b.phone ilike '%' || p_search || '%'
      or b.email ilike '%' || p_search || '%'
      or array_to_string(b.skus, ',') ilike '%' || p_search || '%')
    and (case coalesce(p_segment, 'all')
      when 'all' then true
      when 'hot_0_7' then b.age_days_c <= 7
      when 'warm_8_30' then b.age_days_c > 7 and b.age_days_c <= 30
      when 'cool_31_90' then b.age_days_c > 30 and b.age_days_c <= 90
      when 'cold_90p' then b.age_days_c > 90
      when 'vip_1000' then b.cart_value >= 1000
      when 'reachable' then b.reachable
      when 'known_customer' then b.customer_id is not null
      when 'prospect' then b.reachable and b.customer_id is null
      when 'repeat_abandoner' then coalesce(b.is_repeat_c, false)
      when 'facebook' then b.traffic_hint = 'facebook'
      when 'guest_anon' then not b.reachable
      else true
    end)
  order by (b.reachable) desc, b.created_at desc
  limit least(coalesce(p_limit, 50), 1000)
  offset greatest(coalesce(p_offset, 0), 0)
$$;
revoke execute on function public.fn_abandoned_carts_list(text, text[], text, integer, integer) from public, anon;

create or replace function public.fn_abandoned_top_products(
  p_days integer default null,
  p_limit integer default 30
)
returns table (
  sku text, product_name text, carts bigint, total_qty bigint,
  ecom_stock integer, in_catalog boolean
)
language sql stable set search_path = public
as $$
  select
    i.sku,
    max(i.product_name) as product_name,
    count(distinct coalesce(i.cart_name, '?') || '|' || coalesce(i.created_at::text, '')) as carts,
    sum(coalesce(i.qty, 1)) as total_qty,
    max(s.ecom_stock) as ecom_stock,
    (max(s.sku) is not null) as in_catalog
  from public.abandoned_cart_items i
  left join public.stock_items s on s.sku = i.sku
  where p_days is null or i.created_at >= now() - make_interval(days => p_days)
  group by i.sku
  order by 3 desc
  limit least(coalesce(p_limit, 30), 200)
$$;
revoke execute on function public.fn_abandoned_top_products(integer, integer) from public, anon;

create or replace function public.fn_abandoned_repeaters(p_limit integer default 50)
returns table (
  phone_norm text, full_name text, email text, customer_id text,
  carts bigint, total_value numeric, last_abandoned timestamptz,
  recovered bigint, recall_status text
)
language sql stable set search_path = public
as $$
  select
    ac.phone_norm,
    max(ac.full_name) as full_name,
    max(ac.email) as email,
    max(ac.customer_id) as customer_id,
    count(*) as carts,
    coalesce(sum(ac.cart_value), 0) as total_value,
    max(ac.created_at) as last_abandoned,
    count(*) filter (where ac.recall_status = 'recovered') as recovered,
    max(ac.recall_status) as recall_status
  from public.abandoned_carts ac
  where ac.phone_norm is not null
  group by ac.phone_norm
  having count(*) > 1
  order by 6 desc
  limit least(coalesce(p_limit, 50), 500)
$$;
revoke execute on function public.fn_abandoned_repeaters(integer) from public, anon;

create or replace function public.fn_abandoned_trend(p_days integer default 3650)
returns table (day date, lost_value numeric, avg_cart_value numeric, carts bigint)
language sql stable set search_path = public
as $$
  with counts as (
    select created_at::date as d, count(*) as n
    from public.abandoned_carts
    group by 1
  )
  select
    coalesce(ad.day, c.d) as day,
    ad.lost_value,
    ad.avg_cart_value,
    coalesce(c.n, 0) as carts
  from public.abandoned_daily ad
  full outer join counts c on c.d = ad.day
  where coalesce(ad.day, c.d) >= current_date - make_interval(days => coalesce(p_days, 3650))
  order by 1
$$;
revoke execute on function public.fn_abandoned_trend(integer) from public, anon;
