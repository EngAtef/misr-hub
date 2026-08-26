-- 119_usd_prices.sql — global storefront USD price list.
--
-- The platform's global site charges USD (confirmed: the SAP price-list
-- export for ship-to 300000045 matches order 24527's unit prices exactly).
-- products.price_usd stores it (survives FullProductExport re-uploads —
-- fn_upsert_products has an explicit column list). Foreign abandoned carts
-- often arrive with no cart_value; est_value_usd = Σ price_usd of the
-- cart's SKUs gives a floor estimate the abandoned RPCs fall back to.

alter table public.products add column if not exists price_usd numeric;
alter table public.abandoned_carts add column if not exists est_value_usd numeric;

-- Data Center "USD prices" card upsert: [{sku, usd}]. Update-only — a SKU
-- absent from products is reported back, not invented.
create or replace function public.fn_upsert_usd_prices(p_rows jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_updated integer := 0;
  v_missing integer := 0;
begin
  if public.my_role() not in ('admin', 'manager') then
    raise exception 'Forbidden';
  end if;

  with rows as (
    select r->>'sku' as sku,
           nullif(regexp_replace(coalesce(r->>'usd', ''), '[^0-9.]', '', 'g'), '')::numeric as usd
    from jsonb_array_elements(p_rows) r
    where coalesce(r->>'sku', '') <> ''
  ),
  upd as (
    update public.products p
    set price_usd = rows.usd, updated_at = now()
    from rows
    where p.sku = rows.sku and rows.usd is not null
      and p.price_usd is distinct from rows.usd
    returning p.sku
  )
  select count(*) into v_updated from upd;

  select count(*) into v_missing
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'sku', '') <> ''
    and not exists (select 1 from public.products p where p.sku = r->>'sku');

  -- refresh the foreign-cart value estimates with the new prices
  update public.abandoned_carts ac
  set est_value_usd = est.v
  from (
    select ac2.cart_key, sum(p.price_usd) as v
    from public.abandoned_carts ac2
    cross join lateral unnest(coalesce(ac2.skus, '{}'::text[])) s(sku)
    join public.products p on p.sku = s.sku and p.price_usd is not null
    where coalesce(ac2.market, 'EG') <> 'EG'
    group by 1
  ) est
  where est.cart_key = ac.cart_key and ac.est_value_usd is distinct from est.v;

  return jsonb_build_object('updated', v_updated, 'missing', v_missing);
end $$;
revoke execute on function public.fn_upsert_usd_prices(jsonb) from anon, public;
grant execute on function public.fn_upsert_usd_prices(jsonb) to authenticated;

-- fn_abandoned_link also refreshes estimates (new carts arrive after import)
create or replace function public.fn_abandoned_estimate_values()
returns integer
language plpgsql
set search_path to 'public'
as $$
declare n integer;
begin
  update public.abandoned_carts ac
  set est_value_usd = est.v
  from (
    select ac2.cart_key, sum(p.price_usd) as v
    from public.abandoned_carts ac2
    cross join lateral unnest(coalesce(ac2.skus, '{}'::text[])) s(sku)
    join public.products p on p.sku = s.sku and p.price_usd is not null
    where coalesce(ac2.market, 'EG') <> 'EG'
    group by 1
  ) est
  where est.cart_key = ac.cart_key and ac.est_value_usd is distinct from est.v;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.fn_abandoned_estimate_values() from anon, public;

-- fn_abandoned_link refreshes estimates on every cart import
do $patch$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fn_abandoned_link';
  if src is not null and position('fn_abandoned_estimate_values' in src) = 0 then
    src := replace(src,
      'v_weights := public.fn_recompute_cart_weights(null);',
      E'perform public.fn_abandoned_estimate_values();\n\n  v_weights := public.fn_recompute_cart_weights(null);');
    execute src;
  end if;
end $patch$;

-- fn_catalog_products gains price_usd (Products page column)
drop function if exists public.fn_catalog_products(timestamptz, timestamptz, text, text, text, text, integer, integer);
create function public.fn_catalog_products(
  p_from timestamptz default null, p_to timestamptz default null,
  p_search text default null, p_scope text default 'all',
  p_sort text default 'units', p_dir text default 'desc',
  p_limit integer default 100, p_offset integer default 0)
returns table(
  sku text, product_name text, category text, vendor text,
  ecom_stock integer, sap_stock integer, price numeric, image text,
  author text, publisher text, language text, age text, series text, barcode text,
  units bigint, orders bigint, revenue numeric,
  lifetime_units bigint, lifetime_orders bigint, lifetime_revenue numeric,
  first_order_date timestamptz, last_order_date timestamptz,
  total_count bigint, unit_weight_kg numeric, weight_kg numeric, lifetime_weight_kg numeric,
  price_usd numeric)
language sql stable
set search_path to 'public'
as $function$
  with life as (
    select
      coalesce(nullif(i.sku, ''), '(no sku)') as sku,
      mode() within group (order by i.product_name) as product_name,
      sum(coalesce(ps.quantity, 1))::bigint as l_units,
      count(distinct i.order_number)::bigint as l_orders,
      coalesce(sum(i.price), 0) as l_revenue,
      min(o.order_date) as first_order_date,
      max(o.order_date) as last_order_date,
      coalesce(sum(coalesce(ps.quantity, 1)) filter (
        where (p_from is null or o.order_date >= p_from)
          and (p_to is null or o.order_date < p_to)
      ), 0)::bigint as r_units,
      count(distinct i.order_number) filter (
        where (p_from is null or o.order_date >= p_from)
          and (p_to is null or o.order_date < p_to)
      )::bigint as r_orders,
      coalesce(sum(i.price) filter (
        where (p_from is null or o.order_date >= p_from)
          and (p_to is null or o.order_date < p_to)
      ), 0) as r_revenue
    from public.order_items i
    join public.orders o on o.order_number = i.order_number
    left join public.product_sales ps on ps.order_id = i.order_number and ps.sku = i.sku and ps.quantity is not null and ps.quantity <> 1
    where o.order_status not in ('Cancelled')
    group by 1
  ),
  universe as (
    select s.sku from public.stock_items s
    union
    select p.sku from public.products p
    union
    select l.sku from life l
  ),
  joined as (
    select
      u.sku,
      coalesce(nullif(p.name, ''), nullif(s.product_name, ''), l.product_name, u.sku) as product_name,
      coalesce(s.category, p.section) as category,
      coalesce(s.vendor, p.vendor, p.publisher) as vendor,
      coalesce(s.ecom_stock, p.stock_qty) as ecom_stock,
      s.sap_stock,
      p.price, p.image, p.author, p.publisher, p.language, p.age, p.series, p.barcode,
      p.price_usd,
      coalesce(l.r_units, 0)::bigint as units,
      coalesce(l.r_orders, 0)::bigint as orders,
      coalesce(l.r_revenue, 0) as revenue,
      coalesce(l.l_units, 0)::bigint as lifetime_units,
      coalesce(l.l_orders, 0)::bigint as lifetime_orders,
      coalesce(l.l_revenue, 0) as lifetime_revenue,
      l.first_order_date,
      l.last_order_date,
      p.weight_kg as unit_weight_kg,
      round(coalesce(l.r_units, 0) * p.weight_kg, 2) as weight_kg,
      round(coalesce(l.l_units, 0) * p.weight_kg, 2) as lifetime_weight_kg
    from universe u
    left join public.stock_items s on s.sku = u.sku
    left join public.products p on p.sku = u.sku
    left join life l on l.sku = u.sku
  ),
  filtered as (
    select * from joined j
    where (
        p_search is null or p_search = ''
        or j.product_name ilike '%' || p_search || '%'
        or j.sku ilike '%' || p_search || '%'
        or j.author ilike '%' || p_search || '%'
        or j.publisher ilike '%' || p_search || '%'
        or j.series ilike '%' || p_search || '%'
        or j.barcode ilike '%' || p_search || '%'
      )
      and case lower(coalesce(p_scope, 'all'))
            when 'sold' then j.units > 0
            when 'unsold' then j.units = 0
            when 'never' then j.lifetime_units = 0
            when 'ever' then j.lifetime_units > 0
            when 'oos' then coalesce(j.ecom_stock, 0) <= 0
            when 'instock' then coalesce(j.ecom_stock, 0) > 0
            when 'global' then j.price_usd is not null
            when 'not_global' then j.price_usd is null
            else true
          end
  )
  select
    f.sku, f.product_name, f.category, f.vendor, f.ecom_stock, f.sap_stock,
    f.price, f.image, f.author, f.publisher, f.language, f.age, f.series, f.barcode,
    f.units, f.orders, f.revenue,
    f.lifetime_units, f.lifetime_orders, f.lifetime_revenue,
    f.first_order_date, f.last_order_date,
    count(*) over ()::bigint as total_count,
    f.unit_weight_kg, f.weight_kg, f.lifetime_weight_kg,
    f.price_usd
  from filtered f
  order by
    case when lower(coalesce(p_sort, 'units')) = 'name' and lower(coalesce(p_dir, 'desc')) = 'asc' then f.product_name end asc nulls last,
    case when lower(coalesce(p_sort, 'units')) = 'name' and lower(coalesce(p_dir, 'desc')) <> 'asc' then f.product_name end desc nulls last,
    case when lower(coalesce(p_sort, 'units')) = 'sku' and lower(coalesce(p_dir, 'desc')) = 'asc' then f.sku end asc nulls last,
    case when lower(coalesce(p_sort, 'units')) = 'sku' and lower(coalesce(p_dir, 'desc')) <> 'asc' then f.sku end desc nulls last,
    (case when lower(coalesce(p_dir, 'desc')) = 'asc' then 1 else -1 end) *
    (case lower(coalesce(p_sort, 'units'))
       when 'orders' then f.orders::numeric
       when 'revenue' then f.revenue
       when 'lifetime_units' then f.lifetime_units::numeric
       when 'lifetime_orders' then f.lifetime_orders::numeric
       when 'lifetime_revenue' then f.lifetime_revenue
       when 'stock' then coalesce(f.ecom_stock, 0)::numeric
       when 'price' then coalesce(f.price, 0)
       when 'price_usd' then coalesce(f.price_usd, 0)
       when 'last_sale' then coalesce(extract(epoch from f.last_order_date), 0)::numeric
       when 'unit_weight' then coalesce(f.unit_weight_kg, 0)
       when 'weight' then coalesce(f.weight_kg, 0)
       when 'lifetime_weight' then coalesce(f.lifetime_weight_kg, 0)
       else f.units::numeric
     end) asc nulls last,
    f.sku asc
  limit greatest(coalesce(p_limit, 100), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

-- Abandoned RPCs fall back to the USD estimate when a foreign cart has no
-- platform value (shown with a "~" prefix in the UI via value_estimated).
drop function if exists public.fn_abandoned_carts_list(text, text[], text, text[], numeric, numeric, text, date, date, integer, integer, text[]);
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
  full_count bigint, weight_kg numeric, weight_missing integer, market text,
  value_estimated boolean)
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
      coalesce(ac.cart_value, case when coalesce(ac.market, 'EG') <> 'EG' then ac.est_value_usd end) as val_c,
      (ac.cart_value is null and coalesce(ac.market, 'EG') <> 'EG' and ac.est_value_usd is not null) as est_c,
      (ac.phone_norm is not null or ac.email is not null) as reachable,
      round((extract(epoch from (now() - ac.created_at)) / 86400.0)::numeric, 1) as age_days_c,
      (ac.phone_norm in (select phone_norm from rep)) as is_repeat_c
    from public.abandoned_carts ac cross join fx
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
    count(*) over () as full_count,
    b.weight_kg, b.weight_missing, b.market,
    b.est_c as value_estimated
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
$function$;

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
      (case when coalesce(ac.market, 'EG') = 'EG' then 1 else fx.g end) as f,
      coalesce(ac.cart_value, case when coalesce(ac.market, 'EG') <> 'EG' then ac.est_value_usd end) as val
    from public.abandoned_carts ac cross join fx
    where not is_anomaly
      and (p_from is null or created_at >= p_from)
      and (p_to is null or created_at < p_to + interval '1 day')
      and (p_markets is null or cardinality(p_markets) = 0 or market = any(p_markets))
  ),
  base as (
    select val * f as cart_value, phone_norm, email, customer_id, recall_status,
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
      coalesce(sum(coalesce(recovered_value, val) * f) filter (where recall_status = 'recovered'), 0) as recovered_value,
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
