-- 096: SMS send log + frequency cap.
--
-- A person can sit in four segments at once (loyal + Cairo + bought Kids +
-- reorder window). Without a record of who was already messaged, four
-- campaigns mean four SMS to the same phone in a week. sms_sends is that
-- record; it keys on the phone (like sms_opt_outs) so identity rebuilds and
-- overlapping segments cannot lose it, and the segment engine grows one
-- filter, no_sms_days: "exclude anyone messaged in the last N days".
--
--   fn_sms_mark_sent(def, campaign, segment_id)  logs the exportable list
--   fn_segment_count now returns recently_sent (last 30 days) so the
--   overlap is visible before the send.

create table if not exists public.sms_sends (
  id          bigserial primary key,
  phone_norm  text not null,
  sent_at     timestamptz not null default now(),
  campaign    text,
  segment_id  uuid references public.saved_segments (id) on delete set null,
  sent_by     uuid references public.profiles (id)
);

create index if not exists idx_sms_sends_phone_at on public.sms_sends (phone_norm, sent_at desc);
create index if not exists idx_sms_sends_at on public.sms_sends (sent_at desc);

alter table public.sms_sends enable row level security;
drop policy if exists sms_sends_read on public.sms_sends;
drop policy if exists sms_sends_write on public.sms_sends;
drop policy if exists sms_sends_delete on public.sms_sends;
create policy sms_sends_read on public.sms_sends for select
  using ((select public.my_role()) in ('admin', 'manager', 'viewer'));
create policy sms_sends_write on public.sms_sends for insert
  with check ((select public.my_role()) in ('admin', 'manager'));
create policy sms_sends_delete on public.sms_sends for delete
  using ((select public.my_role()) in ('admin', 'manager'));

-- ------------------------------------------------------------ engine

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
      nullif(p_def->>'no_sms_days', '')::int as no_sms_days,
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
  ),
  -- phones messaged inside the cap window; a small set, hash-joined
  recent_sms as (
    select distinct s.phone_norm
    from def d
    join public.sms_sends s on d.no_sms_days is not null
                           and s.sent_at >= now() - (d.no_sms_days || ' days')::interval
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
    and (d.no_sms_days is null or public.fn_phone_norm(i.phone) not in (select phone_norm from recent_sms))
    and (not d.has_active or i.master_id in (select mid from a_ids))
    and (not d.has_bought or i.master_id in (select mid from b_ids))
    and (not d.has_nb or i.master_id not in (select mid from nb_ids))
$$;

-- count grows `recently_sent`: how many of the exportable were messaged in
-- the last 30 days (before any no_sms_days filter is applied) — the overlap
-- number the sender wants to see
create or replace function public.fn_segment_count(p_def jsonb)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with ids as (select public.fn_segment_ids(p_def) as mid),
  recent as (
    select distinct phone_norm from public.sms_sends where sent_at >= now() - interval '30 days'
  ),
  x as (
    select
      count(*) as people,
      count(*) filter (where i.phone is not null and i.phone <> '') as with_phone,
      count(*) filter (where public.fn_phone_ok(i.phone)) as reachable,
      count(*) filter (where public.fn_phone_ok(i.phone)
                         and oo.phone_norm is not null) as opted_out,
      count(*) filter (where public.fn_phone_ok(i.phone)
                         and oo.phone_norm is null
                         and r.phone_norm is not null) as recently_sent
    from ids
    join public.customer_identities i on i.master_id = ids.mid
    left join public.sms_opt_outs oo on oo.phone_norm = public.fn_phone_norm(i.phone)
    left join recent r on r.phone_norm = public.fn_phone_norm(i.phone)
  )
  select jsonb_build_object(
    'people', people,
    'with_phone', with_phone,
    'reachable', reachable,
    'opted_out', opted_out,
    'recently_sent', recently_sent,
    'exportable', reachable - opted_out
  ) from x;
$$;

-- log a send: everyone exportable under this definition, one row each.
-- Returns how many were logged.
create or replace function public.fn_sms_mark_sent(
  p_def jsonb,
  p_campaign text default null,
  p_segment_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  if (select public.my_role()) not in ('admin', 'manager') then
    raise exception 'not allowed';
  end if;
  insert into public.sms_sends (phone_norm, campaign, segment_id, sent_by)
  select distinct e.phone_norm, p_campaign, p_segment_id, auth.uid()
  from (
    select public.fn_phone_norm(x.phone) as phone_norm
    from public.fn_segment_export(p_def, true, true, 100000) x
  ) e
  where e.phone_norm <> '';
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.fn_sms_mark_sent(jsonb, text, uuid) to authenticated;

-- recent campaigns for the log panel
create or replace function public.fn_sms_campaigns(p_limit integer default 30)
returns table (
  campaign text,
  sent_on date,
  recipients bigint,
  segment_name text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(s.campaign, '—') as campaign,
         s.sent_at::date as sent_on,
         count(*) as recipients,
         max(g.name) as segment_name
  from public.sms_sends s
  left join public.saved_segments g on g.id = s.segment_id
  where (select public.my_role()) in ('admin', 'manager', 'viewer')
  group by 1, 2
  order by sent_on desc, recipients desc
  limit p_limit;
$$;

grant execute on function public.fn_sms_campaigns(integer) to authenticated;
