-- ============================================================
-- Migration 114: book weights → order / abandoned-cart weight.
--
-- The platform FullProductExport carries a `weight` column (kg) for
-- every book. This migration:
--   * products.weight_kg, filled by fn_upsert_products (products file)
--   * orders.weight_kg / weight_missing  = Σ product_sales.quantity ×
--     products.weight_kg (falls back to order_items × 1 when an order
--     has no sales lines); weight_missing = item lines with no known
--     weight so the UI can flag an approximate figure
--   * abandoned_carts.weight_kg / weight_missing = Σ cart items × weight
--     (items matched like fn_abandoned_audience: name + ±1h; falls back
--     to the skus[] array at qty 1)
--   * triggers keep orders current on every product_sales / orders
--     import; fn_upsert_products and fn_abandoned_link recompute the
--     rows they touch, so a re-uploaded products file with corrected
--     weights flows everywhere without a manual step
--   * report RPCs gain weight columns: fn_kpis, fn_report_extras,
--     fn_breakdown, fn_orders_by_day, fn_top_products,
--     fn_top_products_units, fn_abandoned_summary, fn_abandoned_carts_list
--   * orders_with_categories recreated from o.* so it exposes weight_kg
--     AND the attr_* / master_id columns added since migration 037
-- Run after 113_chat_manage.sql
-- ============================================================

alter table public.products add column if not exists weight_kg numeric;
alter table public.orders add column if not exists weight_kg numeric;
alter table public.orders add column if not exists weight_missing integer;
alter table public.abandoned_carts add column if not exists weight_kg numeric;
alter table public.abandoned_carts add column if not exists weight_missing integer;

create index if not exists idx_product_sales_order_sku on public.product_sales (order_id, sku);

-- ------------------------------------------------------------
-- order weights
-- ------------------------------------------------------------
create or replace function public.fn_recompute_order_weights(p_orders text[] default null)
returns integer
language plpgsql
set search_path = public
as $$
declare n integer;
begin
  with lines as (
    -- sales lines carry the real quantity; order_items is one row per
    -- distinct book (qty lost) and only backs orders without sales lines
    select ps.order_id as order_number, ps.sku, coalesce(ps.quantity, 1) as qty
    from public.product_sales ps
    where p_orders is null or ps.order_id = any(p_orders)
    union all
    select oi.order_number, oi.sku, 1
    from public.order_items oi
    where (p_orders is null or oi.order_number = any(p_orders))
      and not exists (select 1 from public.product_sales ps where ps.order_id = oi.order_number)
  ),
  agg as (
    select l.order_number,
      sum(l.qty * p.weight_kg) filter (where p.weight_kg is not null) as w,
      count(*) filter (where p.weight_kg is null) as missing
    from lines l
    left join public.products p on p.sku = l.sku
    group by l.order_number
  )
  update public.orders o
  set weight_kg = round(a.w::numeric, 3),
      weight_missing = a.missing
  from agg a
  where a.order_number = o.order_number
    and (o.weight_kg is distinct from round(a.w::numeric, 3) or o.weight_missing is distinct from a.missing);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.fn_recompute_order_weights(text[]) from public, anon;

-- product_sales import → recompute the touched orders
create or replace function public.trg_product_sales_weights()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_orders text[];
begin
  select array_agg(distinct order_id) into v_orders from new_rows;
  if v_orders is not null then
    perform public.fn_recompute_order_weights(v_orders);
  end if;
  return null;
end;
$$;

drop trigger if exists product_sales_weights_ins on public.product_sales;
create trigger product_sales_weights_ins
  after insert on public.product_sales
  referencing new table as new_rows
  for each statement execute function public.trg_product_sales_weights();

drop trigger if exists product_sales_weights_upd on public.product_sales;
create trigger product_sales_weights_upd
  after update on public.product_sales
  referencing new table as new_rows
  for each statement execute function public.trg_product_sales_weights();

-- orders import → orders inserted after their sales lines get a weight too
create or replace function public.trg_orders_weights()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_orders text[];
begin
  select array_agg(order_number) into v_orders from new_rows where weight_kg is null;
  if v_orders is not null then
    perform public.fn_recompute_order_weights(v_orders);
  end if;
  return null;
end;
$$;

drop trigger if exists orders_weights_ins on public.orders;
create trigger orders_weights_ins
  after insert on public.orders
  referencing new table as new_rows
  for each statement execute function public.trg_orders_weights();

-- ------------------------------------------------------------
-- abandoned cart weights
-- ------------------------------------------------------------
create or replace function public.fn_recompute_cart_weights(p_keys text[] default null)
returns integer
language plpgsql
set search_path = public
as $$
declare n integer;
begin
  with carts as (
    select cart_key, full_name, created_at, skus
    from public.abandoned_carts
    where p_keys is null or cart_key = any(p_keys)
  ),
  item_lines as (
    select c.cart_key, i.sku, coalesce(i.qty, 1) as qty
    from carts c
    join public.abandoned_cart_items i
      on i.cart_name = c.full_name
     and i.created_at between c.created_at - interval '1 hour' and c.created_at + interval '1 hour'
  ),
  lines as (
    select * from item_lines
    union all
    -- carts with no matched item rows: the skus[] array, one each
    select c.cart_key, s.sku, 1
    from carts c
    cross join lateral unnest(coalesce(c.skus, '{}'::text[])) as s(sku)
    where not exists (select 1 from item_lines il where il.cart_key = c.cart_key)
  ),
  agg as (
    select l.cart_key,
      sum(l.qty * p.weight_kg) filter (where p.weight_kg is not null) as w,
      count(*) filter (where p.weight_kg is null) as missing
    from lines l
    left join public.products p on p.sku = l.sku
    group by l.cart_key
  )
  update public.abandoned_carts ac
  set weight_kg = round(a.w::numeric, 3),
      weight_missing = a.missing
  from agg a
  where a.cart_key = ac.cart_key
    and (ac.weight_kg is distinct from round(a.w::numeric, 3) or ac.weight_missing is distinct from a.missing);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.fn_recompute_cart_weights(text[]) from public, anon;

-- ------------------------------------------------------------
-- fn_upsert_products: accept weight_kg, then refresh weights of every
-- order / cart that contains a book from this batch
-- ------------------------------------------------------------
create or replace function public.fn_upsert_products(p_rows jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
  v_skus text[];
  v_orders text[];
  v_carts text[];
begin
  if (select public.my_role()) not in ('admin', 'manager') then
    raise exception 'Forbidden';
  end if;

  insert into public.products (
    sku, name, english_name, price, stock, stock_qty, section, category,
    language, age, series, publisher, author, other_authors, translated_from,
    book_type, cover_type, paper_type, pages, dimensions, semester,
    link, release_date, description, image, barcode, vendor, attributes, weight_kg, updated_at
  )
  select
    r->>'sku',
    nullif(r->>'name', ''),
    nullif(r->>'english_name', ''),
    nullif(regexp_replace(coalesce(r->>'price', ''), '[^0-9.\-]', '', 'g'), '')::numeric,
    nullif(r->>'stock', ''),
    nullif(r->>'stock_qty', '')::integer,
    nullif(r->>'section', ''),
    nullif(r->>'category', ''),
    nullif(r->>'language', ''),
    nullif(r->>'age', ''),
    nullif(r->>'series', ''),
    nullif(r->>'publisher', ''),
    nullif(r->>'author', ''),
    nullif(r->>'other_authors', ''),
    nullif(r->>'translated_from', ''),
    nullif(r->>'book_type', ''),
    nullif(r->>'cover_type', ''),
    nullif(r->>'paper_type', ''),
    nullif(r->>'pages', ''),
    nullif(r->>'dimensions', ''),
    nullif(r->>'semester', ''),
    nullif(r->>'link', ''),
    nullif(r->>'release_date', ''),
    nullif(r->>'description', ''),
    nullif(r->>'image', ''),
    nullif(r->>'barcode', ''),
    nullif(r->>'vendor', ''),
    coalesce(r->'attributes', '{}'::jsonb),
    nullif(regexp_replace(coalesce(r->>'weight_kg', ''), '[^0-9.]', '', 'g'), '')::numeric,
    now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'sku', '') <> ''
  on conflict (sku) do update set
    name = coalesce(excluded.name, products.name),
    english_name = coalesce(excluded.english_name, products.english_name),
    price = coalesce(excluded.price, products.price),
    stock = coalesce(excluded.stock, products.stock),
    stock_qty = coalesce(excluded.stock_qty, products.stock_qty),
    section = coalesce(excluded.section, products.section),
    category = coalesce(excluded.category, products.category),
    language = coalesce(excluded.language, products.language),
    age = coalesce(excluded.age, products.age),
    series = coalesce(excluded.series, products.series),
    publisher = coalesce(excluded.publisher, products.publisher),
    author = coalesce(excluded.author, products.author),
    other_authors = coalesce(excluded.other_authors, products.other_authors),
    translated_from = coalesce(excluded.translated_from, products.translated_from),
    book_type = coalesce(excluded.book_type, products.book_type),
    cover_type = coalesce(excluded.cover_type, products.cover_type),
    paper_type = coalesce(excluded.paper_type, products.paper_type),
    pages = coalesce(excluded.pages, products.pages),
    dimensions = coalesce(excluded.dimensions, products.dimensions),
    semester = coalesce(excluded.semester, products.semester),
    link = coalesce(excluded.link, products.link),
    release_date = coalesce(excluded.release_date, products.release_date),
    description = coalesce(excluded.description, products.description),
    image = coalesce(excluded.image, products.image),
    barcode = coalesce(excluded.barcode, products.barcode),
    vendor = coalesce(excluded.vendor, products.vendor),
    attributes = products.attributes || excluded.attributes,
    -- a corrected weight in a newer export must win over the old value
    weight_kg = coalesce(excluded.weight_kg, products.weight_kg),
    updated_at = now();

  get diagnostics n = row_count;

  -- weights may have changed for these SKUs → refresh dependents
  select array_agg(distinct r->>'sku') into v_skus
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'weight_kg', '') <> '';

  if v_skus is not null then
    select array_agg(distinct order_id) into v_orders
    from public.product_sales where sku = any(v_skus);
    if v_orders is not null then
      perform public.fn_recompute_order_weights(v_orders);
    end if;

    select array_agg(distinct ac.cart_key) into v_carts
    from public.abandoned_carts ac
    where ac.skus && v_skus;
    if v_carts is not null then
      perform public.fn_recompute_cart_weights(v_carts);
    end if;
  end if;

  return n;
end;
$$;

-- ------------------------------------------------------------
-- fn_abandoned_link: runs after every carts/items import → weights too
-- ------------------------------------------------------------
create or replace function public.fn_abandoned_link()
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_customers integer := 0;
  v_emails integer := 0;
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

  -- new / re-uploaded carts and items → cart weights
  v_weights := public.fn_recompute_cart_weights(null);

  return jsonb_build_object(
    'matched_by_phone', v_customers,
    'matched_by_email', v_emails,
    'auto_recovered', v_recovered,
    'anomalies_flagged', v_anomalies,
    'weights_updated', v_weights
  );
end;
$$;

-- ------------------------------------------------------------
-- orders_with_categories: rebuild from o.* (picks up weight_kg and the
-- attr_* / master_id / tx_key columns the frozen 037 column list lacked)
-- ------------------------------------------------------------
drop view if exists public.orders_with_categories;
create view public.orders_with_categories
with (security_invoker = true) as
select
  o.*,
  (select array_agg(distinct ps.category)
     from public.product_sales ps
    where ps.order_id = o.order_number
      and ps.category is not null) as categories,
  (select array_agg(distinct ps.sub_category)
     from public.product_sales ps
    where ps.order_id = o.order_number
      and ps.sub_category is not null) as sub_categories,
  (select array_agg(distinct ps.brand)
     from public.product_sales ps
    where ps.order_id = o.order_number
      and ps.brand is not null) as brands
from public.orders o;

-- ------------------------------------------------------------
-- report RPCs
-- ------------------------------------------------------------
create or replace function public.fn_kpis(p_from timestamptz, p_to timestamptz)
returns json
language sql stable set search_path = public
as $$
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
    -- shipping weight: all orders / excluding cancelled+returned / per order
    'total_weight_kg', coalesce(sum(weight_kg), 0),
    'net_weight_kg', coalesce(sum(weight_kg) filter (where order_status not in ('Cancelled', 'Returned', 'Return Sent To Erp')), 0),
    'avg_weight_kg', avg(weight_kg),
    'weighed_orders', count(weight_kg)
  )
  from public.orders
  where (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < p_to);
$$;

create or replace function public.fn_report_extras(p_from timestamptz, p_to timestamptz)
returns json
language sql stable set search_path = public
as $$
  select json_build_object(
    'total_units', (
      select coalesce(sum(quantity), 0) from public.product_sales
      where coalesce(status, '') <> 'Cancelled'
        and (p_from is null or order_date >= p_from)
        and (p_to is null or order_date < p_to)
    ),
    'distinct_products', (
      select count(distinct sku) from public.product_sales
      where coalesce(status, '') <> 'Cancelled'
        and (p_from is null or order_date >= p_from)
        and (p_to is null or order_date < p_to)
    ),
    'product_orders', (
      select count(distinct order_id) from public.product_sales
      where coalesce(status, '') <> 'Cancelled'
        and (p_from is null or order_date >= p_from)
        and (p_to is null or order_date < p_to)
    ),
    'shipping_fees', (
      select coalesce(sum(actual_delivery_fees), 0) from public.orders
      where order_status <> 'Cancelled'
        and (p_from is null or order_date >= p_from)
        and (p_to is null or order_date < p_to)
    ),
    'promo_discount', (
      select coalesce(sum(abs(promo_amount)), 0) from public.orders
      where order_status <> 'Cancelled'
        and (p_from is null or order_date >= p_from)
        and (p_to is null or order_date < p_to)
    ),
    'loyalty_discount', (
      select coalesce(sum(loyalty_discount), 0) from public.orders
      where order_status <> 'Cancelled'
        and (p_from is null or order_date >= p_from)
        and (p_to is null or order_date < p_to)
    ),
    'new_customers', (
      select count(*) from public.customers
      where (p_from is null or joined_at >= p_from)
        and (p_to is null or joined_at < p_to)
    ),
    'rated_orders', (
      select count(*) from public.orders
      where customer_rating is not null
        and (p_from is null or order_date >= p_from)
        and (p_to is null or order_date < p_to)
    ),
    -- shipped weight (non-cancelled), average per order, and how many
    -- orders still contain a book with no known weight
    'total_weight_kg', (
      select coalesce(sum(weight_kg), 0) from public.orders
      where order_status <> 'Cancelled'
        and (p_from is null or order_date >= p_from)
        and (p_to is null or order_date < p_to)
    ),
    'avg_weight_kg', (
      select avg(weight_kg) from public.orders
      where order_status <> 'Cancelled'
        and (p_from is null or order_date >= p_from)
        and (p_to is null or order_date < p_to)
    ),
    'weight_incomplete_orders', (
      select count(*) from public.orders
      where coalesce(weight_missing, 0) > 0
        and (p_from is null or order_date >= p_from)
        and (p_to is null or order_date < p_to)
    )
  );
$$;

drop function if exists public.fn_breakdown(text, timestamptz, timestamptz, integer);
create function public.fn_breakdown(p_dim text, p_from timestamptz, p_to timestamptz, p_limit integer default 30)
returns table(label text, orders bigint, revenue numeric, delivered bigint, cancelled_or_returned bigint, weight_kg numeric)
language sql stable set search_path = public
as $$
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
    end), ''), '(none)') as label,
    count(*) as orders,
    coalesce(sum(total_order_amount), 0) as revenue,
    count(*) filter (where order_status = 'Delivered') as delivered,
    count(*) filter (where order_status in ('Cancelled', 'Returned', 'Return Sent To Erp', 'Return Request')) as cancelled_or_returned,
    round(coalesce(sum(o.weight_kg), 0), 2) as weight_kg
  from public.orders o
  where (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < p_to)
  group by 1
  order by 2 desc
  limit p_limit;
$$;
revoke execute on function public.fn_breakdown(text, timestamptz, timestamptz, integer) from public, anon;

drop function if exists public.fn_orders_by_day(timestamptz, timestamptz);
create function public.fn_orders_by_day(p_from timestamptz, p_to timestamptz)
returns table(day date, orders bigint, revenue numeric, delivered bigint, cancelled bigint, weight_kg numeric)
language sql stable set search_path = public
as $$
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
  group by 1
  order by 1;
$$;
revoke execute on function public.fn_orders_by_day(timestamptz, timestamptz) from public, anon;

drop function if exists public.fn_top_products(timestamptz, timestamptz, integer);
create function public.fn_top_products(p_from timestamptz, p_to timestamptz, p_limit integer default 25)
returns table(product_name text, sku text, quantity bigint, revenue numeric, unit_weight_kg numeric, weight_kg numeric)
language sql stable set search_path = public
as $$
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
    and o.order_status not in ('Cancelled')
  group by 1
  order by 3 desc
  limit p_limit;
$$;
revoke execute on function public.fn_top_products(timestamptz, timestamptz, integer) from public, anon;

drop function if exists public.fn_top_products_units(timestamptz, timestamptz, integer);
create function public.fn_top_products_units(p_from timestamptz, p_to timestamptz, p_limit integer default 25)
returns table(sku text, product_name text, category text, units numeric, orders bigint, revenue numeric, unit_weight_kg numeric, weight_kg numeric)
language sql stable set search_path = public
as $$
  select
    ps.sku,
    mode() within group (order by ps.product_name) as product_name,
    mode() within group (order by ps.category) as category,
    coalesce(sum(ps.quantity), 0) as units,
    count(distinct ps.order_id) as orders,
    coalesce(sum(coalesce(ps.price_after_discount, ps.price)), 0) as revenue,
    max(p.weight_kg) as unit_weight_kg,
    round(sum(coalesce(ps.quantity, 1) * p.weight_kg), 2) as weight_kg
  from public.product_sales ps
  left join public.products p on p.sku = ps.sku
  where coalesce(ps.status, '') <> 'Cancelled'
    and (p_from is null or ps.order_date >= p_from)
    and (p_to is null or ps.order_date < p_to)
  group by ps.sku
  order by units desc
  limit p_limit;
$$;
revoke execute on function public.fn_top_products_units(timestamptz, timestamptz, integer) from public, anon;

-- abandoned: summary gains weight totals; the list gains a per-cart column
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
$$;

drop function if exists public.fn_abandoned_carts_list(text, text[], text, text[], numeric, numeric, text, date, date, integer, integer);
create function public.fn_abandoned_carts_list(
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
returns table(
  cart_key text, full_name text, email text, phone text, phone_norm text,
  products_count integer, skus text[], cart_value numeric,
  created_at timestamptz, notified_at timestamptz, web_url text,
  traffic_hint text, is_guest boolean, customer_id text,
  recall_status text, recall_note text, recalled_at timestamptz, recalled_by text,
  recovered_order_number text, recovered_at timestamptz, recovered_value numeric,
  age_days numeric, is_repeat boolean, is_anomaly boolean, anomaly_reason text,
  customer_name text, customer_city text, lifetime_orders integer, lifetime_delivered_amount numeric,
  full_count bigint,
  weight_kg numeric, weight_missing integer
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
    count(*) over () as full_count,
    b.weight_kg, b.weight_missing
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
    case when p_order = 'weight_desc' then -coalesce(b.weight_kg, 0) end,
    (b.reachable) desc, b.created_at desc
  limit least(coalesce(p_limit, 50), 1000)
  offset greatest(coalesce(p_offset, 0), 0)
$$;
revoke execute on function public.fn_abandoned_carts_list(text, text[], text, text[], numeric, numeric, text, date, date, integer, integer) from public, anon;

-- daily sales table (Reports → Daily sales) also carries the day's weight
drop function if exists public.fn_sales_by_day(timestamptz, timestamptz);
create function public.fn_sales_by_day(p_from timestamptz, p_to timestamptz)
returns table(day date, orders bigint, items_amount numeric, delivery_fees numeric, promo_discount numeric, grand_total numeric, weight_kg numeric)
language sql stable set search_path = public
as $$
  select
    date_trunc('day', order_date)::date as day,
    count(*) as orders,
    coalesce(sum(total_cart_amount), 0) as items_amount,
    coalesce(sum(actual_delivery_fees), 0) as delivery_fees,
    coalesce(sum(abs(promo_amount)), 0) as promo_discount,
    coalesce(sum(total_order_amount), 0) as grand_total,
    round(coalesce(sum(o.weight_kg), 0), 2) as weight_kg
  from public.orders o
  where order_date is not null
    and order_status <> 'Cancelled'
    and (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < p_to)
  group by 1
  order by 1 desc;
$$;
revoke execute on function public.fn_sales_by_day(timestamptz, timestamptz) from public, anon;
