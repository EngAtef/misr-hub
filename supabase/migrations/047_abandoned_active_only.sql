-- ============================================================
-- Migration 047: recovered abandoners leave the abandoners list.
-- Once a matching phone places ANY non-cancelled order after the
-- abandonment date (45-day cap removed), the cart auto-flips to
-- 'recovered' — and every working surface now shows ACTIVE carts
-- only (new / contacted / responded):
--   * fn_abandoned_summary   headline KPIs = active carts; recovered/
--     lost keep their own counters
--   * fn_abandoned_segments  active carts only
--   * fn_abandoned_carts_list default (no status filter) = active;
--     the funnel chips still open recovered/lost via p_status
--   * fn_abandoned_repeaters  counts active carts only
--   * fn_abandoned_top_products excludes items of recovered/lost/
--     excluded/anomaly carts (per-cart match via new name+time index)
-- Trend keeps ALL events (it is history, not a work queue).
-- Run after 046_birthdays_ordered_flag.sql
-- ============================================================

create index if not exists idx_ab_carts_name_created on public.abandoned_carts (full_name, created_at);

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

  -- ANY later non-cancelled order from the same phone = the customer is
  -- back; the cart leaves the work queue automatically.
  with m as (
    select ac.cart_key, o.order_number, o.order_date, o.total_order_amount,
           row_number() over (partition by ac.cart_key order by o.order_date) as rn
    from public.abandoned_carts ac
    join public.orders o
      on public.norm_eg_phone(o.customer_phone) = ac.phone_norm
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

  return jsonb_build_object(
    'matched_by_phone', v_customers,
    'matched_by_email', v_emails,
    'auto_recovered', v_recovered,
    'anomalies_flagged', v_anomalies
  );
end;
$$;
revoke execute on function public.fn_abandoned_link() from public, anon;

-- summary: headline numbers = active work queue
create or replace function public.fn_abandoned_summary(p_from date default null, p_to date default null)
returns jsonb
language sql stable set search_path = public
as $$
  with scoped as (
    select * from public.abandoned_carts
    where not is_anomaly
      and (p_from is null or created_at >= p_from)
      and (p_to is null or created_at < p_to + interval '1 day')
  ),
  base as (
    select cart_value, phone_norm, email, customer_id, recall_status,
      traffic_hint, notified_at, imported_at,
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
  outcome as (
    select
      count(*) filter (where recall_status = 'recovered') as recovered_carts,
      coalesce(sum(coalesce(recovered_value, cart_value)) filter (where recall_status = 'recovered'), 0) as recovered_value,
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
    'recovered_carts', o.recovered_carts,
    'recovered_value', o.recovered_value,
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
    'anomaly_days_value', ad.value
  )
  from agg a, rep r, anom an, anom_days ad, outcome o
$$;
revoke execute on function public.fn_abandoned_summary(date, date) from public, anon;
grant execute on function public.fn_abandoned_summary(date, date) to authenticated;

-- segments: active carts only
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
          and recall_status in ('new', 'contacted', 'responded')
        group by phone_norm having count(*) > 1
      ) as is_repeat
    from public.abandoned_carts
    where not is_anomaly
      and recall_status in ('new', 'contacted', 'responded')
      and (p_from is null or created_at >= p_from)
      and (p_to is null or created_at < p_to + interval '1 day')
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
$$;
revoke execute on function public.fn_abandoned_segments(date, date) from public, anon;
grant execute on function public.fn_abandoned_segments(date, date) to authenticated;

-- list: default view = active work queue; explicit p_status wins
drop function if exists public.fn_abandoned_carts_list(text, text[], text, text[], numeric, numeric, text, date, date, integer, integer);
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
    count(*) over () as full_count
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

-- repeaters: active carts only
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
    0::bigint as recovered,
    max(ac.recall_status) as recall_status
  from public.abandoned_carts ac
  where ac.phone_norm is not null and not ac.is_anomaly
    and ac.recall_status in ('new', 'contacted', 'responded')
    and (p_from is null or ac.created_at >= p_from)
    and (p_to is null or ac.created_at < p_to + interval '1 day')
  group by ac.phone_norm
  having count(*) > 1
  order by 6 desc
  limit least(coalesce(p_limit, 50), 500)
$$;
revoke execute on function public.fn_abandoned_repeaters(date, date, integer) from public, anon;
grant execute on function public.fn_abandoned_repeaters(date, date, integer) to authenticated;

-- top products: only items of ACTIVE carts (correlated match via the
-- (full_name, created_at) index; items with no matching cart stay in)
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
    and not exists (
      select 1 from public.abandoned_carts ac
      where ac.full_name = i.cart_name
        and i.created_at between ac.created_at - interval '1 hour' and ac.created_at + interval '1 hour'
        and (ac.is_anomaly or ac.recall_status in ('recovered', 'lost', 'excluded'))
    )
  group by i.sku
  order by 3 desc
  limit least(coalesce(p_limit, 30), 200)
$$;
revoke execute on function public.fn_abandoned_top_products(date, date, integer) from public, anon;
grant execute on function public.fn_abandoned_top_products(date, date, integer) to authenticated;
