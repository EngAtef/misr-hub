-- ============================================================
-- Migration 041: trend from REAL carts, platform series demoted.
-- User spotted 2025-11-26 & 2026-01-25 spikes (2.6M / 2.8M): both
-- days really had ~530 carts totaling ~210k — the platform's daily
-- "revenue lost" export is systematically inflated (sums to 157.75M
-- for the year vs 20.84M of real surviving carts; median day = 6.5x).
-- Fix: fn_abandoned_trend now computes lost value / avg / carts from
-- abandoned_carts itself (anomalies excluded) and returns the raw
-- platform figure only as a reference column. Platform days are
-- flagged is_anomaly when avg cart >= 10k OR the figure is >= 25x
-- the real value of that day's carts (floor 20k) — those appear only
-- in the separated anomaly report, now with the real value alongside.
-- Run after 040_abandoned_anomalies_filters.sql
-- ============================================================

-- trend: real series primary, platform reference secondary
drop function if exists public.fn_abandoned_trend(integer);
create or replace function public.fn_abandoned_trend(p_days integer default 3650)
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
  where coalesce(r.d, ad.day) >= current_date - make_interval(days => coalesce(p_days, 3650))
  order by 1
$$;
revoke execute on function public.fn_abandoned_trend(integer) from public, anon;
grant execute on function public.fn_abandoned_trend(integer) to authenticated;

-- link: daily anomaly rule now also catches inflation vs real carts
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

  update public.abandoned_carts
  set is_anomaly = coalesce(cart_value, 0) >= 35000 or coalesce(products_count, 0) >= 150,
      anomaly_reason = case
        when coalesce(cart_value, 0) >= 35000 then 'huge_value'
        when coalesce(products_count, 0) >= 150 then 'bulk_products'
        else null end
  where (coalesce(cart_value, 0) >= 35000 or coalesce(products_count, 0) >= 150) is distinct from is_anomaly
     or is_anomaly;
  get diagnostics v_anomalies = row_count;

  -- platform day = anomaly when avg cart is impossible OR the figure is
  -- >= 25x the real carts of that day (denominator floored at 20k so
  -- quiet days don't trip on noise)
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

-- anomaly report: platform days shown next to their REAL value
create or replace function public.fn_abandoned_anomaly_report()
returns jsonb
language sql stable set search_path = public
as $$
  with snap as (
    select created_at::date as d, sum(cart_value) as v
    from public.abandoned_carts
    where not is_anomaly and created_at is not null
    group by 1
  )
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
        'day', ad.day, 'lost_value', ad.lost_value, 'avg_cart_value', ad.avg_cart_value,
        'real_value', coalesce(s.v, 0)
      ) order by ad.lost_value desc nulls last), '[]'::jsonb)
      from public.abandoned_daily ad
      left join snap s on s.d = ad.day
      where ad.is_anomaly
    ),
    'carts_value', (select coalesce(sum(cart_value), 0) from public.abandoned_carts where is_anomaly),
    'days_value', (select coalesce(sum(lost_value), 0) from public.abandoned_daily where is_anomaly)
  )
$$;
revoke execute on function public.fn_abandoned_anomaly_report() from public, anon;
