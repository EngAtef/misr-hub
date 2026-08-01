-- ============================================================
-- Migration 054: report hub functions.
-- Powers the rebuilt Reports page: extra KPIs (units, shipping
-- fees, discounts), rating donuts, daily sales table, order
-- fulfillment times, promo-code performance, newly registered
-- customers, out-of-stock sellers and order time patterns.
-- Run after 053_vendor_orders_export.sql
-- ============================================================

-- Extra KPI counters that fn_kpis / fn_customer_insights lack.
-- Revenue conventions follow fn_kpis: gross = all statuses,
-- money actually kept excludes 'Cancelled'.
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
    -- promo_amount arrives negative in newer exports, positive in older
    -- ones; the discount magnitude is abs() either way.
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
    )
  );
$$;

-- 1..5 star distribution for customer + driver ratings.
create or replace function public.fn_rating_breakdown(p_from timestamptz, p_to timestamptz)
returns table (kind text, rating integer, orders bigint)
language sql stable set search_path = public
as $$
  select 'customer'::text as kind, customer_rating::integer as rating, count(*) as orders
  from public.orders
  where customer_rating between 1 and 5
    and (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < p_to)
  group by 2
  union all
  select 'driver', driver_rating::integer, count(*)
  from public.orders
  where driver_rating between 1 and 5
    and (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < p_to)
  group by 2
  order by 1, 2 desc;
$$;

-- Daily sales ledger (newest first): goods amount, delivery fees,
-- promo discount and the grand total actually invoiced.
create or replace function public.fn_sales_by_day(p_from timestamptz, p_to timestamptz)
returns table (
  day date, orders bigint, items_amount numeric, delivery_fees numeric,
  promo_discount numeric, grand_total numeric
)
language sql stable set search_path = public
as $$
  select
    date_trunc('day', order_date)::date as day,
    count(*) as orders,
    coalesce(sum(total_cart_amount), 0) as items_amount,
    coalesce(sum(actual_delivery_fees), 0) as delivery_fees,
    coalesce(sum(abs(promo_amount)), 0) as promo_discount,
    coalesce(sum(total_order_amount), 0) as grand_total
  from public.orders
  where order_date is not null
    and order_status <> 'Cancelled'
    and (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < p_to)
  group by 1
  order by 1 desc;
$$;

-- Delivered orders with their fulfillment time in hours (newest first).
create or replace function public.fn_fulfillment_orders(p_from timestamptz, p_to timestamptz, p_limit integer default 200)
returns table (
  order_number text, customer_name text, city text,
  order_date timestamptz, delivery_date timestamptz, hours numeric
)
language sql stable set search_path = public
as $$
  select
    order_number, customer_name, city, order_date, delivery_date,
    round((extract(epoch from (delivery_date - order_date)) / 3600.0)::numeric, 1) as hours
  from public.orders
  where delivery_date is not null and order_date is not null
    and delivery_date >= order_date
    and (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < p_to)
  order by order_date desc
  limit p_limit;
$$;

-- Promo codes used within the range, with the revenue they carried
-- and the discount they cost. orders.applied_offer = promo_codes.name.
create or replace function public.fn_promo_performance(p_from timestamptz, p_to timestamptz, p_limit integer default 100)
returns table (
  id bigint, name text, type integer, amount numeric, active boolean,
  expiration_date timestamptz, uses_in_range bigint, orders_value numeric,
  discount_given numeric, delivered_orders bigint
)
language sql stable set search_path = public
as $$
  select
    pc.id, pc.name, pc.type, pc.amount, pc.active, pc.expiration_date,
    count(o.order_number) as uses_in_range,
    coalesce(sum(o.total_order_amount), 0) as orders_value,
    coalesce(sum(abs(o.promo_amount)), 0) as discount_given,
    count(o.order_number) filter (where o.order_status = 'Delivered') as delivered_orders
  from public.promo_codes pc
  join public.orders o
    on o.applied_offer = pc.name
   and o.order_status <> 'Cancelled'
   and (p_from is null or o.order_date >= p_from)
   and (p_to is null or o.order_date < p_to)
  group by pc.id, pc.name, pc.type, pc.amount, pc.active, pc.expiration_date
  order by orders_value desc
  limit p_limit;
$$;

-- Customers who registered within the range (newest first).
create or replace function public.fn_new_customers(p_from timestamptz, p_to timestamptz, p_limit integer default 100)
returns table (
  customer_id text, name text, email text, phone text, city text,
  joined_at timestamptz, is_active boolean, lifetime_orders integer,
  lifetime_amount numeric
)
language sql stable set search_path = public
as $$
  select
    customer_id, name, email, phone, city, joined_at, is_active,
    coalesce(lifetime_orders, 0) as lifetime_orders,
    coalesce(lifetime_amount, 0) as lifetime_amount
  from public.customers
  where joined_at is not null
    and (p_from is null or joined_at >= p_from)
    and (p_to is null or joined_at < p_to)
  order by joined_at desc
  limit p_limit;
$$;

-- Products that sold in the range but currently show no e-commerce
-- stock — the "restock these first" report.
create or replace function public.fn_out_of_stock_sellers(p_from timestamptz, p_to timestamptz, p_limit integer default 100)
returns table (
  sku text, product_name text, ecom_stock integer, sap_stock integer,
  units numeric, revenue numeric
)
language sql stable set search_path = public
as $$
  select
    ps.sku,
    mode() within group (order by ps.product_name) as product_name,
    coalesce(max(si.ecom_stock), 0) as ecom_stock,
    coalesce(max(si.sap_stock), 0) as sap_stock,
    coalesce(sum(ps.quantity), 0) as units,
    coalesce(sum(ps.price_after_discount), coalesce(sum(ps.price), 0)) as revenue
  from public.product_sales ps
  left join public.stock_items si on si.sku = ps.sku
  where coalesce(ps.status, '') <> 'Cancelled'
    and (p_from is null or ps.order_date >= p_from)
    and (p_to is null or ps.order_date < p_to)
  group by ps.sku
  having coalesce(max(si.ecom_stock), 0) <= 0
  order by units desc
  limit p_limit;
$$;

-- Top products by real units sold (product_sales carries true
-- quantities; order_items counts lines only).
create or replace function public.fn_top_products_units(p_from timestamptz, p_to timestamptz, p_limit integer default 25)
returns table (
  sku text, product_name text, category text, units numeric,
  orders bigint, revenue numeric
)
language sql stable set search_path = public
as $$
  select
    ps.sku,
    mode() within group (order by ps.product_name) as product_name,
    mode() within group (order by ps.category) as category,
    coalesce(sum(ps.quantity), 0) as units,
    count(distinct ps.order_id) as orders,
    coalesce(sum(coalesce(ps.price_after_discount, ps.price)), 0) as revenue
  from public.product_sales ps
  where coalesce(ps.status, '') <> 'Cancelled'
    and (p_from is null or ps.order_date >= p_from)
    and (p_to is null or ps.order_date < p_to)
  group by ps.sku
  order by units desc
  limit p_limit;
$$;

-- When do customers order: distribution by hour of day and weekday.
-- order_date holds Egypt wall-clock time stored as UTC, so extract
-- directly without timezone conversion (same convention as formatDate).
create or replace function public.fn_orders_time_patterns(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'by_hour', (
      select coalesce(jsonb_agg(jsonb_build_object('hour', h.hour, 'orders', h.orders, 'revenue', h.revenue) order by h.hour), '[]'::jsonb)
      from (
        select extract(hour from order_date)::int as hour, count(*) as orders,
               coalesce(sum(total_order_amount), 0) as revenue
        from public.orders
        where order_date is not null
          and (p_from is null or order_date >= p_from)
          and (p_to is null or order_date < p_to)
        group by 1
      ) h
    ),
    'by_dow', (
      select coalesce(jsonb_agg(jsonb_build_object('dow', d.dow, 'orders', d.orders, 'revenue', d.revenue) order by d.dow), '[]'::jsonb)
      from (
        select extract(isodow from order_date)::int as dow, count(*) as orders,
               coalesce(sum(total_order_amount), 0) as revenue
        from public.orders
        where order_date is not null
          and (p_from is null or order_date >= p_from)
          and (p_to is null or order_date < p_to)
        group by 1
      ) d
    )
  );
$$;

alter function public.fn_report_extras(timestamptz, timestamptz) set search_path = public;
alter function public.fn_rating_breakdown(timestamptz, timestamptz) set search_path = public;
alter function public.fn_sales_by_day(timestamptz, timestamptz) set search_path = public;
alter function public.fn_fulfillment_orders(timestamptz, timestamptz, integer) set search_path = public;
alter function public.fn_promo_performance(timestamptz, timestamptz, integer) set search_path = public;
alter function public.fn_new_customers(timestamptz, timestamptz, integer) set search_path = public;
alter function public.fn_out_of_stock_sellers(timestamptz, timestamptz, integer) set search_path = public;
alter function public.fn_orders_time_patterns(timestamptz, timestamptz) set search_path = public;
alter function public.fn_top_products_units(timestamptz, timestamptz, integer) set search_path = public;

revoke execute on function public.fn_report_extras(timestamptz, timestamptz) from public, anon;
revoke execute on function public.fn_top_products_units(timestamptz, timestamptz, integer) from public, anon;
revoke execute on function public.fn_rating_breakdown(timestamptz, timestamptz) from public, anon;
revoke execute on function public.fn_sales_by_day(timestamptz, timestamptz) from public, anon;
revoke execute on function public.fn_fulfillment_orders(timestamptz, timestamptz, integer) from public, anon;
revoke execute on function public.fn_promo_performance(timestamptz, timestamptz, integer) from public, anon;
revoke execute on function public.fn_new_customers(timestamptz, timestamptz, integer) from public, anon;
revoke execute on function public.fn_out_of_stock_sellers(timestamptz, timestamptz, integer) from public, anon;
revoke execute on function public.fn_orders_time_patterns(timestamptz, timestamptz) from public, anon;
