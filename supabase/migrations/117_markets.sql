-- 117_markets.sql — country/market layer for the KSA + UAE launch.
--
-- The platform has no Country column: foreign customers arrive as
-- City = "SA City" / "AE City" (real city in Area) and a national-format
-- Gulf mobile with no country code (e.g. 554249323). Egyptian rows keep
-- governorate city names and 01x mobiles. This migration derives a
-- `market` code (EG / SA / AE / GF=Gulf-unknown / KW QA BH OM JO) on
-- orders, customers and abandoned_carts, keeps it fresh via triggers,
-- makes phone matching country-code safe, and adds p_markets filters to
-- the analytics + abandoned + identities RPCs.

-- ---------- 1) phone matching key (international-safe) ----------
-- Canonical KEY for joining people across tables (NOT for dialing):
--   EG mobiles  -> '20' + 10 digits (same as norm_eg_phone output)
--   Gulf mobiles -> bare national 9 digits starting 5 (966/971 stripped,
--                   so the same person matches however they typed it)
--   everything else -> raw digits
create or replace function public.norm_phone_key(p text)
returns text
language sql immutable
set search_path to 'public'
as $$
  select case
    when d is null or d = '' then null
    when d ~ '^(0020|20)?0?1[0125][0-9]{8}$' then '20' || right(d, 10)
    when d ~ '^(00)?(966|971)5[0-9]{8}$' then right(d, 9)
    when d ~ '^0?5[0-9]{8}$' then right(d, 9)
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) s
$$;

-- ---------- 2) market resolver ----------
-- Order of evidence: "XX City" pattern (strongest) -> any other non-empty
-- city means an Egyptian governorate -> phone shape. Gulf prefixes 53/57/59
-- are KSA-only and 52 is UAE-only; 50/54/55/56/58 exist in both -> 'GF'
-- (resolved later from the customer's address or manually).
-- 0-prefixed 10-digit numbers collide with Egyptian landline area codes
-- 050/055/057, so those stay EG; bare 9-digit 5xx is always Gulf.
create or replace function public.fn_market_code(p_phone text, p_city text)
returns text
language sql immutable
set search_path to 'public'
as $$
  with s as (
    select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d,
           upper(coalesce((regexp_match(coalesce(p_city, ''), '^\s*([A-Za-z]{2})\s+City\s*$', 'i'))[1], '')) as cc
  )
  select case
    when cc in ('SA','AE','KW','QA','BH','OM','JO') then cc
    when nullif(btrim(coalesce(p_city, '')), '') is not null and cc = '' then 'EG'
    when d ~ '^(0020|20)?0?1[0125][0-9]{8}$' then 'EG'
    when d ~ '^(00)?9665[0-9]{8}$' then 'SA'
    when d ~ '^(00)?9715[0-9]{8}$' then 'AE'
    when d ~ '^5[379][0-9]{7}$' or d ~ '^05[39][0-9]{7}$' then 'SA'
    when d ~ '^52[0-9]{7}$' or d ~ '^052[0-9]{7}$' then 'AE'
    when d ~ '^5[04568][0-9]{7}$' or d ~ '^05[468][0-9]{7}$' then 'GF'
    when d ~ '^(00)?965[0-9]{7,8}$' then 'KW'
    when d ~ '^(00)?974[0-9]{7,8}$' then 'QA'
    when d ~ '^(00)?973[0-9]{7,8}$' then 'BH'
    when d ~ '^(00)?968[0-9]{7,8}$' then 'OM'
    when d ~ '^(00)?962[0-9]{8,9}$' then 'JO'
    else 'EG'
  end
  from s
$$;

-- ---------- 3) columns + triggers ----------
alter table public.orders
  add column if not exists market text,
  add column if not exists market_locked boolean not null default false;
alter table public.customers
  add column if not exists market text,
  add column if not exists market_locked boolean not null default false;
alter table public.abandoned_carts
  add column if not exists market text,
  add column if not exists market_locked boolean not null default false;

create or replace function public.trg_orders_market()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if not coalesce(new.market_locked, false) then
    new.market := public.fn_market_code(new.customer_phone, new.city);
  end if;
  return new;
end $$;
drop trigger if exists trg_orders_market on public.orders;
create trigger trg_orders_market before insert or update on public.orders
  for each row execute function public.trg_orders_market();

create or replace function public.trg_customers_market()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if not coalesce(new.market_locked, false) then
    new.market := public.fn_market_code(new.phone, new.city);
  end if;
  return new;
end $$;
drop trigger if exists trg_customers_market on public.customers;
create trigger trg_customers_market before insert or update on public.customers
  for each row execute function public.trg_customers_market();

-- carts have no city; also keep phone_norm on the international-safe key
create or replace function public.trg_ab_carts_market()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.phone_norm := public.norm_phone_key(new.phone);
  if not coalesce(new.market_locked, false) then
    -- keep a better-informed market (inherited from the linked customer)
    if new.market is null or new.market in ('EG', 'GF')
       or (tg_op = 'UPDATE' and new.phone is distinct from old.phone) then
      new.market := public.fn_market_code(new.phone, null);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_ab_carts_market on public.abandoned_carts;
create trigger trg_ab_carts_market before insert or update on public.abandoned_carts
  for each row execute function public.trg_ab_carts_market();

-- ---------- 4) backfill ----------
update public.orders set market = public.fn_market_code(customer_phone, city)
where market is null;
update public.customers set market = public.fn_market_code(phone, city)
where market is null;
update public.abandoned_carts
set phone_norm = public.norm_phone_key(phone)
where phone_norm is distinct from public.norm_phone_key(phone);
update public.abandoned_carts set market = public.fn_market_code(phone, null)
where market is null;
-- linked customers know their address -> inherit onto weakly-typed carts
update public.abandoned_carts ac
set market = c.market
from public.customers c
where ac.customer_id = c.customer_id and c.market is not null
  and not ac.market_locked
  and coalesce(ac.market, 'EG') in ('EG', 'GF')
  and ac.market is distinct from c.market;

create index if not exists idx_orders_market on public.orders (market);
create index if not exists idx_customers_market on public.customers (market);
create index if not exists idx_ab_carts_market on public.abandoned_carts (market);
create index if not exists idx_customers_phone_key on public.customers (public.norm_phone_key(phone));
create index if not exists idx_orders_phone_key on public.orders (public.norm_phone_key(customer_phone));

-- ---------- 5) identity rebuild uses the international-safe key ----------
do $patch$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fn_rebuild_customer_identities';
  if src is not null and position('norm_eg_phone' in src) > 0 then
    src := replace(src, 'norm_eg_phone', 'norm_phone_key');
    execute src;
  end if;
end $patch$;

-- ---------- 6) abandoned link: international keys + market inherit ----------
create or replace function public.fn_abandoned_link()
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_customers integer := 0;
  v_emails integer := 0;
  v_markets integer := 0;
  v_recovered integer := 0;
  v_anomalies integer := 0;
  v_weights integer := 0;
begin
  if public.my_role() not in ('admin','manager') then
    raise exception 'Forbidden';
  end if;

  update public.abandoned_carts ac
  set customer_id = c.customer_id, is_guest = false
  from public.customers c
  where ac.customer_id is null
    and ac.phone_norm is not null
    and public.norm_phone_key(c.phone) = ac.phone_norm;
  get diagnostics v_customers = row_count;

  update public.abandoned_carts ac
  set customer_id = c.customer_id, is_guest = false
  from public.customers c
  where ac.customer_id is null
    and ac.email is not null
    and lower(c.email) = ac.email;
  get diagnostics v_emails = row_count;

  -- the linked customer's market (from the address) beats the cart's
  -- phone-only guess ('GF' unknown-Gulf / default 'EG')
  update public.abandoned_carts ac
  set market = c.market
  from public.customers c
  where ac.customer_id = c.customer_id and c.market is not null
    and not ac.market_locked
    and coalesce(ac.market, 'EG') in ('EG', 'GF')
    and ac.market is distinct from c.market;
  get diagnostics v_markets = row_count;

  with m as (
    select ac.cart_key, o.order_number, o.order_date, o.total_order_amount,
           row_number() over (partition by ac.cart_key order by o.order_date) as rn
    from public.abandoned_carts ac
    join public.orders o
      on public.norm_phone_key(o.customer_phone) = ac.phone_norm
     and o.order_date >= ac.created_at
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

  update public.abandoned_carts
  set is_anomaly = coalesce(cart_value, 0) >= 35000 or coalesce(products_count, 0) >= 150,
      anomaly_reason = case
        when coalesce(cart_value, 0) >= 35000 then 'huge_value'
        when coalesce(products_count, 0) >= 150 then 'bulk_products'
        else null end
  where (coalesce(cart_value, 0) >= 35000 or coalesce(products_count, 0) >= 150) is distinct from is_anomaly
     or is_anomaly;
  get diagnostics v_anomalies = row_count;

  with snap as (
    select created_at::date as d, sum(cart_value) as v
    from public.abandoned_carts
    where not is_anomaly and created_at is not null
    group by 1
  )
  update public.abandoned_daily ad
  set is_anomaly = coalesce(ad.avg_cart_value, 0) >= 10000
    or coalesce(ad.lost_value, 0) >= 25 * greatest(coalesce(s.v, 0), 20000)
  from snap s
  where s.d = ad.day;

  update public.abandoned_daily ad
  set is_anomaly = coalesce(ad.avg_cart_value, 0) >= 10000
    or coalesce(ad.lost_value, 0) >= 500000
  where not exists (
    select 1 from public.abandoned_carts ac
    where ac.created_at::date = ad.day and not ac.is_anomaly
  );

  v_weights := public.fn_recompute_cart_weights(null);

  return jsonb_build_object(
    'matched_by_phone', v_customers,
    'matched_by_email', v_emails,
    'markets_inherited', v_markets,
    'auto_recovered', v_recovered,
    'anomalies_flagged', v_anomalies,
    'weights_updated', v_weights
  );
end;
$function$;

-- ---------- 7) analytics RPCs gain p_markets ----------
drop function if exists public.fn_kpis(timestamptz, timestamptz);
create function public.fn_kpis(p_from timestamptz, p_to timestamptz, p_markets text[] default null)
returns json
language sql stable
set search_path to 'public'
as $function$
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
    'unique_customers', count(distinct coalesce(master_id, customer_id)),
    'avg_customer_rating', avg(customer_rating) filter (where customer_rating > 0),
    'avg_driver_rating', avg(driver_rating) filter (where driver_rating > 0),
    'avg_delivery_days', avg(extract(epoch from (delivery_date - order_date)) / 86400.0) filter (where delivery_date is not null and order_date is not null),
    'total_weight_kg', coalesce(sum(weight_kg), 0),
    'net_weight_kg', coalesce(sum(weight_kg) filter (where order_status not in ('Cancelled', 'Returned', 'Return Sent To Erp')), 0),
    'avg_weight_kg', avg(weight_kg),
    'weighed_orders', count(weight_kg)
  )
  from public.orders
  where (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < p_to)
    and (p_markets is null or cardinality(p_markets) = 0 or market = any(p_markets));
$function$;

drop function if exists public.fn_breakdown(text, timestamptz, timestamptz, integer);
create function public.fn_breakdown(p_dim text, p_from timestamptz, p_to timestamptz, p_limit integer default 30, p_markets text[] default null)
returns table(label text, orders bigint, revenue numeric, delivered bigint, cancelled_or_returned bigint, weight_kg numeric)
language sql stable
set search_path to 'public'
as $function$
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
      when 'applied_offer' then applied_offer
      when 'campaign_id' then campaign_id
      when 'market' then market
    end), ''), '(none)') as label,
    count(*) as orders,
    coalesce(sum(total_order_amount), 0) as revenue,
    count(*) filter (where order_status = 'Delivered') as delivered,
    count(*) filter (where order_status in ('Cancelled', 'Returned', 'Return Sent To Erp', 'Return Request')) as cancelled_or_returned,
    round(coalesce(sum(o.weight_kg), 0), 2) as weight_kg
  from public.orders o
  where (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < p_to)
    and (p_markets is null or cardinality(p_markets) = 0 or market = any(p_markets))
  group by 1
  order by 2 desc
  limit p_limit;
$function$;

drop function if exists public.fn_orders_by_day(timestamptz, timestamptz);
create function public.fn_orders_by_day(p_from timestamptz, p_to timestamptz, p_markets text[] default null)
returns table(day date, orders bigint, revenue numeric, delivered bigint, cancelled bigint, weight_kg numeric)
language sql stable
set search_path to 'public'
as $function$
  select
    date_trunc('day', order_date)::date as day,
    count(*) as orders,
    coalesce(sum(total_order_amount), 0) as revenue,
    count(*) filter (where order_status = 'Delivered') as delivered,
    count(*) filter (where order_status = 'Cancelled') as cancelled,
    round(coalesce(sum(o.weight_kg), 0), 2) as weight_kg
  from public.orders o
  where order_date is not null
    and (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < p_to)
    and (p_markets is null or cardinality(p_markets) = 0 or market = any(p_markets))
  group by 1
  order by 1;
$function$;

drop function if exists public.fn_delivery_buckets(timestamptz, timestamptz);
create function public.fn_delivery_buckets(p_from timestamptz, p_to timestamptz, p_markets text[] default null)
returns table(bucket text, bucket_order integer, orders bigint)
language sql stable
set search_path to 'public'
as $function$
  with d as (
    select extract(epoch from (delivery_date - order_date)) / 86400.0 as days
    from public.orders
    where delivery_date is not null and order_date is not null
      and (p_from is null or order_date >= p_from)
      and (p_to is null or order_date < p_to)
      and (p_markets is null or cardinality(p_markets) = 0 or market = any(p_markets))
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
$function$;

drop function if exists public.fn_customer_insights(timestamptz, timestamptz);
create function public.fn_customer_insights(p_from timestamptz, p_to timestamptz, p_markets text[] default null)
returns json
language sql stable
set search_path to 'public'
as $function$
  with c as (
    select coalesce(o.master_id, o.customer_id) as mid,
      count(*) as n, sum(o.total_order_amount) as spent
    from public.orders o
    where o.customer_id is not null
      and (p_from is null or o.order_date >= p_from)
      and (p_to is null or o.order_date < p_to)
      and (p_markets is null or cardinality(p_markets) = 0 or o.market = any(p_markets))
    group by 1
  ),
  a as (
    select count(*) as accounts
    from (
      select o.customer_id from public.orders o
      where o.customer_id is not null
        and (p_from is null or o.order_date >= p_from)
        and (p_to is null or o.order_date < p_to)
        and (p_markets is null or cardinality(p_markets) = 0 or o.market = any(p_markets))
      group by 1
    ) x
  )
  select json_build_object(
    'total_customers', (select count(*) from c),
    'repeat_customers', (select count(*) from c where n > 1),
    'avg_orders_per_customer', (select coalesce(avg(n), 0) from c),
    'avg_spend_per_customer', (select coalesce(avg(spent), 0) from c),
    'accounts_before_merge', (select accounts from a),
    'duplicate_accounts', (select accounts from a) - (select count(*) from c)
  );
$function$;

drop function if exists public.fn_top_products(timestamptz, timestamptz, integer);
create function public.fn_top_products(p_from timestamptz, p_to timestamptz, p_limit integer default 25, p_markets text[] default null)
returns table(product_name text, sku text, quantity bigint, revenue numeric, unit_weight_kg numeric, weight_kg numeric)
language sql stable
set search_path to 'public'
as $function$
  select
    coalesce(i.product_name, '(unknown)') as product_name,
    max(i.sku) as sku,
    sum(coalesce(ps.quantity, 1))::bigint as quantity,
    coalesce(sum(i.price), 0) as revenue,
    max(p.weight_kg) as unit_weight_kg,
    round(sum(coalesce(ps.quantity, 1) * p.weight_kg), 2) as weight_kg
  from public.order_items i
  join public.orders o on o.order_number = i.order_number
  left join public.product_sales ps on ps.order_id = i.order_number and ps.sku = i.sku and ps.quantity is not null and ps.quantity <> 1
  left join public.products p on p.sku = i.sku
  where (p_from is null or o.order_date >= p_from)
    and (p_to is null or o.order_date < p_to)
    and (p_markets is null or cardinality(p_markets) = 0 or o.market = any(p_markets))
    and o.order_status not in ('Cancelled')
  group by 1
  order by 3 desc
  limit p_limit;
$function$;

-- ---------- 8) abandoned RPCs gain p_markets ----------
drop function if exists public.fn_abandoned_summary(date, date);
create function public.fn_abandoned_summary(p_from date default null, p_to date default null, p_markets text[] default null)
returns jsonb
language sql stable
set search_path to 'public'
as $function$
  with scoped as (
    select * from public.abandoned_carts
    where not is_anomaly
      and (p_from is null or created_at >= p_from)
      and (p_to is null or created_at < p_to + interval '1 day')
      and (p_markets is null or cardinality(p_markets) = 0 or market = any(p_markets))
  ),
  base as (
    select cart_value, phone_norm, email, customer_id, recall_status,
      traffic_hint, notified_at, imported_at, weight_kg, weight_missing,
      (phone_norm is not null or email is not null) as reachable,
      extract(epoch from (now() - created_at)) / 86400.0 as age_days
    from scoped
    where recall_status in ('new', 'contacted', 'responded')
  ),
  rep as (
    select count(*) as n from (
      select 1 from public.abandoned_carts
      where phone_norm is not null and not is_anomaly
        and recall_status in ('new', 'contacted', 'responded')
        and (p_from is null or created_at >= p_from)
        and (p_to is null or created_at < p_to + interval '1 day')
        and (p_markets is null or cardinality(p_markets) = 0 or market = any(p_markets))
      group by phone_norm having count(*) > 1
    ) x
  ),
  anom as (
    select count(*) as carts, coalesce(sum(cart_value), 0) as value
    from public.abandoned_carts
    where is_anomaly
      and (p_from is null or created_at >= p_from)
      and (p_to is null or created_at < p_to + interval '1 day')
      and (p_markets is null or cardinality(p_markets) = 0 or market = any(p_markets))
  ),
  anom_days as (
    select count(*) as days, coalesce(sum(lost_value), 0) as value
    from public.abandoned_daily
    where is_anomaly and p_markets is null
      and (p_from is null or day >= p_from)
      and (p_to is null or day <= p_to)
  ),
  outcome as (
    select
      count(*) filter (where recall_status = 'recovered') as recovered_carts,
      coalesce(sum(coalesce(recovered_value, cart_value)) filter (where recall_status = 'recovered'), 0) as recovered_value,
      coalesce(sum(weight_kg) filter (where recall_status = 'recovered'), 0) as recovered_weight_kg,
      count(*) filter (where recall_status = 'lost') as lost
    from scoped
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
      count(*) filter (where recall_status = 'contacted') as contacted,
      count(*) filter (where recall_status = 'responded') as responded,
      count(*) filter (where recall_status = 'new') as new_carts,
      count(*) filter (where age_days <= 7) as hot_carts,
      coalesce(sum(cart_value) filter (where age_days <= 7), 0) as hot_value,
      count(*) filter (where age_days <= 7 and reachable) as hot_reachable,
      count(*) filter (where age_days <= 30) as last30_carts,
      coalesce(sum(cart_value) filter (where age_days <= 30), 0) as last30_value,
      count(*) filter (where traffic_hint = 'facebook') as facebook_carts,
      count(*) filter (where notified_at is not null) as notified_carts,
      max(imported_at) as last_import,
      coalesce(sum(weight_kg), 0) as total_weight_kg,
      avg(weight_kg) as avg_cart_weight_kg,
      coalesce(sum(weight_kg) filter (where reachable), 0) as reachable_weight_kg,
      coalesce(sum(weight_kg) filter (where age_days <= 7), 0) as hot_weight_kg,
      count(*) filter (where coalesce(weight_missing, 0) > 0) as weight_incomplete_carts
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
    'recovered_carts', o.recovered_carts,
    'recovered_value', o.recovered_value,
    'recovered_weight_kg', o.recovered_weight_kg,
    'contacted', a.contacted,
    'responded', a.responded,
    'lost', o.lost,
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
    'last_import', a.last_import,
    'anomaly_carts', an.carts,
    'anomaly_value', an.value,
    'anomaly_days', ad.days,
    'anomaly_days_value', ad.value,
    'total_weight_kg', a.total_weight_kg,
    'avg_cart_weight_kg', a.avg_cart_weight_kg,
    'reachable_weight_kg', a.reachable_weight_kg,
    'hot_weight_kg', a.hot_weight_kg,
    'weight_incomplete_carts', a.weight_incomplete_carts
  )
  from agg a, rep r, anom an, anom_days ad, outcome o
$function$;

drop function if exists public.fn_abandoned_segments(date, date);
create function public.fn_abandoned_segments(p_from date default null, p_to date default null, p_markets text[] default null)
returns table(segment text, carts bigint, reachable bigint, total_value numeric, recovered bigint)
language sql stable
set search_path to 'public'
as $function$
  with base as (
    select *,
      (phone_norm is not null or email is not null) as is_reachable,
      extract(epoch from (now() - created_at)) / 86400.0 as age_days,
      phone_norm in (
        select phone_norm from public.abandoned_carts
        where phone_norm is not null and not is_anomaly
          and recall_status in ('new', 'contacted', 'responded')
        group by phone_norm having count(*) > 1
      ) as is_repeat
    from public.abandoned_carts
    where not is_anomaly
      and recall_status in ('new', 'contacted', 'responded')
      and (p_from is null or created_at >= p_from)
      and (p_to is null or created_at < p_to + interval '1 day')
      and (p_markets is null or cardinality(p_markets) = 0 or market = any(p_markets))
  )
  select s.segment, s.carts, s.reachable, s.total_value, 0::bigint as recovered
  from (
    select 'hot_0_7' as segment, count(*) as carts, count(*) filter (where is_reachable) as reachable,
           coalesce(sum(cart_value),0) as total_value, 1 as ord
    from base where age_days <= 7
    union all
    select 'warm_8_30', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), 2
    from base where age_days > 7 and age_days <= 30
    union all
    select 'cool_31_90', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), 3
    from base where age_days > 30 and age_days <= 90
    union all
    select 'cold_90p', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), 4
    from base where age_days > 90
    union all
    select 'vip_1000', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), 5
    from base where cart_value >= 1000
    union all
    select 'known_customer', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), 6
    from base where customer_id is not null
    union all
    select 'prospect', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), 7
    from base where is_reachable and customer_id is null
    union all
    select 'repeat_abandoner', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), 8
    from base where is_repeat
    union all
    select 'facebook', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), 9
    from base where traffic_hint = 'facebook'
    union all
    select 'guest_anon', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value),0), 10
    from base where not is_reachable
  ) s
  order by s.ord
$function$;

drop function if exists public.fn_abandoned_carts_list(text, text[], text, text[], numeric, numeric, text, date, date, integer, integer);
create function public.fn_abandoned_carts_list(
  p_segment text default null, p_status text[] default null, p_search text default null,
  p_traffic text[] default null, p_min_value numeric default null, p_max_value numeric default null,
  p_order text default 'newest', p_from date default null, p_to date default null,
  p_limit integer default 50, p_offset integer default 0, p_markets text[] default null)
returns table(
  cart_key text, full_name text, email text, phone text, phone_norm text,
  products_count integer, skus text[], cart_value numeric,
  created_at timestamptz, notified_at timestamptz, web_url text,
  traffic_hint text, is_guest boolean, customer_id text,
  recall_status text, recall_note text, recalled_at timestamptz, recalled_by text,
  recovered_order_number text, recovered_at timestamptz, recovered_value numeric,
  age_days numeric, is_repeat boolean, is_anomaly boolean, anomaly_reason text,
  customer_name text, customer_city text,
  lifetime_orders integer, lifetime_delivered_amount numeric,
  full_count bigint, weight_kg numeric, weight_missing integer, market text)
language sql stable
set search_path to 'public'
as $function$
  with rep as (
    select phone_norm from public.abandoned_carts
    where phone_norm is not null and not is_anomaly
      and recall_status in ('new', 'contacted', 'responded')
    group by phone_norm having count(*) > 1
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
    b.age_days_c, coalesce(b.is_repeat_c, false), b.is_anomaly, b.anomaly_reason,
    c.name, c.city,
    coalesce(c.lifetime_orders, c.total_orders), c.lifetime_delivered_amount,
    count(*) over () as full_count,
    b.weight_kg, b.weight_missing, b.market
  from base b
  left join public.customers c on c.customer_id = b.customer_id
  where (case when coalesce(p_segment, '') = 'anomaly' then b.is_anomaly else not b.is_anomaly end)
    and (case
      when p_status is not null then b.recall_status = any(p_status)
      when coalesce(p_segment, '') = 'anomaly' then true
      else b.recall_status in ('new', 'contacted', 'responded')
    end)
    and (p_from is null or b.created_at >= p_from)
    and (p_to is null or b.created_at < p_to + interval '1 day')
    and (p_traffic is null or b.traffic_hint = any(p_traffic))
    and (p_markets is null or cardinality(p_markets) = 0 or b.market = any(p_markets))
    and (p_min_value is null or b.cart_value >= p_min_value)
    and (p_max_value is null or b.cart_value <= p_max_value)
    and (p_search is null or p_search = ''
      or b.full_name ilike '%' || p_search || '%'
      or b.phone ilike '%' || p_search || '%'
      or b.email ilike '%' || p_search || '%'
      or array_to_string(b.skus, ',') ilike '%' || p_search || '%')
    and (case coalesce(p_segment, 'all')
      when 'all' then true
      when 'anomaly' then true
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
  order by
    case when p_order = 'value_desc' then -coalesce(b.cart_value, 0) end,
    case when p_order = 'value_asc' then coalesce(b.cart_value, 0) end,
    case when p_order = 'oldest' then extract(epoch from b.created_at) end,
    case when p_order = 'products_desc' then -coalesce(b.products_count, 0) end,
    case when p_order = 'weight_desc' then -coalesce(b.weight_kg, 0) end,
    (b.reachable) desc, b.created_at desc
  limit least(coalesce(p_limit, 50), 1000)
  offset greatest(coalesce(p_offset, 0), 0)
$function$;

drop function if exists public.fn_abandoned_trend(integer, date, date);
create function public.fn_abandoned_trend(p_days integer default 3650, p_from date default null, p_to date default null, p_markets text[] default null)
returns table(day date, lost_value numeric, avg_cart_value numeric, carts bigint, platform_lost numeric)
language sql stable
set search_path to 'public'
as $function$
  with real_days as (
    select created_at::date as d, count(*) as n, coalesce(sum(cart_value), 0) as v
    from public.abandoned_carts
    where not is_anomaly and created_at is not null
      and (p_markets is null or cardinality(p_markets) = 0 or market = any(p_markets))
    group by 1
  )
  select
    coalesce(r.d, ad.day) as day,
    coalesce(r.v, 0) as lost_value,
    case when coalesce(r.n, 0) > 0 then round(r.v / r.n, 2) end as avg_cart_value,
    coalesce(r.n, 0) as carts,
    case when p_markets is not null then null
         when ad.is_anomaly then null else ad.lost_value end as platform_lost
  from real_days r
  full outer join public.abandoned_daily ad on ad.day = r.d
  where (p_markets is null or cardinality(p_markets) = 0 or r.d is not null)
    and (case
      when p_from is not null or p_to is not null then
        (p_from is null or coalesce(r.d, ad.day) >= p_from)
        and (p_to is null or coalesce(r.d, ad.day) <= p_to)
      else coalesce(r.d, ad.day) >= current_date - make_interval(days => coalesce(p_days, 3650))
    end)
  order by 1
$function$;

drop function if exists public.fn_abandoned_top_products(date, date, integer);
create function public.fn_abandoned_top_products(p_from date default null, p_to date default null, p_limit integer default 30, p_markets text[] default null)
returns table(sku text, product_name text, carts bigint, total_qty numeric, ecom_stock integer, in_catalog boolean)
language sql stable
set search_path to 'public'
as $function$
  select
    i.sku,
    max(i.product_name) as product_name,
    count(distinct coalesce(i.cart_name, '?') || '|' || coalesce(i.created_at::text, '')) as carts,
    sum(coalesce(i.qty, 1)) as total_qty,
    max(s.ecom_stock) as ecom_stock,
    (max(s.sku) is not null) as in_catalog
  from public.abandoned_cart_items i
  left join public.stock_items s on s.sku = i.sku
  where (p_from is null or i.created_at >= p_from)
    and (p_to is null or i.created_at < p_to + interval '1 day')
    and coalesce(i.qty, 1) < 50
    and not exists (
      select 1 from public.abandoned_carts ac
      where ac.full_name = i.cart_name
        and i.created_at between ac.created_at - interval '1 hour' and ac.created_at + interval '1 hour'
        and (ac.is_anomaly or ac.recall_status in ('recovered', 'lost', 'excluded'))
    )
    and (p_markets is null or cardinality(p_markets) = 0 or exists (
      select 1 from public.abandoned_carts ac
      where ac.full_name = i.cart_name
        and i.created_at between ac.created_at - interval '1 hour' and ac.created_at + interval '1 hour'
        and ac.market = any(p_markets)
    ))
  group by i.sku
  order by 3 desc
  limit least(coalesce(p_limit, 30), 200)
$function$;

drop function if exists public.fn_abandoned_breakdowns(date, date);
create function public.fn_abandoned_breakdowns(p_from date default null, p_to date default null, p_markets text[] default null)
returns jsonb
language sql stable
set search_path to 'public'
as $function$
  with base as (
    select cart_value, created_at, traffic_hint, market,
      (phone_norm is not null or email is not null) as reachable
    from public.abandoned_carts
    where not is_anomaly and created_at is not null
      and (p_from is null or created_at >= p_from)
      and (p_to is null or created_at < p_to + interval '1 day')
      and (p_markets is null or cardinality(p_markets) = 0 or market = any(p_markets))
  )
  select jsonb_build_object(
    'by_hour', (
      select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'carts', n, 'value', v) order by h), '[]'::jsonb)
      from (
        select extract(hour from created_at)::int as h, count(*) as n, coalesce(sum(cart_value), 0) as v
        from base group by 1
      ) x
    ),
    'by_dow', (
      select coalesce(jsonb_agg(jsonb_build_object('dow', d, 'carts', n, 'value', v) order by d), '[]'::jsonb)
      from (
        select extract(isodow from created_at)::int as d, count(*) as n, coalesce(sum(cart_value), 0) as v
        from base group by 1
      ) x
    ),
    'by_bucket', (
      select coalesce(jsonb_agg(jsonb_build_object('bucket', b, 'carts', n, 'value', v) order by ord), '[]'::jsonb)
      from (
        select case
            when cart_value is null then '0'
            when cart_value < 100 then '<100'
            when cart_value < 300 then '100-300'
            when cart_value < 600 then '300-600'
            when cart_value < 1000 then '600-1000'
            when cart_value < 2000 then '1000-2000'
            else '2000+' end as b,
          min(case
            when cart_value is null then 0
            when cart_value < 100 then 1
            when cart_value < 300 then 2
            when cart_value < 600 then 3
            when cart_value < 1000 then 4
            when cart_value < 2000 then 5
            else 6 end) as ord,
          count(*) as n, coalesce(sum(cart_value), 0) as v
        from base group by 1
      ) x
    ),
    'by_traffic', (
      select coalesce(jsonb_agg(jsonb_build_object('source', s, 'carts', n, 'value', v, 'reachable', r) order by n desc), '[]'::jsonb)
      from (
        select coalesce(traffic_hint, 'unknown') as s, count(*) as n,
               coalesce(sum(cart_value), 0) as v, count(*) filter (where reachable) as r
        from base group by 1
      ) x
    ),
    'by_market', (
      select coalesce(jsonb_agg(jsonb_build_object('market', m, 'carts', n, 'value', v, 'reachable', r) order by n desc), '[]'::jsonb)
      from (
        select coalesce(market, 'EG') as m, count(*) as n,
               coalesce(sum(cart_value), 0) as v, count(*) filter (where reachable) as r
        from base group by 1
      ) x
    )
  )
$function$;

drop function if exists public.fn_abandoned_repeaters(date, date, integer);
create function public.fn_abandoned_repeaters(p_from date default null, p_to date default null, p_limit integer default 50, p_markets text[] default null)
returns table(phone_norm text, full_name text, email text, customer_id text, carts bigint, total_value numeric, last_abandoned timestamptz, recovered bigint, recall_status text, market text)
language sql stable
set search_path to 'public'
as $function$
  select
    ac.phone_norm,
    max(ac.full_name) as full_name,
    max(ac.email) as email,
    max(ac.customer_id) as customer_id,
    count(*) as carts,
    coalesce(sum(ac.cart_value), 0) as total_value,
    max(ac.created_at) as last_abandoned,
    0::bigint as recovered,
    max(ac.recall_status) as recall_status,
    max(ac.market) as market
  from public.abandoned_carts ac
  where ac.phone_norm is not null and not ac.is_anomaly
    and ac.recall_status in ('new', 'contacted', 'responded')
    and (p_from is null or ac.created_at >= p_from)
    and (p_to is null or ac.created_at < p_to + interval '1 day')
    and (p_markets is null or cardinality(p_markets) = 0 or ac.market = any(p_markets))
  group by ac.phone_norm
  having count(*) > 1
  order by 6 desc
  limit least(coalesce(p_limit, 50), 500)
$function$;

-- ---------- 9) customer identities: country filter ----------
-- A person belongs to a market when ANY of their linked accounts does.
drop function if exists public.fn_identities_list(text, text[], text[], text[], text, integer, integer, numeric, numeric, date, date, date, date, integer, boolean, boolean, boolean, boolean, text, text, integer, integer);
create function public.fn_identities_list(
  p_search text default null, p_segments text[] default null, p_cities text[] default null,
  p_states text[] default null, p_status text default null,
  p_min_orders integer default null, p_max_orders integer default null,
  p_min_spent numeric default null, p_max_spent numeric default null,
  p_last_from date default null, p_last_to date default null,
  p_joined_from date default null, p_joined_to date default null,
  p_birth_month integer default null, p_has_email boolean default null, p_has_phone boolean default null,
  p_merged_only boolean default false, p_active boolean default null,
  p_sort text default 'spent', p_dir text default 'desc',
  p_limit integer default 25, p_offset integer default 0, p_markets text[] default null)
returns jsonb
language sql stable
set search_path to 'public'
as $function$
  with f as (
    select i.*
    from public.customer_identities i
    where (p_search is null or trim(p_search) = '' or i.search_text like '%' || lower(trim(p_search)) || '%')
      and (p_segments is null or cardinality(p_segments) = 0 or i.segment = any(p_segments))
      and (p_cities   is null or cardinality(p_cities) = 0   or coalesce(i.city,'—') = any(p_cities))
      and (p_states   is null or cardinality(p_states) = 0   or i.last_order_state = any(p_states))
      and (p_markets  is null or cardinality(p_markets) = 0  or exists (
            select 1 from public.customer_links l
            join public.customers cu on cu.customer_id = l.customer_id
            where l.master_id = i.master_id and cu.market = any(p_markets)))
      and (p_status is null or p_status = 'all'
           or (p_status = 'buyers'   and greatest(i.lifetime_orders, i.app_orders) > 0)
           or (p_status = 'never'    and greatest(i.lifetime_orders, i.app_orders) = 0)
           or (p_status = 'repeat'   and greatest(i.lifetime_delivered, i.app_orders) >= 2)
           or (p_status = 'one_time' and greatest(i.lifetime_delivered, i.app_orders) = 1)
           or (p_status = 'delivered_buyers' and i.lifetime_delivered > 0))
      and (p_min_orders is null or i.lifetime_orders >= p_min_orders)
      and (p_max_orders is null or i.lifetime_orders <= p_max_orders)
      and (p_min_spent  is null or i.lifetime_delivered_amount >= p_min_spent)
      and (p_max_spent  is null or i.lifetime_delivered_amount <= p_max_spent)
      and (p_last_from  is null or i.last_order_at >= p_last_from)
      and (p_last_to    is null or i.last_order_at <= p_last_to)
      and (p_joined_from is null or i.first_joined_at >= p_joined_from)
      and (p_joined_to   is null or i.first_joined_at < (p_joined_to + 1))
      and (p_birth_month is null or extract(month from i.birthdate) = p_birth_month)
      and (p_has_email is null or (cardinality(coalesce(i.emails, '{}'::text[])) > 0) = p_has_email)
      and (p_has_phone is null or (cardinality(coalesce(i.phones, '{}'::text[])) > 0) = p_has_phone)
      and (coalesce(p_merged_only, false) = false or i.accounts > 1)
      and (p_active is null or coalesce(i.is_active, true) = p_active)
  ),
  s as (
    select f.*,
      case lower(coalesce(p_sort,'spent'))
        when 'name' then null when 'city' then null
        when 'orders'    then f.lifetime_orders::numeric
        when 'delivered' then f.lifetime_delivered::numeric
        when 'accounts'  then f.accounts::numeric
        when 'recency'   then f.recency_days::numeric
        when 'last'      then extract(epoch from f.last_order_at)
        when 'joined'    then extract(epoch from f.first_joined_at)
        else f.lifetime_delivered_amount
      end as snum,
      case lower(coalesce(p_sort,'spent'))
        when 'name' then f.name when 'city' then f.city else null
      end as stxt
    from f
  ),
  page as (
    select * from s
    order by
      case when lower(coalesce(p_dir,'desc')) = 'asc'  then snum end asc  nulls last,
      case when lower(coalesce(p_dir,'desc')) <> 'asc' then snum end desc nulls last,
      case when lower(coalesce(p_dir,'desc')) = 'asc'  then stxt end asc  nulls last,
      case when lower(coalesce(p_dir,'desc')) <> 'asc' then stxt end desc nulls last,
      master_id
    limit greatest(coalesce(p_limit, 25), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(p) - 'search_text' - 'snum' - 'stxt') from page p
    ), '[]'::jsonb)
  );
$function$;

create or replace function public.fn_identity_filter_options()
returns jsonb
language sql stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'cities', coalesce((
      select jsonb_agg(x.city order by x.n desc)
      from (select coalesce(city,'—') as city, count(*) n from public.customer_identities group by 1) x
    ), '[]'::jsonb),
    'states', coalesce((
      select jsonb_agg(x.st order by x.n desc)
      from (select last_order_state as st, count(*) n from public.customer_identities
            where last_order_state is not null group by 1) x
    ), '[]'::jsonb),
    'markets', coalesce((
      select jsonb_agg(jsonb_build_object('market', x.m, 'n', x.n) order by x.n desc)
      from (select coalesce(market, 'EG') as m, count(*) n from public.customers group by 1) x
    ), '[]'::jsonb)
  );
$function$;
