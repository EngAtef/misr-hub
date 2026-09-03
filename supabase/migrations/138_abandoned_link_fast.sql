-- ============================================================
-- Migration 138: fn_abandoned_link under the 8 s cap.
--
-- Re-match (the page button and the Data Center carts import) took
-- ~19 s server-side even after 135-137, so from the app it always
-- 500'd at the statement timeout. Measured per step:
--   phone match       3.0 s  hash join recomputing norm_phone_key over
--                            all 44k customers, for ~500 candidate carts
--   email match       3.8 s  same shape, no index on lower(email)
--   orphan-day check  ~10 s  `created_at::date = ad.day` per daily row
--                            = a 60k-row scan for each of 430 days
--   weights           6.6 s  fn_recompute_cart_weights(null) rebuilds
--                            all 60k carts from 202k items every run,
--                            even when 0 rows change
-- Fix: probe idx_customers_phone_key / a new lower(email) index per
-- candidate cart (LATERAL ... LIMIT 1), derive orphan days from the
-- same daily snapshot CTE, and only recompute weights for carts that
-- still lack one (weight_kg null or weight_missing > 0). A full
-- weights pass stays available with p_full => true for server-side
-- use. Matching semantics are unchanged. Run after 137.
-- ============================================================

create index if not exists idx_customers_email_lower on public.customers (lower(email)) where email is not null;
create index if not exists idx_ab_carts_unlinked_phone on public.abandoned_carts (phone_norm) where customer_id is null and phone_norm is not null;
create index if not exists idx_ab_carts_unlinked_email on public.abandoned_carts (email) where customer_id is null and email is not null;
create index if not exists idx_ab_carts_unrecovered_phone on public.abandoned_carts (phone_norm) where recovered_order_number is null and phone_norm is not null;

drop function if exists public.fn_abandoned_link();

create or replace function public.fn_abandoned_link(p_full boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  v_customers integer := 0;
  v_emails integer := 0;
  v_markets integer := 0;
  v_recovered integer := 0;
  v_anomalies integer := 0;
  v_weights integer := 0;
  v_keys text[];
begin
  if public.my_role() not in ('admin','manager') then
    raise exception 'Forbidden';
  end if;

  -- phone match: one index probe per unlinked cart
  update public.abandoned_carts ac
  set customer_id = m.customer_id, is_guest = false
  from (
    select ac2.cart_key, c.customer_id
    from public.abandoned_carts ac2
    cross join lateral (
      select c.customer_id from public.customers c
      where public.norm_phone_key(c.phone) = ac2.phone_norm
      limit 1
    ) c
    where ac2.customer_id is null and ac2.phone_norm is not null
  ) m
  where m.cart_key = ac.cart_key;
  get diagnostics v_customers = row_count;

  -- email match: same, on lower(email)
  update public.abandoned_carts ac
  set customer_id = m.customer_id, is_guest = false
  from (
    select ac2.cart_key, c.customer_id
    from public.abandoned_carts ac2
    cross join lateral (
      select c.customer_id from public.customers c
      where c.email is not null and lower(c.email) = ac2.email
      limit 1
    ) c
    where ac2.customer_id is null and ac2.email is not null
  ) m
  where m.cart_key = ac.cart_key;
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

  -- daily rows: flag days whose reported loss is far above the real
  -- cart total for that day; days with no real carts use flat limits
  create temp table if not exists _ab_snap (d date primary key, v numeric) on commit drop;
  truncate _ab_snap;
  insert into _ab_snap
  select created_at::date, sum(cart_value)
  from public.abandoned_carts
  where not is_anomaly and created_at is not null
  group by 1;

  update public.abandoned_daily ad
  set is_anomaly = coalesce(ad.avg_cart_value, 0) >= 10000
    or coalesce(ad.lost_value, 0) >= 25 * greatest(coalesce(s.v, 0), 20000)
  from _ab_snap s
  where s.d = ad.day;

  update public.abandoned_daily ad
  set is_anomaly = coalesce(ad.avg_cart_value, 0) >= 10000
    or coalesce(ad.lost_value, 0) >= 500000
  where not exists (select 1 from _ab_snap s where s.d = ad.day);

  perform public.fn_abandoned_estimate_values();

  if p_full then
    v_weights := public.fn_recompute_cart_weights(null);
  else
    select array_agg(cart_key) into v_keys
    from public.abandoned_carts
    where weight_kg is null or coalesce(weight_missing, 0) > 0;
    if v_keys is not null then
      v_weights := public.fn_recompute_cart_weights(v_keys);
    end if;
  end if;

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

revoke execute on function public.fn_abandoned_link(boolean) from public, anon;
grant execute on function public.fn_abandoned_link(boolean) to authenticated;
