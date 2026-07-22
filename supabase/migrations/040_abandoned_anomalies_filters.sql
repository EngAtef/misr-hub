-- ============================================================
-- Migration 040: separate test/anomaly data from real numbers +
-- richer filtering for the Abandoned Cart Recovery Center.
-- Ground truth: largest real order ever = 30,081 EGP / 83 items.
-- Rules (recomputed on every fn_abandoned_link run):
--   * cart_value >= 35,000            -> anomaly 'huge_value'
--   * products_count >= 150           -> anomaly 'bulk_products'
--   * daily avg_cart_value >= 10,000  -> anomaly day (platform spike
--     from carts that no longer exist; e.g. 2026-04-09 = 8.9M "lost")
-- Anomalies are EXCLUDED from every KPI/segment/list/chart and served
-- separately via fn_abandoned_anomaly_report. fn_abandoned_carts_list
-- gains traffic/value filters and sort orders.
-- Run after 039_abandoned_carts.sql
-- ============================================================

alter table public.abandoned_carts add column if not exists is_anomaly boolean not null default false;
alter table public.abandoned_carts add column if not exists anomaly_reason text;
alter table public.abandoned_daily add column if not exists is_anomaly boolean not null default false;
create index if not exists idx_ab_carts_anomaly on public.abandoned_carts (is_anomaly) where is_anomaly;

-- ---- link: also (re)flag anomalies on every run ----
create or replace function public.fn_abandoned_link()
returns jsonb
language plpgsql set search_path = public
as $$
declare
  v_customers integer := 0;
  v_emails integer := 0;
  v_recovered integer := 0;
  v_anomalies integer := 0;
begin
  if public.my_role() not in ('admin','manager') then
    raise exception 'Forbidden';
  end if;

  update public.abandoned_carts ac
  set customer_id = c.customer_id, is_guest = false
  from public.customers c
  where ac.customer_id is null
    and ac.phone_norm is not null
    and public.norm_eg_phone(c.phone) = ac.phone_norm;
  get diagnostics v_customers = row_count;

  update public.abandoned_carts ac
  set customer_id = c.customer_id, is_guest = false
  from public.customers c
  where ac.customer_id is null
    and ac.email is not null
    and lower(c.email) = ac.email;
  get diagnostics v_emails = row_count;

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

  -- full recompute so threshold changes apply on re-runs
  update public.abandoned_carts
  set is_anomaly = coalesce(cart_value, 0) >= 35000 or coalesce(products_count, 0) >= 150,
      anomaly_reason = case
        when coalesce(cart_value, 0) >= 35000 then 'huge_value'
        when coalesce(products_count, 0) >= 150 then 'bulk_products'
        else null end
  where (coalesce(cart_value, 0) >= 35000 or coalesce(products_count, 0) >= 150) is distinct from is_anomaly
     or is_anomaly;
  get diagnostics v_anomalies = row_count;

  update public.abandoned_daily
  set is_anomaly = coalesce(avg_cart_value, 0) >= 10000
  where is_anomaly is distinct from (coalesce(avg_cart_value, 0) >= 10000);

  return jsonb_build_object(
    'matched_by_phone', v_customers,
    'matched_by_email', v_emails,
    'auto_recovered', v_recovered,
    'anomalies_flagged', v_anomalies
  );
end;
$$;
revoke execute on function public.fn_abandoned_link() from public, anon;

-- ---- summary: real numbers only + anomaly totals on the side ----
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
    where not is_anomaly
  ),
  rep as (
    select count(*) as n from (
      select 1 from public.abandoned_carts
      where phone_norm is not null and not is_anomaly
      group by phone_norm having count(*) > 1
    ) x
  ),
  anom as (
    select count(*) as carts, coalesce(sum(cart_value), 0) as value
    from public.abandoned_carts where is_anomaly
  ),
  anom_days as (
    select count(*) as days, coalesce(sum(lost_value), 0) as value
    from public.abandoned_daily where is_anomaly
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
    'last_import', a.last_import,
    'anomaly_carts', an.carts,
    'anomaly_value', an.value,
    'anomaly_days', ad.days,
    'anomaly_days_value', ad.value
  )
  from agg a, rep r, anom an, anom_days ad
$$;
revoke execute on function public.fn_abandoned_summary() from public, anon;

-- ---- segments: exclude anomalies ----
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
        where phone_norm is not null and not is_anomaly
        group by phone_norm having count(*) > 1
      ) as is_repeat
    from public.abandoned_carts
    where not is_anomaly
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

-- ---- list: anomaly exclusion + traffic/value filters + sort orders ----
drop function if exists public.fn_abandoned_carts_list(text, text[], text, integer, integer);
create or replace function public.fn_abandoned_carts_list(
  p_segment text default null,
  p_status text[] default null,
  p_search text default null,
  p_traffic text[] default null,
  p_min_value numeric default null,
  p_max_value numeric default null,
  p_order text default 'newest',
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
  age_days numeric, is_repeat boolean, is_anomaly boolean, anomaly_reason text,
  customer_name text, customer_city text,
  lifetime_orders integer, lifetime_delivered_amount numeric,
  full_count bigint
)
language sql stable set search_path = public
as $$
  with rep as (
    select phone_norm from public.abandoned_carts
    where phone_norm is not null and not is_anomaly
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
    count(*) over () as full_count
  from base b
  left join public.customers c on c.customer_id = b.customer_id
  where (case when coalesce(p_segment, '') = 'anomaly' then b.is_anomaly else not b.is_anomaly end)
    and (p_status is null or b.recall_status = any(p_status))
    and (p_traffic is null or b.traffic_hint = any(p_traffic))
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
    (b.reachable) desc, b.created_at desc
  limit least(coalesce(p_limit, 50), 1000)
  offset greatest(coalesce(p_offset, 0), 0)
$$;
revoke execute on function public.fn_abandoned_carts_list(text, text[], text, text[], numeric, numeric, text, integer, integer) from public, anon;
grant execute on function public.fn_abandoned_carts_list(text, text[], text, text[], numeric, numeric, text, integer, integer) to authenticated;

-- ---- top products / repeaters: exclude anomaly carts + glitch quantities ----
create or replace function public.fn_abandoned_top_products(
  p_days integer default null,
  p_limit integer default 30
)
returns table (
  sku text, product_name text, carts bigint, total_qty numeric,
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
  where (p_days is null or i.created_at >= now() - make_interval(days => p_days))
    and coalesce(i.qty, 1) < 50
    and (i.cart_name is null or i.cart_name not in
      (select full_name from public.abandoned_carts where is_anomaly and full_name is not null))
  group by i.sku
  order by 3 desc
  limit least(coalesce(p_limit, 30), 200)
$$;
revoke execute on function public.fn_abandoned_top_products(integer, integer) from public, anon;
grant execute on function public.fn_abandoned_top_products(integer, integer) to authenticated;

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
  where ac.phone_norm is not null and not ac.is_anomaly
  group by ac.phone_norm
  having count(*) > 1
  order by 6 desc
  limit least(coalesce(p_limit, 50), 500)
$$;
revoke execute on function public.fn_abandoned_repeaters(integer) from public, anon;

-- ---- trend: real days only ----
create or replace function public.fn_abandoned_trend(p_days integer default 3650)
returns table (day date, lost_value numeric, avg_cart_value numeric, carts bigint)
language sql stable set search_path = public
as $$
  with counts as (
    select created_at::date as d, count(*) as n
    from public.abandoned_carts
    where not is_anomaly
    group by 1
  )
  select
    coalesce(ad.day, c.d) as day,
    ad.lost_value,
    ad.avg_cart_value,
    coalesce(c.n, 0) as carts
  from (select * from public.abandoned_daily where not is_anomaly) ad
  full outer join counts c on c.d = ad.day
  where coalesce(ad.day, c.d) >= current_date - make_interval(days => coalesce(p_days, 3650))
  order by 1
$$;
revoke execute on function public.fn_abandoned_trend(integer) from public, anon;

-- ---- behavior breakdowns (hour / weekday / value bucket / traffic) ----
create or replace function public.fn_abandoned_breakdowns()
returns jsonb
language sql stable set search_path = public
as $$
  with base as (
    select cart_value, created_at, traffic_hint,
      (phone_norm is not null or email is not null) as reachable
    from public.abandoned_carts
    where not is_anomaly and created_at is not null
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
    )
  )
$$;
revoke execute on function public.fn_abandoned_breakdowns() from public, anon;

-- ---- separated anomaly / test-data report ----
create or replace function public.fn_abandoned_anomaly_report()
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'carts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'cart_key', cart_key, 'full_name', full_name, 'phone', phone, 'email', email,
        'products_count', products_count, 'cart_value', cart_value,
        'created_at', created_at, 'reason', anomaly_reason,
        'user_ip', user_ip, 'web_url', web_url
      ) order by cart_value desc nulls last), '[]'::jsonb)
      from public.abandoned_carts where is_anomaly
    ),
    'days', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', day, 'lost_value', lost_value, 'avg_cart_value', avg_cart_value
      ) order by lost_value desc nulls last), '[]'::jsonb)
      from public.abandoned_daily where is_anomaly
    ),
    'carts_value', (select coalesce(sum(cart_value), 0) from public.abandoned_carts where is_anomaly),
    'days_value', (select coalesce(sum(lost_value), 0) from public.abandoned_daily where is_anomaly)
  )
$$;
revoke execute on function public.fn_abandoned_anomaly_report() from public, anon;
