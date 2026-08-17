-- 110: the per-book buyers list (product drawer, /products, assistant)
-- carries the order's platform and GA4 customer source (migration 109).
-- Return type changes, so drop + recreate.
drop function if exists public.fn_sku_purchasers(text, text, timestamptz, timestamptz, integer);
create or replace function public.fn_sku_purchasers(p_sku text, p_keyword text, p_from timestamptz, p_to timestamptz, p_limit integer default 5000)
returns table(order_number text, order_date timestamptz, order_status text, customer_id text, customer_name text, customer_phone text, customer_email text, city text, area text, product_name text, sku text, units bigint, unit_price numeric, book_amount numeric, order_total numeric, payment_method text, source text, attr_bucket text, attr_source text, attr_medium text, attr_campaign text)
language sql
stable
set search_path to 'public'
as $$
  select
    o.order_number, o.order_date, o.order_status,
    o.customer_id, o.customer_name, o.customer_phone,
    c.email as customer_email,
    o.city, o.area,
    mode() within group (order by coalesce(ps.product_name, i.product_name)) as product_name,
    max(i.sku) as sku,
    sum(coalesce(ps.quantity, 1))::bigint as units,
    max(coalesce(ps.unit_price_after_discount, ps.unit_price)) as unit_price,
    coalesce(sum(i.price), 0) as book_amount,
    max(o.total_order_amount) as order_total,
    max(o.payment_method) as payment_method,
    max(o.source) as source,
    max(o.attr_bucket) as attr_bucket,
    max(o.attr_source) as attr_source,
    max(o.attr_medium) as attr_medium,
    max(o.attr_campaign) as attr_campaign
  from public.order_items i
  join public.orders o on o.order_number = i.order_number
  left join public.product_sales ps on ps.order_id = i.order_number and ps.sku = i.sku
  left join public.customers c on c.customer_id = o.customer_id
  where (
      (p_sku is not null and p_sku <> '' and i.sku = p_sku)
      or (p_keyword is not null and p_keyword <> '' and i.product_name ilike '%'||p_keyword||'%')
    )
    and (p_from is null or o.order_date >= p_from)
    and (p_to is null or o.order_date < p_to)
  group by o.order_number, o.order_date, o.order_status, o.customer_id,
           o.customer_name, o.customer_phone, c.email, o.city, o.area
  order by o.order_date desc
  limit p_limit;
$$;
grant execute on function public.fn_sku_purchasers(text, text, timestamptz, timestamptz, integer) to authenticated, service_role;

-- customer drawer: each order in the identity's list carries its source too
create or replace function public.fn_identity_detail(p_key text)
returns jsonb
language sql
stable
set search_path to 'public'
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
               o.attr_bucket, o.attr_source, o.attr_medium, o.attr_campaign
        from public.orders o
        join public.customer_links l on l.customer_id = o.customer_id, m
        where l.master_id = m.master_id
        order by o.order_date desc nulls last
        limit 500
      ) x
    ), '[]'::jsonb)
  );
$$;
