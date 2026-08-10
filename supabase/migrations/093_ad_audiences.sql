-- 093: Ad Audiences — buyer-persona exports for Meta Lookalike seeding.
--
-- A separate page (page_key 'audiences') so a media buyer can be granted
-- access to audience exports WITHOUT seeing the SMS budget tooling on
-- /segments. Same engine underneath: definitions resolve through
-- fn_segment_ids (090), so "buyers of book X in July" means exactly the
-- same people on both pages.
--
-- The export speaks Meta's Custom Audience CSV dialect: email, phone
-- (E.164 digits, 201XXXXXXXXX), fn/ln, ct, country, value. Meta hashes on
-- upload, matches on any column it can, and `value` feeds value-based
-- lookalikes (we send lifetime delivered EGP).

-- who's in the audience, and can Meta match them
create or replace function public.fn_audience_count(p_def jsonb)
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
      count(*) filter (where public.fn_phone_ok(i.phone)) as with_phone,
      count(*) filter (where coalesce(i.email, '') <> '') as with_email,
      count(*) filter (where public.fn_phone_ok(i.phone) or coalesce(i.email, '') <> '') as matchable
    from ids join public.customer_identities i on i.master_id = ids.mid
  )
  select jsonb_build_object(
    'people', people,
    'with_phone', with_phone,
    'with_email', with_email,
    'matchable', matchable
  ) from x;
$$;

grant execute on function public.fn_audience_count(jsonb) to authenticated;

-- the persona behind the audience: where they live, what they spend,
-- how often they come back — the description a media buyer writes down.
create or replace function public.fn_audience_insights(p_def jsonb)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with ids as (select public.fn_segment_ids(p_def) as mid),
  base as (
    select i.*
    from ids join public.customer_identities i on i.master_id = ids.mid
  ),
  agg as (
    select
      count(*) as people,
      round(avg(nullif(greatest(lifetime_delivered_amount, app_amount), 0))) as avg_spend,
      round(avg(greatest(lifetime_orders, app_orders)), 2) as avg_orders,
      count(*) filter (where greatest(lifetime_delivered, app_orders) >= 2) as repeat_buyers,
      count(*) filter (where recency_days is not null and recency_days <= 180) as active_180,
      count(*) filter (where birthdate is not null) as with_birthdate
    from base
  ),
  cities as (
    select coalesce(nullif(trim(city), ''), '—') as city, count(*) as n
    from base group by 1 order by n desc limit 6
  ),
  segs as (
    select coalesce(segment, '—') as segment, count(*) as n
    from base where segment is not null group by 1 order by n desc
  )
  select jsonb_build_object(
    'people', (select people from agg),
    'avg_spend', (select avg_spend from agg),
    'avg_orders', (select avg_orders from agg),
    'repeat_buyers', (select repeat_buyers from agg),
    'active_180', (select active_180 from agg),
    'with_birthdate', (select with_birthdate from agg),
    'cities', coalesce((select jsonb_agg(jsonb_build_object('city', city, 'n', n)) from cities), '[]'::jsonb),
    'segments', coalesce((select jsonb_agg(jsonb_build_object('segment', segment, 'n', n)) from segs), '[]'::jsonb)
  );
$$;

grant execute on function public.fn_audience_insights(jsonb) to authenticated;

-- Meta Custom Audience rows. Only people Meta can actually match (phone
-- or email); phone as E.164 digits; name split into fn/ln because that is
-- what the upload template wants.
create or replace function public.fn_audience_export(p_def jsonb, p_limit integer default 100000)
returns table (
  email text,
  phone text,
  fn text,
  ln text,
  ct text,
  country text,
  value numeric,
  master_id text,
  orders integer,
  last_order_at date
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with ids as (select public.fn_segment_ids(p_def) as mid)
  select
    nullif(trim(i.email), '') as email,
    case when public.fn_phone_ok(i.phone) then '20' || public.fn_phone_norm(i.phone) end as phone,
    nullif(split_part(trim(coalesce(i.name, '')), ' ', 1), '') as fn,
    nullif(trim(substr(trim(coalesce(i.name, '')),
                       length(split_part(trim(coalesce(i.name, '')), ' ', 1)) + 1)), '') as ln,
    nullif(trim(i.city), '') as ct,
    'EG' as country,
    greatest(i.lifetime_delivered_amount, i.app_amount) as value,
    i.master_id,
    greatest(i.lifetime_orders, i.app_orders) as orders,
    i.last_order_at
  from ids
  join public.customer_identities i on i.master_id = ids.mid
  where public.fn_phone_ok(i.phone) or coalesce(i.email, '') <> ''
  order by greatest(i.lifetime_delivered_amount, i.app_amount) desc nulls last
  limit p_limit;
$$;

grant execute on function public.fn_audience_export(jsonb, integer) to authenticated;

insert into public.page_permissions (page_key, allow_manager, allow_viewer)
values ('audiences', true, true)
on conflict (page_key) do nothing;
