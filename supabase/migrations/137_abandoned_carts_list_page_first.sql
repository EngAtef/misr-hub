-- ============================================================
-- Migration 137: fn_abandoned_carts_list pages before joining.
--
-- After 135/136 the all-time cart list still took ~4.5 s: the left
-- join to customers ran as a nested loop over every one of the 60k
-- filtered carts (60k index probes at ~0.08 ms each) before the
-- window count / sort / LIMIT. Nothing in the filters or ordering
-- reads the customer row, so the page of N carts is taken first and
-- only those N rows are joined. Same columns, same order, same
-- full_count. Run after 136.
-- ============================================================

create or replace function public.fn_abandoned_carts_list(
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
  full_count bigint, weight_kg numeric, weight_missing integer, market text,
  value_estimated boolean)
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $function$
#variable_conflict use_column
begin
  perform public.fn_abandoned_assert_reader();
  return query
  with fx as (
    select case coalesce(r->>'global_currency', 'USD')
      when 'SAR' then coalesce((r->>'sar_egp')::numeric, 12.95)
      when 'EGP' then 1
      else coalesce((r->>'usd_egp')::numeric, 48.5) end as g
    from (select public.fn_fx_rates() as r) x
  ),
  rep as (
    select ac.phone_norm from public.abandoned_carts ac
    where ac.phone_norm is not null and not ac.is_anomaly
      and ac.recall_status in ('new', 'contacted', 'responded')
    group by ac.phone_norm having count(*) > 1
  ),
  base as (
    select ac.*,
      (case when coalesce(ac.market, 'EG') = 'EG' then 1 else fx.g end) as f,
      coalesce(ac.cart_value, case when coalesce(ac.market, 'EG') <> 'EG' then ac.est_value_usd end) as val_c,
      (ac.cart_value is null and coalesce(ac.market, 'EG') <> 'EG' and ac.est_value_usd is not null) as est_c,
      (ac.phone_norm is not null or ac.email is not null) as reachable,
      round((extract(epoch from (now() - ac.created_at)) / 86400.0)::numeric, 1) as age_days_c,
      (ac.phone_norm in (select r.phone_norm from rep r)) as is_repeat_c
    from public.abandoned_carts ac cross join fx
  ),
  page as (
    -- filter, count, order and page BEFORE touching customers
    select b.*, count(*) over () as full_count_c
    from base b
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
      and (p_min_value is null or b.val_c * b.f >= p_min_value)
      and (p_max_value is null or b.val_c * b.f <= p_max_value)
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
        when 'vip_1000' then b.val_c * b.f >= 1000
        when 'reachable' then b.reachable
        when 'known_customer' then b.customer_id is not null
        when 'prospect' then b.reachable and b.customer_id is null
        when 'repeat_abandoner' then coalesce(b.is_repeat_c, false)
        when 'facebook' then b.traffic_hint = 'facebook'
        when 'guest_anon' then not b.reachable
        else true
      end)
    order by
      case when p_order = 'value_desc' then -coalesce(b.val_c * b.f, 0) end,
      case when p_order = 'value_asc' then coalesce(b.val_c * b.f, 0) end,
      case when p_order = 'oldest' then extract(epoch from b.created_at) end,
      case when p_order = 'products_desc' then -coalesce(b.products_count, 0) end,
      case when p_order = 'weight_desc' then -coalesce(b.weight_kg, 0) end,
      (b.reachable) desc, b.created_at desc
    limit least(coalesce(p_limit, 50), 1000)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    b.cart_key, b.full_name, b.email, b.phone, b.phone_norm,
    b.products_count, b.skus, round(b.val_c * b.f, 2) as cart_value,
    b.created_at, b.notified_at, b.web_url,
    b.traffic_hint, b.is_guest, b.customer_id,
    b.recall_status, b.recall_note, b.recalled_at, b.recalled_by,
    b.recovered_order_number, b.recovered_at, round(b.recovered_value * b.f, 2) as recovered_value,
    b.age_days_c, coalesce(b.is_repeat_c, false), b.is_anomaly, b.anomaly_reason,
    c.name, c.city,
    coalesce(c.lifetime_orders, c.total_orders), c.lifetime_delivered_amount,
    b.full_count_c,
    b.weight_kg, b.weight_missing, b.market,
    b.est_c as value_estimated
  from page b
  left join public.customers c on c.customer_id = b.customer_id
  order by
    case when p_order = 'value_desc' then -coalesce(b.val_c * b.f, 0) end,
    case when p_order = 'value_asc' then coalesce(b.val_c * b.f, 0) end,
    case when p_order = 'oldest' then extract(epoch from b.created_at) end,
    case when p_order = 'products_desc' then -coalesce(b.products_count, 0) end,
    case when p_order = 'weight_desc' then -coalesce(b.weight_kg, 0) end,
    (b.reachable) desc, b.created_at desc;
end
$function$;

revoke execute on function public.fn_abandoned_carts_list(text, text[], text, text[], numeric, numeric, text, date, date, integer, integer, text[]) from public, anon;
grant execute on function public.fn_abandoned_carts_list(text, text[], text, text[], numeric, numeric, text, date, date, integer, integer, text[]) to authenticated;
