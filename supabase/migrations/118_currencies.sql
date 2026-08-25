-- 118_currencies.sql — three-currency layer (EGP / USD / SAR).
--
-- Foreign orders arrive with amounts in the global storefront's currency
-- (assumed USD — configurable), Egyptian orders in EGP. Every money figure
-- returned by the analytics RPCs is normalized into EGP using editable FX
-- rates (app_settings key 'fx'); the app then converts to the display
-- currency (EGP/USD/SAR) client-side.

-- ---------- 1) FX settings ----------
create or replace function public.fn_fx_rates()
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'usd_egp', coalesce((value->>'usd_egp')::numeric, 48.5),
    'sar_egp', coalesce((value->>'sar_egp')::numeric, 12.95),
    'global_currency', coalesce(value->>'global_currency', 'USD')
  )
  from (select coalesce((select value from public.app_settings where key = 'fx'), '{}'::jsonb) as value) s
$$;
revoke execute on function public.fn_fx_rates() from anon, public;
grant execute on function public.fn_fx_rates() to authenticated;

create or replace function public.fn_fx_set(p_usd numeric, p_sar numeric, p_global text)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if public.my_role() <> 'admin' then
    raise exception 'Forbidden';
  end if;
  if p_usd is null or p_usd <= 0 or p_sar is null or p_sar <= 0
     or p_global not in ('USD','SAR','EGP') then
    raise exception 'Invalid FX settings';
  end if;
  v := jsonb_build_object('usd_egp', p_usd, 'sar_egp', p_sar, 'global_currency', p_global);
  insert into public.app_settings(key, value) values ('fx', v)
  on conflict (key) do update set value = excluded.value;
  return v;
end $$;
revoke execute on function public.fn_fx_set(numeric, numeric, text) from anon, public;
grant execute on function public.fn_fx_set(numeric, numeric, text) to authenticated;

-- ---------- 2) orders.currency ----------
alter table public.orders add column if not exists currency text;

create or replace function public.trg_orders_market()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if not coalesce(new.market_locked, false) then
    new.market := public.fn_market_code(new.customer_phone, new.city);
  end if;
  new.currency := case
    when coalesce(new.market, 'EG') = 'EG' then 'EGP'
    else coalesce(public.fn_fx_rates()->>'global_currency', 'USD')
  end;
  return new;
end $$;

update public.orders set currency = case
  when coalesce(market, 'EG') = 'EG' then 'EGP'
  else coalesce(public.fn_fx_rates()->>'global_currency', 'USD')
end
where currency is null;

-- ---------- 3) EGP-normalized analytics ----------
create or replace function public.fn_kpis(p_from timestamptz, p_to timestamptz, p_markets text[] default null)
returns json
language sql stable
set search_path to 'public'
as $function$
  with fx as (
    select coalesce((r->>'usd_egp')::numeric, 48.5) as usd,
           coalesce((r->>'sar_egp')::numeric, 12.95) as sar
    from (select public.fn_fx_rates() as r) x
  ),
  o as (
    select o.*,
      case coalesce(o.currency, 'EGP')
        when 'EGP' then 1 when 'USD' then fx.usd when 'SAR' then fx.sar else fx.usd
      end as f
    from public.orders o cross join fx
    where (p_from is null or o.order_date >= p_from)
      and (p_to is null or o.order_date < p_to)
      and (p_markets is null or cardinality(p_markets) = 0 or o.market = any(p_markets))
  )
  select json_build_object(
    'total_orders', count(*),
    'gross_revenue', coalesce(sum(total_order_amount * f), 0),
    'net_revenue', coalesce(sum(total_order_amount * f) filter (where order_status not in ('Cancelled', 'Returned', 'Return Sent To Erp')), 0),
    'delivered_orders', count(*) filter (where order_status = 'Delivered'),
    'cancelled_orders', count(*) filter (where order_status = 'Cancelled'),
    'returned_orders', count(*) filter (where order_status in ('Returned', 'Return Sent To Erp', 'Return Request')),
    'in_progress_orders', count(*) filter (where order_status in ('Placed', 'Confirmed', 'Shipped', 'Out For Delivery', 'Picked by courier', 'Send To Erp')),
    'cod_orders', count(*) filter (where payment_method = 'Cash On Delivery'),
    'cod_amount', coalesce(sum(cod_amount * f), 0),
    'online_paid_amount', coalesce(sum(online_paid_amount * f), 0),
    'avg_order_value', coalesce(avg(total_order_amount * f), 0),
    'unique_customers', count(distinct coalesce(master_id, customer_id)),
    'avg_customer_rating', avg(customer_rating) filter (where customer_rating > 0),
    'avg_driver_rating', avg(driver_rating) filter (where driver_rating > 0),
    'avg_delivery_days', avg(extract(epoch from (delivery_date - order_date)) / 86400.0) filter (where delivery_date is not null and order_date is not null),
    'total_weight_kg', coalesce(sum(weight_kg), 0),
    'net_weight_kg', coalesce(sum(weight_kg) filter (where order_status not in ('Cancelled', 'Returned', 'Return Sent To Erp')), 0),
    'avg_weight_kg', avg(weight_kg),
    'weighed_orders', count(weight_kg)
  )
  from o;
$function$;

create or replace function public.fn_breakdown(p_dim text, p_from timestamptz, p_to timestamptz, p_limit integer default 30, p_markets text[] default null)
returns table(label text, orders bigint, revenue numeric, delivered bigint, cancelled_or_returned bigint, weight_kg numeric)
language sql stable
set search_path to 'public'
as $function$
  with fx as (
    select coalesce((r->>'usd_egp')::numeric, 48.5) as usd,
           coalesce((r->>'sar_egp')::numeric, 12.95) as sar
    from (select public.fn_fx_rates() as r) x
  )
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
    coalesce(sum(total_order_amount * case coalesce(o.currency,'EGP')
      when 'EGP' then 1 when 'USD' then fx.usd when 'SAR' then fx.sar else fx.usd end), 0) as revenue,
    count(*) filter (where order_status = 'Delivered') as delivered,
    count(*) filter (where order_status in ('Cancelled', 'Returned', 'Return Sent To Erp', 'Return Request')) as cancelled_or_returned,
    round(coalesce(sum(o.weight_kg), 0), 2) as weight_kg
  from public.orders o cross join fx
  where (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < p_to)
    and (p_markets is null or cardinality(p_markets) = 0 or market = any(p_markets))
  group by 1
  order by 2 desc
  limit p_limit;
$function$;

create or replace function public.fn_orders_by_day(p_from timestamptz, p_to timestamptz, p_markets text[] default null)
returns table(day date, orders bigint, revenue numeric, delivered bigint, cancelled bigint, weight_kg numeric)
language sql stable
set search_path to 'public'
as $function$
  with fx as (
    select coalesce((r->>'usd_egp')::numeric, 48.5) as usd,
           coalesce((r->>'sar_egp')::numeric, 12.95) as sar
    from (select public.fn_fx_rates() as r) x
  )
  select
    date_trunc('day', order_date)::date as day,
    count(*) as orders,
    coalesce(sum(total_order_amount * case coalesce(o.currency,'EGP')
      when 'EGP' then 1 when 'USD' then fx.usd when 'SAR' then fx.sar else fx.usd end), 0) as revenue,
    count(*) filter (where order_status = 'Delivered') as delivered,
    count(*) filter (where order_status = 'Cancelled') as cancelled,
    round(coalesce(sum(o.weight_kg), 0), 2) as weight_kg
  from public.orders o cross join fx
  where order_date is not null
    and (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < p_to)
    and (p_markets is null or cardinality(p_markets) = 0 or market = any(p_markets))
  group by 1
  order by 1;
$function$;

create or replace function public.fn_customer_insights(p_from timestamptz, p_to timestamptz, p_markets text[] default null)
returns json
language sql stable
set search_path to 'public'
as $function$
  with fx as (
    select coalesce((r->>'usd_egp')::numeric, 48.5) as usd,
           coalesce((r->>'sar_egp')::numeric, 12.95) as sar
    from (select public.fn_fx_rates() as r) x
  ),
  c as (
    select coalesce(o.master_id, o.customer_id) as mid,
      count(*) as n,
      sum(o.total_order_amount * case coalesce(o.currency,'EGP')
        when 'EGP' then 1 when 'USD' then fx.usd when 'SAR' then fx.sar else fx.usd end) as spent
    from public.orders o cross join fx
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

create or replace function public.fn_top_products(p_from timestamptz, p_to timestamptz, p_limit integer default 25, p_markets text[] default null)
returns table(product_name text, sku text, quantity bigint, revenue numeric, unit_weight_kg numeric, weight_kg numeric)
language sql stable
set search_path to 'public'
as $function$
  with fx as (
    select coalesce((r->>'usd_egp')::numeric, 48.5) as usd,
           coalesce((r->>'sar_egp')::numeric, 12.95) as sar
    from (select public.fn_fx_rates() as r) x
  )
  select
    coalesce(i.product_name, '(unknown)') as product_name,
    max(i.sku) as sku,
    sum(coalesce(ps.quantity, 1))::bigint as quantity,
    coalesce(sum(i.price * case coalesce(o.currency,'EGP')
      when 'EGP' then 1 when 'USD' then fx.usd when 'SAR' then fx.sar else fx.usd end), 0) as revenue,
    max(p.weight_kg) as unit_weight_kg,
    round(sum(coalesce(ps.quantity, 1) * p.weight_kg), 2) as weight_kg
  from public.order_items i
  join public.orders o on o.order_number = i.order_number
  cross join fx
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

-- ---------- 4) abandoned carts: cart values in EGP ----------
-- A non-Egyptian cart's value is in the global storefront currency; the
-- factor converts it to EGP everywhere (sums, filters and per-row output).

create or replace function public.fn_abandoned_summary(p_from date default null, p_to date default null, p_markets text[] default null)
returns jsonb
language sql stable
set search_path to 'public'
as $function$
  with fx as (
    select case coalesce(r->>'global_currency', 'USD')
      when 'SAR' then coalesce((r->>'sar_egp')::numeric, 12.95)
      when 'EGP' then 1
      else coalesce((r->>'usd_egp')::numeric, 48.5) end as g
    from (select public.fn_fx_rates() as r) x
  ),
  scoped as (
    select ac.*,
      (case when coalesce(ac.market, 'EG') = 'EG' then 1 else fx.g end) as f
    from public.abandoned_carts ac cross join fx
    where not is_anomaly
      and (p_from is null or created_at >= p_from)
      and (p_to is null or created_at < p_to + interval '1 day')
      and (p_markets is null or cardinality(p_markets) = 0 or market = any(p_markets))
  ),
  base as (
    select cart_value * f as cart_value, phone_norm, email, customer_id, recall_status,
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
    where is_anomaly and (p_markets is null or cardinality(p_markets) = 0)
      and (p_from is null or day >= p_from)
      and (p_to is null or day <= p_to)
  ),
  outcome as (
    select
      count(*) filter (where recall_status = 'recovered') as recovered_carts,
      coalesce(sum(coalesce(recovered_value, cart_value) * f) filter (where recall_status = 'recovered'), 0) as recovered_value,
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

create or replace function public.fn_abandoned_segments(p_from date default null, p_to date default null, p_markets text[] default null)
returns table(segment text, carts bigint, reachable bigint, total_value numeric, recovered bigint)
language sql stable
set search_path to 'public'
as $function$
  with fx as (
    select case coalesce(r->>'global_currency', 'USD')
      when 'SAR' then coalesce((r->>'sar_egp')::numeric, 12.95)
      when 'EGP' then 1
      else coalesce((r->>'usd_egp')::numeric, 48.5) end as g
    from (select public.fn_fx_rates() as r) x
  ),
  base as (
    select ac.*,
      ac.cart_value * (case when coalesce(ac.market, 'EG') = 'EG' then 1 else fx.g end) as cart_value_egp,
      (ac.phone_norm is not null or ac.email is not null) as is_reachable,
      extract(epoch from (now() - ac.created_at)) / 86400.0 as age_days,
      ac.phone_norm in (
        select phone_norm from public.abandoned_carts
        where phone_norm is not null and not is_anomaly
          and recall_status in ('new', 'contacted', 'responded')
        group by phone_norm having count(*) > 1
      ) as is_repeat
    from public.abandoned_carts ac cross join fx
    where not is_anomaly
      and recall_status in ('new', 'contacted', 'responded')
      and (p_from is null or created_at >= p_from)
      and (p_to is null or created_at < p_to + interval '1 day')
      and (p_markets is null or cardinality(p_markets) = 0 or market = any(p_markets))
  )
  select s.segment, s.carts, s.reachable, s.total_value, 0::bigint as recovered
  from (
    select 'hot_0_7' as segment, count(*) as carts, count(*) filter (where is_reachable) as reachable,
           coalesce(sum(cart_value_egp),0) as total_value, 1 as ord
    from base where age_days <= 7
    union all
    select 'warm_8_30', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value_egp),0), 2
    from base where age_days > 7 and age_days <= 30
    union all
    select 'cool_31_90', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value_egp),0), 3
    from base where age_days > 30 and age_days <= 90
    union all
    select 'cold_90p', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value_egp),0), 4
    from base where age_days > 90
    union all
    select 'vip_1000', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value_egp),0), 5
    from base where cart_value_egp >= 1000
    union all
    select 'known_customer', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value_egp),0), 6
    from base where customer_id is not null
    union all
    select 'prospect', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value_egp),0), 7
    from base where is_reachable and customer_id is null
    union all
    select 'repeat_abandoner', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value_egp),0), 8
    from base where is_repeat
    union all
    select 'facebook', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value_egp),0), 9
    from base where traffic_hint = 'facebook'
    union all
    select 'guest_anon', count(*), count(*) filter (where is_reachable), coalesce(sum(cart_value_egp),0), 10
    from base where not is_reachable
  ) s
  order by s.ord
$function$;

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
  full_count bigint, weight_kg numeric, weight_missing integer, market text)
language sql stable
set search_path to 'public'
as $function$
  with fx as (
    select case coalesce(r->>'global_currency', 'USD')
      when 'SAR' then coalesce((r->>'sar_egp')::numeric, 12.95)
      when 'EGP' then 1
      else coalesce((r->>'usd_egp')::numeric, 48.5) end as g
    from (select public.fn_fx_rates() as r) x
  ),
  rep as (
    select phone_norm from public.abandoned_carts
    where phone_norm is not null and not is_anomaly
      and recall_status in ('new', 'contacted', 'responded')
    group by phone_norm having count(*) > 1
  ),
  base as (
    select ac.*,
      (case when coalesce(ac.market, 'EG') = 'EG' then 1 else fx.g end) as f,
      (ac.phone_norm is not null or ac.email is not null) as reachable,
      round((extract(epoch from (now() - ac.created_at)) / 86400.0)::numeric, 1) as age_days_c,
      (ac.phone_norm in (select phone_norm from rep)) as is_repeat_c
    from public.abandoned_carts ac cross join fx
  )
  select
    b.cart_key, b.full_name, b.email, b.phone, b.phone_norm,
    b.products_count, b.skus, round(b.cart_value * b.f, 2) as cart_value,
    b.created_at, b.notified_at, b.web_url,
    b.traffic_hint, b.is_guest, b.customer_id,
    b.recall_status, b.recall_note, b.recalled_at, b.recalled_by,
    b.recovered_order_number, b.recovered_at, round(b.recovered_value * b.f, 2) as recovered_value,
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
    and (p_min_value is null or b.cart_value * b.f >= p_min_value)
    and (p_max_value is null or b.cart_value * b.f <= p_max_value)
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
      when 'vip_1000' then b.cart_value * b.f >= 1000
      when 'reachable' then b.reachable
      when 'known_customer' then b.customer_id is not null
      when 'prospect' then b.reachable and b.customer_id is null
      when 'repeat_abandoner' then coalesce(b.is_repeat_c, false)
      when 'facebook' then b.traffic_hint = 'facebook'
      when 'guest_anon' then not b.reachable
      else true
    end)
  order by
    case when p_order = 'value_desc' then -coalesce(b.cart_value * b.f, 0) end,
    case when p_order = 'value_asc' then coalesce(b.cart_value * b.f, 0) end,
    case when p_order = 'oldest' then extract(epoch from b.created_at) end,
    case when p_order = 'products_desc' then -coalesce(b.products_count, 0) end,
    case when p_order = 'weight_desc' then -coalesce(b.weight_kg, 0) end,
    (b.reachable) desc, b.created_at desc
  limit least(coalesce(p_limit, 50), 1000)
  offset greatest(coalesce(p_offset, 0), 0)
$function$;

create or replace function public.fn_abandoned_trend(p_days integer default 3650, p_from date default null, p_to date default null, p_markets text[] default null)
returns table(day date, lost_value numeric, avg_cart_value numeric, carts bigint, platform_lost numeric)
language sql stable
set search_path to 'public'
as $function$
  with fx as (
    select case coalesce(r->>'global_currency', 'USD')
      when 'SAR' then coalesce((r->>'sar_egp')::numeric, 12.95)
      when 'EGP' then 1
      else coalesce((r->>'usd_egp')::numeric, 48.5) end as g
    from (select public.fn_fx_rates() as r) x
  ),
  real_days as (
    select created_at::date as d, count(*) as n,
      coalesce(sum(cart_value * (case when coalesce(market, 'EG') = 'EG' then 1 else fx.g end)), 0) as v
    from public.abandoned_carts cross join fx
    where not is_anomaly and created_at is not null
      and (p_markets is null or cardinality(p_markets) = 0 or market = any(p_markets))
    group by 1
  )
  select
    coalesce(r.d, ad.day) as day,
    coalesce(r.v, 0) as lost_value,
    case when coalesce(r.n, 0) > 0 then round(r.v / r.n, 2) end as avg_cart_value,
    coalesce(r.n, 0) as carts,
    case when p_markets is not null and cardinality(p_markets) > 0 then null
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

create or replace function public.fn_abandoned_breakdowns(p_from date default null, p_to date default null, p_markets text[] default null)
returns jsonb
language sql stable
set search_path to 'public'
as $function$
  with fx as (
    select case coalesce(r->>'global_currency', 'USD')
      when 'SAR' then coalesce((r->>'sar_egp')::numeric, 12.95)
      when 'EGP' then 1
      else coalesce((r->>'usd_egp')::numeric, 48.5) end as g
    from (select public.fn_fx_rates() as r) x
  ),
  base as (
    select ac.cart_value * (case when coalesce(ac.market, 'EG') = 'EG' then 1 else fx.g end) as cart_value,
      ac.created_at, ac.traffic_hint, ac.market,
      (ac.phone_norm is not null or ac.email is not null) as reachable
    from public.abandoned_carts ac cross join fx
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

create or replace function public.fn_abandoned_repeaters(p_from date default null, p_to date default null, p_limit integer default 50, p_markets text[] default null)
returns table(phone_norm text, full_name text, email text, customer_id text, carts bigint, total_value numeric, last_abandoned timestamptz, recovered bigint, recall_status text, market text)
language sql stable
set search_path to 'public'
as $function$
  with fx as (
    select case coalesce(r->>'global_currency', 'USD')
      when 'SAR' then coalesce((r->>'sar_egp')::numeric, 12.95)
      when 'EGP' then 1
      else coalesce((r->>'usd_egp')::numeric, 48.5) end as g
    from (select public.fn_fx_rates() as r) x
  )
  select
    ac.phone_norm,
    max(ac.full_name) as full_name,
    max(ac.email) as email,
    max(ac.customer_id) as customer_id,
    count(*) as carts,
    coalesce(sum(ac.cart_value * (case when coalesce(ac.market, 'EG') = 'EG' then 1 else fx.g end)), 0) as total_value,
    max(ac.created_at) as last_abandoned,
    0::bigint as recovered,
    max(ac.recall_status) as recall_status,
    max(ac.market) as market
  from public.abandoned_carts ac cross join fx
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
