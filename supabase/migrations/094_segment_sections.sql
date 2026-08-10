-- 094: bought-filter learns the store's top-level SECTIONS.
--
-- products carries two levels: `section` (Kids, Cultural, Comics, Foreign
-- books, AL-Adwaa — what the storefront calls the main category) and
-- `category` (the detailed shelf: Stories & Adventures, Islamic Books, ...).
-- The audience pages filtered only by `category`; the media buyer thinks in
-- sections. bought/not_bought now accept kind='section', and
-- fn_segment_options serves the section list for the dropdowns.

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
    and (not d.has_active or i.master_id in (select mid from a_ids))
    and (not d.has_bought or i.master_id in (select mid from b_ids))
    and (not d.has_nb or i.master_id not in (select mid from nb_ids))
$$;

create or replace function public.fn_segment_options()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when (select public.my_role()) not in ('admin', 'manager', 'viewer')
    then '{}'::jsonb
    else jsonb_build_object(
      'cities', coalesce((
        select jsonb_agg(city order by n desc) from (
          select city, count(*) as n
          from public.customer_identities
          where coalesce(city, '') <> ''
          group by city order by n desc limit 80
        ) c), '[]'::jsonb),
      'sections', coalesce((
        select jsonb_agg(section order by n desc) from (
          select section, count(*) as n
          from public.products
          where coalesce(section, '') <> ''
          group by section order by n desc
        ) s), '[]'::jsonb),
      'categories', coalesce((
        select jsonb_agg(category order by category) from (
          select distinct category from public.products
          where coalesce(category, '') <> ''
        ) c), '[]'::jsonb),
      'lists', coalesce((
        select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'slug', slug, 'items', item_count)
                         order by name)
        from public.custom_lists), '[]'::jsonb)
    ) end;
$$;
