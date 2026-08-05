-- ============================================================
-- Migration 072: make the vendor analysis page survive wider
-- date ranges.
--
-- Symptom: "Last 7 days" showed data, "Last 30 days" showed
-- "No results" even though the data is there (30d = 811 units /
-- 95k EGP for Al Adwaa on 2026-08-05).
--
-- Cause: the page fires 4 vendor RPCs in parallel; each one
-- re-evaluated `exists (select 1 from v_adwaa_skus ...)` — a UNION
-- view over stock_items + product_sales with no index on category —
-- for every order line, and each also seq-scanned order_items and
-- left-joined the 105k-row product_sales. A single 30-day call cost
-- ~2.8s / 1.5M buffer hits on its own; four of them at once on the
-- free-tier instance blew past the 8s statement_timeout of the
-- `authenticated` role. PostgREST returned 57014, the page swallowed
-- the error and rendered its empty state. 7 days was small enough to
-- squeak in under the timeout, which is why only wide ranges broke.
--
-- Fix:
--   1) index (category, sku) on stock_items + product_sales so the
--      AL-Adwaa SKU set is an index-only scan;
--   2) rewrite the vendor functions to collect that SKU set ONCE in
--      a materialized CTE and to drive off the date-filtered orders;
--   3) quantity comes from a 3.3k-row partial index instead of a
--      per-line lookup into the 105k-row product_sales (only rows with
--      quantity <> 1 can change `coalesce(ps.quantity, 1)`), which is
--      what made the "All time" range cost 12s;
--   4) add fn_vendor_grp_overview: one call returning kpis + monthly
--      + top books + cities from a single pass, so the page makes one
--      request instead of four competing ones.
-- Results are identical to the previous definitions.
-- 30 days: 2.8s -> 0.35s. All time (NM Books): 12.4s -> ~2s.
-- Run after 071.
-- ============================================================

create index if not exists idx_stock_items_cat_sku on public.stock_items (category, sku);
create index if not exists idx_product_sales_cat_sku on public.product_sales (category, sku);
-- covers the only product_sales rows that can move a unit count
create index if not exists idx_product_sales_qty_multi
  on public.product_sales (order_id, sku, quantity)
  where quantity is not null and quantity <> 1;

-- Everything the vendors page renders, in one pass over the matched
-- order lines. p_group: 'adwaa' | 'nm'.
create or replace function public.fn_vendor_grp_overview(
  p_group text,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer default 40,
  p_city_limit integer default 20
)
returns jsonb language sql stable set search_path = public set work_mem = '32MB'
as $$
  with adwaa as materialized (
    select sku from public.stock_items where category = 'AL-Adwaa'
    union
    select sku from public.product_sales where category = 'AL-Adwaa'
  ),
  qty as materialized (
    -- every other line falls back to 1 copy, so these are the only
    -- product_sales rows worth joining
    select order_id, sku, quantity from public.product_sales
    where quantity is not null and quantity <> 1
  ),
  ord as materialized (
    select order_number, order_status, customer_id, master_id, city, order_date
    from public.orders
    where (p_from is null or order_date >= p_from)
      and (p_to is null or order_date < p_to)
  ),
  lines as materialized (
    select o.order_number, o.order_status, o.customer_id, o.master_id, o.city, o.order_date,
           i.product_name, i.sku, coalesce(i.price, 0) as price,
           coalesce(ps.quantity, 1) as qty
    from ord o
    join public.order_items i on i.order_number = o.order_number
    left join qty ps on ps.order_id = i.order_number and ps.sku = i.sku
    where (case when p_group = 'adwaa'
                then exists (select 1 from adwaa a where a.sku = i.sku)
                else not exists (select 1 from adwaa a where a.sku = i.sku) end)
  )
  select jsonb_build_object(
    -- the distinct counts run as hash aggregates instead of the sorts
    -- count(distinct ...) forces; on the all-time range that alone was
    -- an on-disk merge sort of ~97k rows
    'kpis', (
      select jsonb_build_object(
        'units', coalesce(sum(qty), 0),
        'revenue', coalesce(sum(price), 0),
        'orders', (select count(*) from (select distinct order_number from lines) s),
        'delivered_units', coalesce(sum(qty) filter (where order_status = 'Delivered'), 0),
        'cancelled_units', coalesce(sum(qty) filter (where order_status in ('Cancelled','Returned','Return Sent To Erp')), 0),
        'unique_titles', (select count(*) from (select distinct product_name from lines where product_name is not null) s),
        'unique_customers', (select count(*) from (
          select distinct coalesce(master_id, customer_id) as cid from lines
        ) s where s.cid is not null),
        'avg_price', case when coalesce(sum(qty), 0) > 0 then coalesce(sum(price), 0) / sum(qty) else 0 end
      ) from lines
    ),
    'monthly', (
      select coalesce(jsonb_agg(to_jsonb(m) order by m.month), '[]'::jsonb) from (
        select date_trunc('month', order_date)::date as month,
               coalesce(sum(qty), 0)::bigint as units,
               coalesce(sum(price), 0) as revenue,
               count(distinct order_number) as orders
        from lines where order_date is not null group by 1
      ) m
    ),
    'books', (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.units desc), '[]'::jsonb) from (
        select coalesce(product_name, '(unknown)') as product_name, max(sku) as sku,
               coalesce(sum(qty), 0)::bigint as units, coalesce(sum(price), 0) as revenue
        from lines where order_status not in ('Cancelled')
        group by 1 order by 3 desc limit p_limit
      ) b
    ),
    'cities', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.units desc), '[]'::jsonb) from (
        select coalesce(nullif(trim(city), ''), '(none)') as city,
               coalesce(sum(qty), 0)::bigint as units, coalesce(sum(price), 0) as revenue
        from lines where order_status not in ('Cancelled')
        group by 1 order by 2 desc limit p_city_limit
      ) c
    )
  );
$$;

-- Same shape applied to the individual functions (still used by the
-- comparison period and kept for any ad-hoc use).
create or replace function public.fn_vendor_grp_kpis(p_group text, p_from timestamptz, p_to timestamptz)
returns json language sql stable set search_path = public
as $$
  select (public.fn_vendor_grp_overview(p_group, p_from, p_to, 1, 1) -> 'kpis')::json;
$$;

create or replace function public.fn_vendor_grp_by_month(p_group text, p_from timestamptz, p_to timestamptz)
returns table (month date, units bigint, revenue numeric, orders bigint)
language sql stable set search_path = public
as $$
  select (r ->> 'month')::date, (r ->> 'units')::bigint, (r ->> 'revenue')::numeric, (r ->> 'orders')::bigint
  from jsonb_array_elements(public.fn_vendor_grp_overview(p_group, p_from, p_to, 1, 1) -> 'monthly') r;
$$;

create or replace function public.fn_vendor_grp_top_books(p_group text, p_from timestamptz, p_to timestamptz, p_limit integer default 30)
returns table (product_name text, sku text, units bigint, revenue numeric)
language sql stable set search_path = public
as $$
  select r ->> 'product_name', r ->> 'sku', (r ->> 'units')::bigint, (r ->> 'revenue')::numeric
  from jsonb_array_elements(public.fn_vendor_grp_overview(p_group, p_from, p_to, p_limit, 1) -> 'books') r;
$$;

create or replace function public.fn_vendor_grp_by_city(p_group text, p_from timestamptz, p_to timestamptz, p_limit integer default 20)
returns table (city text, units bigint, revenue numeric)
language sql stable set search_path = public
as $$
  select r ->> 'city', (r ->> 'units')::bigint, (r ->> 'revenue')::numeric
  from jsonb_array_elements(public.fn_vendor_grp_overview(p_group, p_from, p_to, 1, p_limit) -> 'cities') r;
$$;

-- Export: same per-row `exists` over the UNION view was the hot spot.
create or replace function public.fn_vendor_grp_export(p_group text, p_from timestamptz, p_to timestamptz)
returns json language sql stable set search_path = public
as $$
  with adwaa as materialized (
    select sku from public.stock_items where category = 'AL-Adwaa'
    union
    select sku from public.product_sales where category = 'AL-Adwaa'
  ),
  lines as (
    select ps.order_id as order_number,
           coalesce(o.order_date, ps.order_date) as order_date,
           coalesce(o.order_status, ps.status) as order_status,
           coalesce(o.payment_method, ps.payment_method) as payment_method,
           o.customer_name, o.customer_phone, o.city, o.area,
           ps.sku, ps.product_name, coalesce(ps.quantity, 1) as quantity,
           ps.unit_price,
           ps.price as total_before_discount,
           coalesce(ps.price_after_discount, ps.price) as total_paid
    from public.product_sales ps
    left join public.orders o on o.order_number = ps.order_id
    where (p_from is null or coalesce(o.order_date, ps.order_date) >= p_from)
      and (p_to is null or coalesce(o.order_date, ps.order_date) < p_to)
      and (case when p_group = 'adwaa'
                then exists (select 1 from adwaa a where a.sku = ps.sku)
                else not exists (select 1 from adwaa a where a.sku = ps.sku) end)
  )
  select coalesce(json_agg(row_to_json(l) order by l.order_date desc, l.order_number, l.product_name), '[]'::json)
  from lines l;
$$;

revoke execute on function public.fn_vendor_grp_overview(text, timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function public.fn_vendor_grp_overview(text, timestamptz, timestamptz, integer, integer) to authenticated;
