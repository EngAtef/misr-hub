-- 090: Segments Center — one engine that turns a jsonb definition into a
-- customer audience. The /segments page sends the same definition shape
-- whether the user clicked a prebuilt card ("champions"), built a custom
-- audience ("bought list X in July but never bought Y"), or re-ran a saved
-- segment. Counting, previewing and exporting all resolve through
-- fn_segment_ids, so a number shown on a card is always the number exported.
--
-- Definition shape (all keys optional):
--   base            all | buyers | never | repeat | one_time
--   segments        ["champions","loyal",...]        RFM labels
--   cities          ["Cairo",...]
--   birth_month     1..12
--   joined_from/to  date       registration window
--   last_from/to    date       last order inside window
--   recency_min/max int        days since last order
--   min_orders/max_orders, min_spent/max_spent
--   active_in       {from,to}              placed ANY order in window
--   bought          {kind: sku|category|list, values:[], from, to}
--   not_bought      {kind, values, from, to}   exclusion — e.g. cross-sell
--
-- SMS reality checks live here too: a phone only counts as reachable if it
-- is a valid Egyptian mobile, and sms_opt_outs survives identity rebuilds
-- because it keys on the normalized phone, not the master_id.

-- ------------------------------------------------------------ phone helpers

create or replace function public.fn_phone_norm(p text)
returns text
language sql immutable
as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10);
$$;

create or replace function public.fn_phone_ok(p text)
returns boolean
language sql immutable
as $$
  select regexp_replace(coalesce(p, ''), '\D', '', 'g') ~ '^(20)?01[0125][0-9]{8}$';
$$;

-- ------------------------------------------------------------------ tables

create table if not exists public.saved_segments (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  note           text,
  definition     jsonb not null default '{}'::jsonb,
  last_people    integer,
  last_reachable integer,
  counted_at     timestamptz,
  created_by     uuid references public.profiles (id),
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- opt-outs key on the phone so a full identity rebuild cannot lose them
create table if not exists public.sms_opt_outs (
  phone_norm text primary key,
  note       text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

do $$
declare tbl text;
begin
  foreach tbl in array array['saved_segments', 'sms_opt_outs'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_read', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_write', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_update', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_delete', tbl);
    execute format(
      'create policy %I on public.%I for select using ((select public.my_role()) in (''admin'',''manager'',''viewer''))',
      tbl || '_read', tbl);
    execute format(
      'create policy %I on public.%I for insert with check ((select public.my_role()) in (''admin'',''manager''))',
      tbl || '_write', tbl);
    execute format(
      'create policy %I on public.%I for update using ((select public.my_role()) in (''admin'',''manager'')) with check ((select public.my_role()) in (''admin'',''manager''))',
      tbl || '_update', tbl);
    execute format(
      'create policy %I on public.%I for delete using ((select public.my_role()) in (''admin'',''manager''))',
      tbl || '_delete', tbl);
  end loop;
end $$;

-- ------------------------------------------------------------------ engine

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
  -- who bought the given SKUs / category / custom list in the window.
  -- materialized as a set once, then hash-joined — a correlated EXISTS per
  -- identity row is what blows through the 8s statement_timeout.
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

grant execute on function public.fn_segment_ids(jsonb) to authenticated;

-- headline numbers for a definition: people, phones, reachable, exportable
create or replace function public.fn_segment_count(p_def jsonb)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with ids as (select public.fn_segment_ids(p_def) as mid),
  x as (
    select
      count(*) as people,
      count(*) filter (where i.phone is not null and i.phone <> '') as with_phone,
      count(*) filter (where public.fn_phone_ok(i.phone)) as reachable,
      count(*) filter (where public.fn_phone_ok(i.phone)
                         and oo.phone_norm is not null) as opted_out
    from ids
    join public.customer_identities i on i.master_id = ids.mid
    left join public.sms_opt_outs oo on oo.phone_norm = public.fn_phone_norm(i.phone)
  )
  select jsonb_build_object(
    'people', people,
    'with_phone', with_phone,
    'reachable', reachable,
    'opted_out', opted_out,
    'exportable', reachable - opted_out
  ) from x;
$$;

grant execute on function public.fn_segment_count(jsonb) to authenticated;

-- the actual contact list. phone comes out normalized as 01XXXXXXXXX so the
-- CSV can go to an SMS gateway without cleanup.
create or replace function public.fn_segment_export(
  p_def jsonb,
  p_reachable_only boolean default true,
  p_exclude_opt_outs boolean default true,
  p_limit integer default 50000
)
returns table (
  master_id text,
  name text,
  phone text,
  city text,
  segment text,
  orders integer,
  total_spent numeric,
  last_order_at date
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with ids as (select public.fn_segment_ids(p_def) as mid)
  select
    i.master_id,
    i.name,
    case when public.fn_phone_ok(i.phone)
         then '0' || public.fn_phone_norm(i.phone)
         else i.phone end as phone,
    i.city,
    i.segment,
    greatest(i.lifetime_orders, i.app_orders) as orders,
    greatest(i.lifetime_delivered_amount, i.app_amount) as total_spent,
    i.last_order_at
  from ids
  join public.customer_identities i on i.master_id = ids.mid
  left join public.sms_opt_outs oo on oo.phone_norm = public.fn_phone_norm(i.phone)
  where (not p_reachable_only or public.fn_phone_ok(i.phone))
    and (not p_exclude_opt_outs or oo.phone_norm is null)
  order by greatest(i.lifetime_delivered_amount, i.app_amount) desc nulls last
  limit p_limit;
$$;

grant execute on function public.fn_segment_export(jsonb, boolean, boolean, integer) to authenticated;

-- dropdown feeds for the builder: cities, categories, custom lists
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

grant execute on function public.fn_segment_options() to authenticated;

-- ------------------------------------------------------------- permissions

insert into public.page_permissions (page_key, allow_manager, allow_viewer)
values ('segments', true, true)
on conflict (page_key) do nothing;
