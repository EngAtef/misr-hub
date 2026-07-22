-- ============================================================
-- Migration 042: date-range filter for the Abandoned Center.
-- Every analysis RPC gains p_from / p_to (date, null = unbounded);
-- the page's DateRangeFilter scopes KPIs, segments, breakdowns,
-- top products, repeaters, the cart list and the trend to the
-- chosen period (filtering on the cart's created_at / trend day).
-- p_to is inclusive (internally < p_to + 1 day).
-- Signatures change, so old versions are dropped first (PostgREST
-- would otherwise see ambiguous overloads).
-- Run after 041_abandoned_real_trend.sql
-- ============================================================

drop function if exists public.fn_abandoned_summary();
create or replace function public.fn_abandoned_summary(p_from date default null, p_to date default null)
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
      and (p_from is null or created_at >= p_from)
      and (p_to is null or created_at < p_to + interval '1 day')
  ),
  rep as (
    select count(*) as n from (
      select 1 from public.abandoned_carts
      where phone_norm is not null and not is_anomaly
        and (p_from is null or created_at >= p_from)
        and (p_to is null or created_at < p_to + interval '1 day')
      group by phone_norm having count(*) > 1
    ) x
  ),
  anom as (
    select count(*) as carts, coalesce(sum(cart_value), 0) as value
    from public.abandoned_carts
    where is_anomaly
      and (p_from is null or created_at >= p_from)
      and (p_to is null or created_at < p_to + interval '1 day')
  ),
  anom_days as (
    select count(*) as days, coalesce(sum(lost_value), 0) as value
    from public.abandoned_daily
    where is_anomaly
      and (p_from is null or day >= p_from)
      and (p_to is null or day <= p_to)
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
revoke execute on function public.fn_abandoned_summary(date, date) from public, anon;
grant execute on function public.fn_abandoned_summary(date, date) to authenticated;

drop function if exists public.fn_abandoned_segments();
create or replace function public.fn_abandoned_segments(p_from date default null, p_to date default null)
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
      and (p_from is null or created_at >= p_from)
      and (p_to is null or created_at < p_to + interval '1 day')
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
revoke execute on function public.fn_abandoned_segments(date, date) from public, anon;
grant execute on function public.fn_abandoned_segments(date, date) to authenticated;

drop function if exists public.fn_abandoned_breakdowns();
create or replace function public.fn_abandoned_breakdowns(p_from date default null, p_to date default null)
returns jsonb
language sql stable set search_path = public
as $$
  with base as (
    select cart_value, created_at, traffic_hint,
      (phone_norm is not null or email is not null) as reachable
    from public.abandoned_carts
    where not is_anomaly and created_at is not null
      and (p_from is null or created_at >= p_from)
      and (p_to is null or created_at < p_to + interval '1 day')
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
revoke execute on function public.fn_abandoned_breakdowns(date, date) from public, anon;
grant execute on function public.fn_abandoned_breakdowns(date, date) to authenticated;

drop function if exists public.fn_abandoned_top_products(integer, integer);
create or replace function public.fn_abandoned_top_products(
  p_from date default null,
  p_to date default null,
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
  where (p_from is null or i.created_at >= p_from)
    and (p_to is null or i.created_at < p_to + interval '1 day')
    and coalesce(i.qty, 1) < 50
    and (i.cart_name is null or i.cart_name not in
      (select full_name from public.abandoned_carts where is_anomaly and full_name is not null))
  group by i.sku
  order by 3 desc
  limit least(coalesce(p_limit, 30), 200)
$$;
revoke execute on function public.fn_abandoned_top_products(date, date, integer) from public, anon;
grant execute on function public.fn_abandoned_top_products(date, date, integer) to authenticated;

drop function if exists public.fn_abandoned_repeaters(integer);
create or replace function public.fn_abandoned_repeaters(
  p_from date default null,
  p_to date default null,
  p_limit integer default 50
)
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
    and (p_from is null or ac.created_at >= p_from)
    and (p_to is null or ac.created_at < p_to + interval '1 day')
  group by ac.phone_norm
  having count(*) > 1
  order by 6 desc
  limit least(coalesce(p_limit, 50), 500)
$$;
revoke execute on function public.fn_abandoned_repeaters(date, date, integer) from public, anon;
grant execute on function public.fn_abandoned_repeaters(date, date, integer) to authenticated;

drop function if exists public.fn_abandoned_trend(integer);
create or replace function public.fn_abandoned_trend(
  p_days integer default 3650,
  p_from date default null,
  p_to date default null
)
returns table (day date, lost_value numeric, avg_cart_value numeric, carts bigint, platform_lost numeric)
language sql stable set search_path = public
as $$
  with real_days as (
    select created_at::date as d, count(*) as n, coalesce(sum(cart_value), 0) as v
    from public.abandoned_carts
    where not is_anomaly and created_at is not null
    group by 1
  )
  select
    coalesce(r.d, ad.day) as day,
    coalesce(r.v, 0) as lost_value,
    case when coalesce(r.n, 0) > 0 then round(r.v / r.n, 2) end as avg_cart_value,
    coalesce(r.n, 0) as carts,
    case when ad.is_anomaly then null else ad.lost_value end as platform_lost
  from real_days r
  full outer join public.abandoned_daily ad on ad.day = r.d
  where (case
      when p_from is not null or p_to is not null then
        (p_from is null or coalesce(r.d, ad.day) >= p_from)
        and (p_to is null or coalesce(r.d, ad.day) <= p_to)
      else coalesce(r.d, ad.day) >= current_date - make_interval(days => coalesce(p_days, 3650))
    end)
  order by 1
$$;
revoke execute on function public.fn_abandoned_trend(integer, date, date) from public, anon;
grant execute on function public.fn_abandoned_trend(integer, date, date) to authenticated;

drop function if exists public.fn_abandoned_carts_list(text, text[], text, text[], numeric, numeric, text, integer, integer);
create or replace function public.fn_abandoned_carts_list(
  p_segment text default null,
  p_status text[] default null,
  p_search text default null,
  p_traffic text[] default null,
  p_min_value numeric default null,
  p_max_value numeric default null,
  p_order text default 'newest',
  p_from date default null,
  p_to date default null,
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
    and (p_from is null or b.created_at >= p_from)
    and (p_to is null or b.created_at < p_to + interval '1 day')
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
revoke execute on function public.fn_abandoned_carts_list(text, text[], text, text[], numeric, numeric, text, date, date, integer, integer) from public, anon;
grant execute on function public.fn_abandoned_carts_list(text, text[], text, text[], numeric, numeric, text, date, date, integer, integer) to authenticated;
