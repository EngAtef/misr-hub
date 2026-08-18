-- ============================================================
-- Migration 117: weight on the Vendors overview and the customer drawer.
-- - fn_vendor_grp_overview: lines carry the book weight; kpis gain
--   weight_kg / delivered_weight_kg, monthly / books / cities gain
--   weight_kg (jsonb → additive, no client break)
-- - fn_identity_detail: each order in the drawer carries weight_kg
-- Run after 116_stock_engine_weight.sql
-- ============================================================

create or replace function public.fn_vendor_grp_overview(
  p_group text, p_from timestamptz, p_to timestamptz,
  p_limit integer default 40, p_city_limit integer default 20
)
returns jsonb
language sql stable
set search_path = public
set work_mem = '32MB'
as $$
  with adwaa as materialized (
    select sku from public.stock_items where category = 'AL-Adwaa'
    union
    select sku from public.product_sales where category = 'AL-Adwaa'
  ),
  qty as materialized (
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
           coalesce(ps.quantity, 1) as qty,
           coalesce(ps.quantity, 1) * p.weight_kg as kg
    from ord o
    join public.order_items i on i.order_number = o.order_number
    left join qty ps on ps.order_id = i.order_number and ps.sku = i.sku
    left join public.products p on p.sku = i.sku
    where (case when p_group = 'adwaa'
                then exists (select 1 from adwaa a where a.sku = i.sku)
                else not exists (select 1 from adwaa a where a.sku = i.sku) end)
  )
  select jsonb_build_object(
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
        'avg_price', case when coalesce(sum(qty), 0) > 0 then coalesce(sum(price), 0) / sum(qty) else 0 end,
        'weight_kg', round(coalesce(sum(kg), 0), 2),
        'delivered_weight_kg', round(coalesce(sum(kg) filter (where order_status = 'Delivered'), 0), 2)
      ) from lines
    ),
    'monthly', (
      select coalesce(jsonb_agg(to_jsonb(m) order by m.month), '[]'::jsonb) from (
        select date_trunc('month', order_date)::date as month,
               coalesce(sum(qty), 0)::bigint as units,
               coalesce(sum(price), 0) as revenue,
               count(distinct order_number) as orders,
               round(coalesce(sum(kg), 0), 2) as weight_kg
        from lines where order_date is not null group by 1
      ) m
    ),
    'books', (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.units desc), '[]'::jsonb) from (
        select coalesce(product_name, '(unknown)') as product_name, max(sku) as sku,
               coalesce(sum(qty), 0)::bigint as units, coalesce(sum(price), 0) as revenue,
               round(coalesce(sum(kg), 0), 2) as weight_kg
        from lines where order_status not in ('Cancelled')
        group by 1 order by 3 desc limit p_limit
      ) b
    ),
    'cities', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.units desc), '[]'::jsonb) from (
        select coalesce(nullif(trim(city), ''), '(none)') as city,
               coalesce(sum(qty), 0)::bigint as units, coalesce(sum(price), 0) as revenue,
               round(coalesce(sum(kg), 0), 2) as weight_kg
        from lines where order_status not in ('Cancelled')
        group by 1 order by 2 desc limit p_city_limit
      ) c
    )
  );
$$;

create or replace function public.fn_identity_detail(p_key text)
returns jsonb
language sql stable
set search_path = public
as $$
  with m as (
    select coalesce(
      (select master_id from public.customer_links where customer_id = p_key),
      (select master_id from public.customer_identities where master_id = p_key)
    ) as master_id
  )
  select jsonb_build_object(
    'identity', (select to_jsonb(i) - 'search_text' from public.customer_identities i, m where i.master_id = m.master_id),
    'accounts', coalesce((
      select jsonb_agg(to_jsonb(c) || jsonb_build_object(
               'is_master', c.customer_id = m.master_id,
               'override', (select to_jsonb(o) from public.customer_merge_overrides o where o.customer_id = c.customer_id)
             ) order by c.joined_at nulls last)
      from public.customers c
      join public.customer_links l on l.customer_id = c.customer_id, m
      where l.master_id = m.master_id
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.order_date desc nulls last)
      from (
        select o.order_number, o.customer_id, o.order_date, o.order_status, o.delivery_status,
               o.payment_method, o.total_order_amount, o.city, o.area, o.source,
               o.items_count, o.cancellation_reason, o.applied_offer,
               o.attr_bucket, o.attr_source, o.attr_medium, o.attr_campaign,
               o.weight_kg, o.weight_missing
        from public.orders o
        join public.customer_links l on l.customer_id = o.customer_id, m
        where l.master_id = m.master_id
        order by o.order_date desc nulls last
        limit 500
      ) x
    ), '[]'::jsonb)
  );
$$;
