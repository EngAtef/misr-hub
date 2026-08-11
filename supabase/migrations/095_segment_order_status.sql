-- 095: segment builder learns order status.
--
-- Two new definition keys, both answered from the identity aggregates so
-- they cost nothing extra:
--
--   last_status  delivered | canceled | returned | in_progress
--                — the state of the person's most recent order
--                  (platform states grouped: 'Returned', 'Return Sent To
--                  Erp' and 'Return Request' all read as returned, the
--                  pre-delivery pipeline states as in_progress)
--
--   history      clean        — every order delivered, zero cancellations
--                has_canceled — at least one cancelled order
--                all_canceled — never received anything (pure cancellers;
--                               the natural exclusion list, and the COD
--                               risk list)
--
-- "Buyers last 3 months whose last order was delivered" is now
-- active_in{from} + last_status=delivered. Combined with the existing
-- filters the whole ask composes.

create or replace function public.fn_segment_ids(p_def jsonb)
returns setof text
language sql
stable
security definer
set search_path to 'public'
as $$
  with def as (
    select
      coalesce(nullif(p_def->>'base', ''), 'all') as base,
      (select array_agg(x) from jsonb_array_elements_text(
         case when jsonb_typeof(p_def->'segments') = 'array' then p_def->'segments' else '[]'::jsonb end) x) as segs,
      (select array_agg(x) from jsonb_array_elements_text(
         case when jsonb_typeof(p_def->'cities') = 'array' then p_def->'cities' else '[]'::jsonb end) x) as cities,
      nullif(p_def->>'birth_month', '')::int  as birth_month,
      nullif(p_def->>'joined_from', '')::date as joined_from,
      nullif(p_def->>'joined_to', '')::date   as joined_to,
      nullif(p_def->>'last_from', '')::date   as last_from,
      nullif(p_def->>'last_to', '')::date     as last_to,
      nullif(p_def->>'recency_min', '')::int  as recency_min,
      nullif(p_def->>'recency_max', '')::int  as recency_max,
      nullif(p_def->>'min_orders', '')::int   as min_orders,
      nullif(p_def->>'max_orders', '')::int   as max_orders,
      nullif(p_def->>'min_spent', '')::numeric as min_spent,
      nullif(p_def->>'max_spent', '')::numeric as max_spent,
      nullif(p_def->>'last_status', '') as last_status,
      nullif(p_def->>'history', '')     as history,
      -- jsonb_typeof(NULL) is NULL, and `not NULL` filters every row — coalesce
      coalesce(jsonb_typeof(p_def->'active_in') = 'object', false) as has_active,
      nullif(p_def->'active_in'->>'from', '')::date as act_from,
      nullif(p_def->'active_in'->>'to', '')::date   as act_to,
      coalesce(jsonb_typeof(p_def->'bought') = 'object', false) as has_bought,
      coalesce(p_def->'bought'->>'kind', 'sku') as b_kind,
      (select array_agg(x) from jsonb_array_elements_text(
         case when jsonb_typeof(p_def->'bought'->'values') = 'array' then p_def->'bought'->'values' else '[]'::jsonb end) x) as b_vals,
      (select array_agg(x::uuid) from jsonb_array_elements_text(
         case when p_def->'bought'->>'kind' = 'list' and jsonb_typeof(p_def->'bought'->'values') = 'array'
              then p_def->'bought'->'values' else '[]'::jsonb end) x) as b_lists,
      nullif(p_def->'bought'->>'from', '')::date as b_from,
      nullif(p_def->'bought'->>'to', '')::date   as b_to,
      coalesce(jsonb_typeof(p_def->'not_bought') = 'object', false) as has_nb,
      coalesce(p_def->'not_bought'->>'kind', 'sku') as nb_kind,
      (select array_agg(x) from jsonb_array_elements_text(
         case when jsonb_typeof(p_def->'not_bought'->'values') = 'array' then p_def->'not_bought'->'values' else '[]'::jsonb end) x) as nb_vals,
      (select array_agg(x::uuid) from jsonb_array_elements_text(
         case when p_def->'not_bought'->>'kind' = 'list' and jsonb_typeof(p_def->'not_bought'->'values') = 'array'
              then p_def->'not_bought'->'values' else '[]'::jsonb end) x) as nb_lists,
      nullif(p_def->'not_bought'->>'from', '')::date as nb_from,
      nullif(p_def->'not_bought'->>'to', '')::date   as nb_to
  ),
  b_ids as (
    select distinct coalesce(o.master_id, o.customer_id) as mid
    from def d
    join public.orders o on true
    join public.order_items oi on oi.order_number = o.order_number
    where d.has_bought
      and coalesce(o.master_id, o.customer_id) is not null
      and coalesce(o.order_status, '') <> 'Cancelled'
      and (d.b_from is null or o.order_date >= d.b_from)
      and (d.b_to is null or o.order_date < d.b_to + 1)
      and case d.b_kind
            when 'category' then exists (
              select 1 from public.products p
              where p.sku = oi.sku and p.category = any(d.b_vals))
            when 'section' then exists (
              select 1 from public.products p
              where p.sku = oi.sku and p.section = any(d.b_vals))
            when 'list' then exists (
              select 1 from public.custom_list_items cli
              where cli.sku = oi.sku and cli.list_key = any(d.b_lists))
            else oi.sku = any(d.b_vals)
          end
  ),
  nb_ids as (
    select distinct coalesce(o.master_id, o.customer_id) as mid
    from def d
    join public.orders o on true
    join public.order_items oi on oi.order_number = o.order_number
    where d.has_nb
      and coalesce(o.master_id, o.customer_id) is not null
      and coalesce(o.order_status, '') <> 'Cancelled'
      and (d.nb_from is null or o.order_date >= d.nb_from)
      and (d.nb_to is null or o.order_date < d.nb_to + 1)
      and case d.nb_kind
            when 'category' then exists (
              select 1 from public.products p
              where p.sku = oi.sku and p.category = any(d.nb_vals))
            when 'section' then exists (
              select 1 from public.products p
              where p.sku = oi.sku and p.section = any(d.nb_vals))
            when 'list' then exists (
              select 1 from public.custom_list_items cli
              where cli.sku = oi.sku and cli.list_key = any(d.nb_lists))
            else oi.sku = any(d.nb_vals)
          end
  ),
  a_ids as (
    select distinct coalesce(o.master_id, o.customer_id) as mid
    from def d
    join public.orders o on true
    where d.has_active
      and coalesce(o.master_id, o.customer_id) is not null
      and coalesce(o.order_status, '') <> 'Cancelled'
      and (d.act_from is null or o.order_date >= d.act_from)
      and (d.act_to is null or o.order_date < d.act_to + 1)
  )
  select i.master_id
  from public.customer_identities i, def d
  where (select public.my_role()) in ('admin', 'manager', 'viewer')
    and (d.base = 'all'
         or (d.base = 'buyers'   and greatest(i.lifetime_orders, i.app_orders) > 0)
         or (d.base = 'never'    and greatest(i.lifetime_orders, i.app_orders) = 0)
         or (d.base = 'repeat'   and greatest(i.lifetime_delivered, i.app_orders) >= 2)
         or (d.base = 'one_time' and greatest(i.lifetime_delivered, i.app_orders) = 1))
    and (d.segs is null or i.segment = any(d.segs))
    and (d.cities is null or coalesce(i.city, '—') = any(d.cities))
    and (d.birth_month is null or extract(month from i.birthdate) = d.birth_month)
    and (d.joined_from is null or i.first_joined_at >= d.joined_from)
    and (d.joined_to is null or i.first_joined_at < d.joined_to + 1)
    and (d.last_from is null or i.last_order_at >= d.last_from)
    and (d.last_to is null or i.last_order_at <= d.last_to)
    and (d.recency_min is null or i.recency_days >= d.recency_min)
    and (d.recency_max is null or i.recency_days <= d.recency_max)
    and (d.min_orders is null or greatest(i.lifetime_orders, i.app_orders) >= d.min_orders)
    and (d.max_orders is null or greatest(i.lifetime_orders, i.app_orders) <= d.max_orders)
    and (d.min_spent is null or greatest(i.lifetime_delivered_amount, i.app_amount) >= d.min_spent)
    and (d.max_spent is null or greatest(i.lifetime_delivered_amount, i.app_amount) <= d.max_spent)
    and (d.last_status is null
         or (d.last_status = 'delivered'   and i.last_order_state = 'Delivered')
         or (d.last_status = 'canceled'    and i.last_order_state = 'Cancelled')
         or (d.last_status = 'returned'    and i.last_order_state in ('Returned', 'Return Sent To Erp', 'Return Request'))
         or (d.last_status = 'in_progress' and i.last_order_state in ('Placed', 'Confirmed', 'Send To Erp', 'Picked by courier', 'Shipped', 'Out For Delivery')))
    and (d.history is null
         or (d.history = 'clean'        and i.lifetime_canceled = 0 and i.lifetime_delivered > 0)
         or (d.history = 'has_canceled' and i.lifetime_canceled > 0)
         or (d.history = 'all_canceled' and i.lifetime_orders > 0 and i.lifetime_canceled >= i.lifetime_orders))
    and (not d.has_active or i.master_id in (select mid from a_ids))
    and (not d.has_bought or i.master_id in (select mid from b_ids))
    and (not d.has_nb or i.master_id not in (select mid from nb_ids))
$$;
