-- ============================================================
-- Migration 070: ONE customer = one person.
--
-- The platform creates a NEW customer record for every guest
-- checkout, so the same human shows up several times with the
-- same phone / email (one "Customer" row + one "Guest" row, and
-- often more). Every customer report was therefore counting the
-- same person many times: repeat rate too low, customer count too
-- high, LTV too low.
--
-- This migration adds an identity layer:
--   customer_merge_overrides  manual merge / keep-separate rules
--   customer_links            account -> master (one row per account)
--   customer_identities       one row per PERSON, aggregated
-- and rewrites every customer-facing RPC to work per PERSON.
--
-- Grouping = connected components over two edge types:
--   * same normalized Egyptian phone (norm_eg_phone)
--   * same lower(email)
-- Chains merge transitively (A shares a phone with B, B shares an
-- email with C  ->  A, B, C are one person).
--
-- Guards against bad merge keys:
--   * phones/emails shared by more than p_max_key_size accounts are
--     ignored (a call-centre number would otherwise glue hundreds of
--     unrelated people together)
--   * repeated-digit junk phones (01111111111) are ignored
--   * phones shorter than 10 digits are ignored
--
-- Run after 069_nav_regroup_page_keys.sql
-- ============================================================

create extension if not exists pg_trgm;

-- ------------------------------------------------------------
-- 1. Tables
-- ------------------------------------------------------------

-- Manual decisions by a human. These survive every rebuild.
create table if not exists public.customer_merge_overrides (
  customer_id   text primary key,
  force_master  text,
  keep_separate boolean not null default false,
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now()
);

-- account -> person. Written by fn_rebuild_customer_identities.
create table if not exists public.customer_links (
  customer_id  text primary key,
  master_id    text not null,
  match_reason text,
  linked_at    timestamptz not null default now()
);
create index if not exists idx_customer_links_master on public.customer_links (master_id);

-- One row per PERSON with everything merged.
create table if not exists public.customer_identities (
  master_id                 text primary key,
  accounts                  integer not null default 1,
  account_ids               text[],
  name                      text,
  phone                     text,
  email                     text,
  city                      text,
  area                      text,
  addresses                 text,
  birthdate                 date,
  language                  text,
  is_active                 boolean,
  phones                    text[],
  emails                    text[],
  first_joined_at           timestamptz,
  -- lifetime figures from the platform CustomerOrdersExport, summed
  -- across every account of this person
  lifetime_orders           integer not null default 0,
  lifetime_delivered        integer not null default 0,
  lifetime_canceled         integer not null default 0,
  lifetime_amount           numeric not null default 0,
  lifetime_delivered_amount numeric not null default 0,
  lifetime_canceled_amount  numeric not null default 0,
  last_order_at             date,
  last_order_state          text,
  last_delivered_at         date,
  -- figures from the order rows we hold in public.orders
  app_orders                integer not null default 0,
  app_amount                numeric not null default 0,
  first_order_at            timestamptz,
  last_app_order_at         timestamptz,
  recency_days              integer,
  segment                   text,
  has_stats                 boolean not null default false,
  search_text               text,
  rebuilt_at                timestamptz not null default now()
);

create index if not exists idx_ci_spent   on public.customer_identities (lifetime_delivered_amount desc nulls last);
create index if not exists idx_ci_orders  on public.customer_identities (lifetime_orders desc nulls last);
create index if not exists idx_ci_last    on public.customer_identities (last_order_at desc nulls last);
create index if not exists idx_ci_joined  on public.customer_identities (first_joined_at desc nulls last);
create index if not exists idx_ci_city    on public.customer_identities (city);
create index if not exists idx_ci_segment on public.customer_identities (segment);
create index if not exists idx_ci_accounts on public.customer_identities (accounts desc);
create index if not exists idx_ci_birth   on public.customer_identities ((extract(month from birthdate)));
create index if not exists idx_ci_search  on public.customer_identities using gin (search_text gin_trgm_ops);

alter table public.customer_merge_overrides enable row level security;
alter table public.customer_links enable row level security;
alter table public.customer_identities enable row level security;

drop policy if exists cmo_read on public.customer_merge_overrides;
create policy cmo_read on public.customer_merge_overrides for select
  using ((select public.my_role()) in ('admin','manager','viewer'));
drop policy if exists cl_read on public.customer_links;
create policy cl_read on public.customer_links for select
  using ((select public.my_role()) in ('admin','manager','viewer'));
drop policy if exists ci_read on public.customer_identities;
create policy ci_read on public.customer_identities for select
  using ((select public.my_role()) in ('admin','manager','viewer'));
-- writes go through the SECURITY DEFINER functions below only.

-- ------------------------------------------------------------
-- 2. Helpers
-- ------------------------------------------------------------

-- Shared RFM rule so cards, filters and lists never drift apart.
create or replace function public.rfm_segment(p_freq numeric, p_recency numeric)
returns text
language sql immutable
set search_path = public
as $$
  select case
    when p_freq is null or p_freq = 0 then null
    when p_freq >= 3 and p_recency <= 60  then 'champions'
    when p_freq >= 2 and p_recency <= 120 then 'loyal'
    when p_freq  = 1 and p_recency <= 30  then 'new'
    when p_freq  = 1 and p_recency <= 90  then 'promising'
    when p_freq >= 2 then 'at_risk'
    else 'hibernating'
  end;
$$;

-- Allowed from a direct SQL session (migrations, cron) or from an
-- admin/manager JWT. Anonymous PostgREST calls fail the role check
-- and execute is revoked from anon anyway.
create or replace function public.can_manage_identities()
returns boolean
language sql stable
set search_path = public
as $$
  select coalesce(current_setting('request.jwt.claims', true), '') = ''
      or (select public.my_role()) in ('admin','manager');
$$;

-- ------------------------------------------------------------
-- 3. Rebuild: group accounts into people
-- ------------------------------------------------------------
create or replace function public.fn_rebuild_customer_identities(p_max_key_size integer default 60)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_iter    integer := 0;
  v_changed integer;
  v_people  integer;
  v_merged  integer;
  v_absorbed integer;
begin
  if not public.can_manage_identities() then
    raise exception 'Forbidden';
  end if;

  -- nodes: every account, keyed by a sortable label (ids are numeric
  -- strings, so left-pad them to compare as numbers)
  drop table if exists _n;
  drop table if exists _e;
  drop table if exists _s;
  create temp table _n (cid text primary key, lbl text) on commit drop;
  insert into _n (cid, lbl)
  select lpad(customer_id, 20, '0'), lpad(customer_id, 20, '0') from public.customers;

  create temp table _e (a text, b text) on commit drop;

  -- phone edges (star: every member linked to the group's lowest id)
  with k as (
    select c.customer_id as cid, public.norm_eg_phone(c.phone) as v
    from public.customers c
    left join public.customer_merge_overrides o on o.customer_id = c.customer_id
    where c.phone is not null
      and coalesce(o.keep_separate, false) = false
      and public.norm_eg_phone(c.phone) ~ '^[0-9]{10,15}$'
      and public.norm_eg_phone(c.phone) !~ '^(.)\1+$'
  ),
  g as (
    select v, min(lpad(cid, 20, '0')) as m
    from k group by v
    having count(*) > 1 and count(*) <= p_max_key_size
  )
  insert into _e (a, b)
  select lpad(k.cid, 20, '0'), g.m from k join g using (v)
  where lpad(k.cid, 20, '0') <> g.m;

  -- email edges
  with k as (
    select c.customer_id as cid, lower(trim(c.email)) as v
    from public.customers c
    left join public.customer_merge_overrides o on o.customer_id = c.customer_id
    where c.email is not null
      and coalesce(o.keep_separate, false) = false
      and trim(c.email) <> ''
      and position('@' in c.email) > 1
  ),
  g as (
    select v, min(lpad(cid, 20, '0')) as m
    from k group by v
    having count(*) > 1 and count(*) <= p_max_key_size
  )
  insert into _e (a, b)
  select lpad(k.cid, 20, '0'), g.m from k join g using (v)
  where lpad(k.cid, 20, '0') <> g.m;

  -- manual merges forced by a human
  insert into _e (a, b)
  select lpad(o.customer_id, 20, '0'), lpad(o.force_master, 20, '0')
  from public.customer_merge_overrides o
  join public.customers c1 on c1.customer_id = o.customer_id
  join public.customers c2 on c2.customer_id = o.force_master
  where o.force_master is not null and o.force_master <> o.customer_id;

  -- symmetric closure
  create temp table _s (a text, b text) on commit drop;
  insert into _s select a, b from _e union select b, a from _e;
  create index on _s (a);
  execute 'analyze _s';

  -- label propagation: every node takes the smallest label it can see.
  -- Converges when no node can lower its label, i.e. each connected
  -- component is entirely labelled with its smallest account id.
  loop
    v_iter := v_iter + 1;
    update _n n
    set lbl = x.m
    from (
      select s.a as cid, min(nb.lbl) as m
      from _s s join _n nb on nb.cid = s.b
      group by s.a
    ) x
    where x.cid = n.cid and x.m < n.lbl;
    get diagnostics v_changed = row_count;
    exit when v_changed = 0 or v_iter > 30;
  end loop;

  delete from public.customer_links;
  insert into public.customer_links (customer_id, master_id, match_reason, linked_at)
  select ltrim(n.cid, '0'), ltrim(n.lbl, '0'),
         case when n.cid = n.lbl then 'primary' else 'linked' end,
         now()
  from _n n;

  -- ---------------- aggregate one row per person ----------------
  -- (migration 071 injects the public.orders.master_id refresh here)
  delete from public.customer_identities;

  insert into public.customer_identities (
    master_id, accounts, account_ids, name, phone, email, city, area, addresses,
    birthdate, language, is_active, phones, emails, first_joined_at,
    lifetime_orders, lifetime_delivered, lifetime_canceled,
    lifetime_amount, lifetime_delivered_amount, lifetime_canceled_amount,
    last_order_at, last_order_state, last_delivered_at,
    app_orders, app_amount, first_order_at, last_app_order_at,
    recency_days, segment, has_stats, search_text, rebuilt_at
  )
  with acc as (
    select l.master_id, c.*
    from public.customer_links l
    join public.customers c on c.customer_id = l.customer_id
  ),
  ord as (
    select l.master_id,
      count(*) filter (where coalesce(o.order_status,'') not in ('Cancelled'))::int as app_orders,
      coalesce(sum(o.total_order_amount) filter (where coalesce(o.order_status,'') not in ('Cancelled')), 0) as app_amount,
      min(o.order_date) filter (where coalesce(o.order_status,'') not in ('Cancelled')) as first_order_at,
      max(o.order_date) filter (where coalesce(o.order_status,'') not in ('Cancelled')) as last_app_order_at
    from public.orders o
    join public.customer_links l on l.customer_id = o.customer_id
    where o.customer_id is not null and o.order_date is not null
    group by l.master_id
  ),
  agg as (
    select
      a.master_id,
      count(*)::int as accounts,
      array_agg(a.customer_id order by a.customer_id) as account_ids,
      -- the "face" of the person: newest real value across the group,
      -- preferring the account that ordered most recently
      (array_remove(array_agg(a.name  order by a.last_order_at desc nulls last, a.joined_at desc nulls last), null))[1] as pick_name,
      (array_remove(array_agg(a.phone order by a.last_order_at desc nulls last, a.joined_at desc nulls last), null))[1] as pick_phone,
      (array_remove(array_agg(a.email order by a.last_order_at desc nulls last, a.joined_at desc nulls last), null))[1] as pick_email,
      (array_remove(array_agg(a.city  order by a.last_order_at desc nulls last, a.joined_at desc nulls last), null))[1] as pick_city,
      (array_remove(array_agg(a.area  order by a.last_order_at desc nulls last, a.joined_at desc nulls last), null))[1] as pick_area,
      (array_remove(array_agg(a.addresses order by a.last_order_at desc nulls last, a.joined_at desc nulls last), null))[1] as pick_addresses,
      (array_remove(array_agg(a.last_order_state order by a.last_order_at desc nulls last), null))[1] as pick_state,
      array_remove(array_agg(distinct a.phone), null) as phones,
      array_remove(array_agg(distinct a.email), null) as emails,
      min(a.joined_at) as first_joined_at,
      min(a.birthdate) as birthdate,
      max(a.language) as language,
      bool_or(coalesce(a.is_active, true)) as is_active,
      coalesce(sum(a.lifetime_orders), 0)::int as lifetime_orders,
      coalesce(sum(a.lifetime_delivered), 0)::int as lifetime_delivered,
      coalesce(sum(a.lifetime_canceled), 0)::int as lifetime_canceled,
      coalesce(sum(a.lifetime_amount), 0) as lifetime_amount,
      coalesce(sum(a.lifetime_delivered_amount), 0) as lifetime_delivered_amount,
      coalesce(sum(a.lifetime_canceled_amount), 0) as lifetime_canceled_amount,
      max(a.last_order_at) as last_order_at,
      max(a.last_delivered_at) as last_delivered_at,
      bool_or(a.stats_updated_at is not null) as has_stats
    from acc a
    group by a.master_id
  )
  select
    g.master_id, g.accounts, g.account_ids,
    g.pick_name, g.pick_phone, g.pick_email, g.pick_city, g.pick_area, g.pick_addresses,
    g.birthdate, g.language, g.is_active, g.phones, g.emails, g.first_joined_at,
    g.lifetime_orders, g.lifetime_delivered, g.lifetime_canceled,
    g.lifetime_amount, g.lifetime_delivered_amount, g.lifetime_canceled_amount,
    g.last_order_at,
    g.pick_state,
    g.last_delivered_at,
    coalesce(o.app_orders, 0), coalesce(o.app_amount, 0),
    o.first_order_at, o.last_app_order_at,
    case when g.last_order_at is not null then (current_date - g.last_order_at)
         when o.last_app_order_at is not null then (current_date - o.last_app_order_at::date)
    end,
    public.rfm_segment(
      greatest(coalesce(g.lifetime_orders, 0) - coalesce(g.lifetime_canceled, 0), coalesce(o.app_orders, 0))::numeric,
      coalesce(
        case when g.last_order_at is not null then (current_date - g.last_order_at) end,
        case when o.last_app_order_at is not null then (current_date - o.last_app_order_at::date) end,
        99999
      )::numeric
    ),
    g.has_stats,
    lower(concat_ws(' ',
      g.pick_name,
      array_to_string(g.phones, ' '),
      array_to_string(
        (select array_agg(distinct public.norm_eg_phone(ph.v)) from unnest(g.phones) as ph(v)), ' '),
      array_to_string(g.emails, ' '),
      g.pick_city, g.pick_area, g.pick_addresses,
      array_to_string(g.account_ids, ' ')
    )),
    now()
  from agg g
  left join ord o on o.master_id = g.master_id;

  select count(*), count(*) filter (where accounts > 1), coalesce(sum(accounts - 1), 0)
    into v_people, v_merged, v_absorbed
  from public.customer_identities;

  execute 'analyze public.customer_identities';
  execute 'analyze public.customer_links';

  return jsonb_build_object(
    'accounts', (select count(*) from public.customers),
    'people', v_people,
    'merged_people', v_merged,
    'duplicate_accounts_absorbed', v_absorbed,
    'iterations', v_iter,
    'rebuilt_at', now()
  );
end;
$$;

-- ------------------------------------------------------------
-- 4. Manual merge / unmerge
-- ------------------------------------------------------------

-- Force a set of accounts to be one person. p_master must be one of
-- them (or an existing account); it becomes the surviving identity.
create or replace function public.fn_merge_customers(p_ids text[], p_master text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id text;
begin
  if not public.can_manage_identities() then
    raise exception 'Forbidden';
  end if;
  if p_master is null or array_length(p_ids, 1) is null then
    raise exception 'Nothing to merge';
  end if;
  if not exists (select 1 from public.customers where customer_id = p_master) then
    raise exception 'Unknown master account %', p_master;
  end if;

  foreach v_id in array p_ids loop
    if v_id <> p_master and exists (select 1 from public.customers where customer_id = v_id) then
      insert into public.customer_merge_overrides (customer_id, force_master, keep_separate, created_by)
      values (v_id, p_master, false, auth.uid())
      on conflict (customer_id) do update
        set force_master = excluded.force_master,
            keep_separate = false,
            created_by = excluded.created_by,
            created_at = now();
    end if;
  end loop;

  -- the master itself must not be pinned elsewhere
  delete from public.customer_merge_overrides where customer_id = p_master;

  return public.fn_rebuild_customer_identities();
end;
$$;

-- Pull one account back out of its group and never auto-merge it again.
create or replace function public.fn_split_customer(p_customer_id text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_identities() then
    raise exception 'Forbidden';
  end if;
  insert into public.customer_merge_overrides (customer_id, force_master, keep_separate, note, created_by)
  values (p_customer_id, null, true, p_note, auth.uid())
  on conflict (customer_id) do update
    set force_master = null, keep_separate = true,
        note = excluded.note, created_by = excluded.created_by, created_at = now();
  return public.fn_rebuild_customer_identities();
end;
$$;

-- Drop a manual rule (back to automatic behaviour).
create or replace function public.fn_clear_customer_override(p_customer_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_identities() then
    raise exception 'Forbidden';
  end if;
  delete from public.customer_merge_overrides where customer_id = p_customer_id;
  return public.fn_rebuild_customer_identities();
end;
$$;

-- ------------------------------------------------------------
-- 5. Reading identities: list + detail + headline numbers
-- ------------------------------------------------------------

create or replace function public.fn_identities_list(
  p_search      text    default null,
  p_segments    text[]  default null,
  p_cities      text[]  default null,
  p_states      text[]  default null,
  p_status      text    default null,   -- buyers | never | repeat | one_time | delivered_buyers
  p_min_orders  integer default null,
  p_max_orders  integer default null,
  p_min_spent   numeric default null,
  p_max_spent   numeric default null,
  p_last_from   date    default null,
  p_last_to     date    default null,
  p_joined_from date    default null,
  p_joined_to   date    default null,
  p_birth_month integer default null,
  p_has_email   boolean default null,
  p_has_phone   boolean default null,
  p_merged_only boolean default false,
  p_active      boolean default null,
  p_sort        text    default 'spent',
  p_dir         text    default 'desc',
  p_limit       integer default 25,
  p_offset      integer default 0
)
returns jsonb
language sql stable
set search_path = public
as $$
  with f as (
    select i.*
    from public.customer_identities i
    where (p_search is null or trim(p_search) = '' or i.search_text like '%' || lower(trim(p_search)) || '%')
      and (p_segments is null or cardinality(p_segments) = 0 or i.segment = any(p_segments))
      and (p_cities   is null or cardinality(p_cities) = 0   or coalesce(i.city,'—') = any(p_cities))
      and (p_states   is null or cardinality(p_states) = 0   or i.last_order_state = any(p_states))
      and (p_status is null or p_status = 'all'
           or (p_status = 'buyers'   and greatest(i.lifetime_orders, i.app_orders) > 0)
           or (p_status = 'never'    and greatest(i.lifetime_orders, i.app_orders) = 0)
           or (p_status = 'repeat'   and greatest(i.lifetime_delivered, i.app_orders) >= 2)
           or (p_status = 'one_time' and greatest(i.lifetime_delivered, i.app_orders) = 1)
           or (p_status = 'delivered_buyers' and i.lifetime_delivered > 0))
      and (p_min_orders is null or i.lifetime_orders >= p_min_orders)
      and (p_max_orders is null or i.lifetime_orders <= p_max_orders)
      and (p_min_spent  is null or i.lifetime_delivered_amount >= p_min_spent)
      and (p_max_spent  is null or i.lifetime_delivered_amount <= p_max_spent)
      and (p_last_from  is null or i.last_order_at >= p_last_from)
      and (p_last_to    is null or i.last_order_at <= p_last_to)
      and (p_joined_from is null or i.first_joined_at >= p_joined_from)
      and (p_joined_to   is null or i.first_joined_at < (p_joined_to + 1))
      and (p_birth_month is null or extract(month from i.birthdate) = p_birth_month)
      and (p_has_email is null or (cardinality(coalesce(i.emails, '{}'::text[])) > 0) = p_has_email)
      and (p_has_phone is null or (cardinality(coalesce(i.phones, '{}'::text[])) > 0) = p_has_phone)
      and (coalesce(p_merged_only, false) = false or i.accounts > 1)
      and (p_active is null or coalesce(i.is_active, true) = p_active)
  ),
  s as (
    select f.*,
      case lower(coalesce(p_sort,'spent'))
        when 'name' then null when 'city' then null
        when 'orders'    then f.lifetime_orders::numeric
        when 'delivered' then f.lifetime_delivered::numeric
        when 'accounts'  then f.accounts::numeric
        when 'recency'   then f.recency_days::numeric
        when 'last'      then extract(epoch from f.last_order_at)
        when 'joined'    then extract(epoch from f.first_joined_at)
        else f.lifetime_delivered_amount
      end as snum,
      case lower(coalesce(p_sort,'spent'))
        when 'name' then f.name when 'city' then f.city else null
      end as stxt
    from f
  ),
  page as (
    select * from s
    order by
      case when lower(coalesce(p_dir,'desc')) = 'asc'  then snum end asc  nulls last,
      case when lower(coalesce(p_dir,'desc')) <> 'asc' then snum end desc nulls last,
      case when lower(coalesce(p_dir,'desc')) = 'asc'  then stxt end asc  nulls last,
      case when lower(coalesce(p_dir,'desc')) <> 'asc' then stxt end desc nulls last,
      master_id
    limit greatest(coalesce(p_limit, 25), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(p) - 'search_text' - 'snum' - 'stxt') from page p
    ), '[]'::jsonb)
  );
$$;

-- Everything about one person. p_key accepts a master_id OR any of
-- the merged account ids, so existing links keep working.
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
               o.items_count, o.cancellation_reason, o.applied_offer
        from public.orders o
        join public.customer_links l on l.customer_id = o.customer_id, m
        where l.master_id = m.master_id
        order by o.order_date desc nulls last
        limit 500
      ) x
    ), '[]'::jsonb)
  );
$$;

-- Headline numbers for the Customers page, per PERSON. Deliberately
-- one pass over customer_identities: the naive version (a subquery
-- per figure plus a correlated NOT EXISTS) took ~6s.
create or replace function public.fn_identity_summary()
returns jsonb
language sql stable
set search_path = public
as $$
  with i as (
    select
      count(*) as people,
      count(*) filter (where accounts > 1) as merged_people,
      coalesce(sum(accounts - 1), 0) as duplicate_accounts,
      count(*) filter (where greatest(lifetime_orders, app_orders) > 0) as buyers,
      count(*) filter (where lifetime_delivered > 0) as delivered_buyers,
      count(*) filter (where greatest(lifetime_orders, app_orders) = 0) as never_ordered,
      count(*) filter (where lifetime_delivered >= 2) as repeat_buyers,
      count(*) filter (where lifetime_delivered = 1) as one_timers,
      coalesce(sum(lifetime_orders), 0) as lifetime_orders_total,
      coalesce(sum(lifetime_delivered), 0) as lifetime_delivered_total,
      coalesce(sum(lifetime_canceled), 0) as lifetime_canceled_total,
      coalesce(sum(lifetime_amount), 0) as lifetime_amount_total,
      coalesce(sum(lifetime_delivered_amount), 0) as delivered_amount_total,
      coalesce(sum(lifetime_canceled_amount), 0) as canceled_amount_total,
      round(coalesce(avg(lifetime_delivered_amount) filter (where lifetime_delivered > 0), 0), 0) as avg_ltv,
      round(coalesce(avg(lifetime_delivered) filter (where lifetime_delivered > 0), 0), 2) as avg_orders_per_person,
      max(rebuilt_at) as rebuilt_at
    from public.customer_identities
  ),
  c as (
    select count(*) as accounts,
      count(*) filter (where coalesce(lifetime_delivered, 0) >= 2) as repeat_buyers_unmerged,
      max(stats_updated_at) as stats_updated_at
    from public.customers
  ),
  -- people who only LOOK like repeat buyers once their duplicate
  -- accounts are combined: no single account of theirs reached 2
  per as (
    select l.master_id, max(coalesce(cu.lifetime_delivered, 0)) as best_single
    from public.customer_links l
    join public.customers cu on cu.customer_id = l.customer_id
    group by l.master_id
  ),
  hidden as (
    select count(*) as n
    from public.customer_identities ci
    join per p on p.master_id = ci.master_id
    where ci.accounts > 1 and ci.lifetime_delivered >= 2 and p.best_single < 2
  )
  select jsonb_build_object(
    'accounts', c.accounts,
    'people', i.people,
    'merged_people', i.merged_people,
    'duplicate_accounts', i.duplicate_accounts,
    'buyers', i.buyers,
    'delivered_buyers', i.delivered_buyers,
    'never_ordered', i.never_ordered,
    'repeat_buyers', i.repeat_buyers,
    'one_timers', i.one_timers,
    'repeat_buyers_unmerged', c.repeat_buyers_unmerged,
    'repeat_hidden_by_dupes', hidden.n,
    'lifetime_orders_total', i.lifetime_orders_total,
    'lifetime_delivered_total', i.lifetime_delivered_total,
    'lifetime_canceled_total', i.lifetime_canceled_total,
    'lifetime_amount_total', i.lifetime_amount_total,
    'delivered_amount_total', i.delivered_amount_total,
    'canceled_amount_total', i.canceled_amount_total,
    'avg_ltv', i.avg_ltv,
    'avg_orders_per_person', i.avg_orders_per_person,
    'stats_updated_at', c.stats_updated_at,
    'rebuilt_at', i.rebuilt_at
  )
  from i, c, hidden;
$$;
$

-- Distinct filter values for the UI dropdowns.
create or replace function public.fn_identity_filter_options()
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'cities', coalesce((
      select jsonb_agg(x.city order by x.n desc)
      from (select coalesce(city,'—') as city, count(*) n from public.customer_identities group by 1) x
    ), '[]'::jsonb),
    'states', coalesce((
      select jsonb_agg(x.st order by x.n desc)
      from (select last_order_state as st, count(*) n from public.customer_identities
            where last_order_state is not null group by 1) x
    ), '[]'::jsonb)
  );
$$;

-- ------------------------------------------------------------
-- 6. Every customer report, now per PERSON
-- ------------------------------------------------------------

create or replace function public.fn_customer_value_summary()
returns json
language sql stable
set search_path = public
as $$
  select public.fn_identity_summary()::json;
$$;

-- RFM stays order-driven (it is about behaviour in time) but groups
-- by person instead of by account.
create or replace function public.fn_rfm_summary()
returns table (
  segment text, customers bigint, total_revenue numeric,
  avg_orders numeric, avg_spend numeric, avg_recency_days numeric
)
language sql stable
set search_path = public
as $$
  with base as (
    select coalesce(l.master_id, o.customer_id) as mid,
      count(*) as freq,
      sum(o.total_order_amount) as monetary,
      extract(epoch from (now() - max(o.order_date))) / 86400.0 as recency
    from public.orders o
    left join public.customer_links l on l.customer_id = o.customer_id
    where o.customer_id is not null
      and coalesce(o.order_status,'') not in ('Cancelled')
      and o.order_date is not null
    group by 1
  ),
  seg as (select *, public.rfm_segment(freq::numeric, recency) as segment from base)
  select segment, count(*) as customers,
    coalesce(sum(monetary), 0) as total_revenue,
    round(avg(freq), 2) as avg_orders,
    round(coalesce(avg(monetary), 0), 0) as avg_spend,
    round(avg(recency), 0) as avg_recency_days
  from seg
  where segment is not null
  group by segment
  order by total_revenue desc;
$$;

create or replace function public.fn_rfm_customers(p_segment text, p_limit integer default 500)
returns table (
  customer_id text, customer_name text, customer_phone text, city text,
  orders bigint, total_spent numeric, last_order_date timestamptz, recency_days numeric
)
language sql stable
set search_path = public
as $$
  with base as (
    select coalesce(l.master_id, o.customer_id) as mid,
      count(*) as freq,
      sum(o.total_order_amount) as monetary,
      max(o.order_date) as last_order,
      max(o.customer_name) as fallback_name,
      max(o.customer_phone) as fallback_phone,
      max(o.city) as fallback_city,
      extract(epoch from (now() - max(o.order_date))) / 86400.0 as recency
    from public.orders o
    left join public.customer_links l on l.customer_id = o.customer_id
    where o.customer_id is not null
      and coalesce(o.order_status,'') not in ('Cancelled')
      and o.order_date is not null
    group by 1
  ),
  seg as (select *, public.rfm_segment(freq::numeric, recency) as segment from base)
  select
    s.mid,
    coalesce(i.name, s.fallback_name),
    coalesce(i.phone, s.fallback_phone),
    coalesce(i.city, s.fallback_city),
    s.freq,
    coalesce(s.monetary, 0),
    s.last_order,
    round(s.recency, 0)
  from seg s
  left join public.customer_identities i on i.master_id = s.mid
  where s.segment = p_segment
  order by s.monetary desc nulls last
  limit p_limit;
$$;

create or replace function public.fn_top_lifetime_customers(p_limit integer default 100)
returns table (
  customer_id text, name text, phone text, email text, city text,
  lifetime_orders integer, lifetime_delivered integer, lifetime_canceled integer,
  lifetime_amount numeric, lifetime_delivered_amount numeric,
  last_order_at date, last_order_state text, last_delivered_at date,
  accounts integer
)
language sql stable
set search_path = public
as $$
  select i.master_id, i.name, i.phone, i.email, i.city,
    i.lifetime_orders, i.lifetime_delivered, i.lifetime_canceled,
    i.lifetime_amount, i.lifetime_delivered_amount,
    i.last_order_at, i.last_order_state, i.last_delivered_at, i.accounts
  from public.customer_identities i
  where coalesce(i.lifetime_delivered_amount, 0) > 0
  order by i.lifetime_delivered_amount desc nulls last
  limit p_limit;
$$;

create or replace function public.fn_lifetime_city_stats(p_limit integer default 40)
returns table (
  city text, customers bigint, buyers bigint,
  delivered_orders bigint, delivered_amount numeric,
  canceled_orders bigint, canceled_amount numeric, avg_ltv numeric
)
language sql stable
set search_path = public
as $$
  select coalesce(i.city, '—') as city,
    count(*) as customers,
    count(*) filter (where i.lifetime_orders > 0) as buyers,
    coalesce(sum(i.lifetime_delivered), 0) as delivered_orders,
    coalesce(sum(i.lifetime_delivered_amount), 0) as delivered_amount,
    coalesce(sum(i.lifetime_canceled), 0) as canceled_orders,
    coalesce(sum(i.lifetime_canceled_amount), 0) as canceled_amount,
    round(coalesce(avg(i.lifetime_delivered_amount) filter (where i.lifetime_delivered > 0), 0), 0) as avg_ltv
  from public.customer_identities i
  where i.has_stats
  group by coalesce(i.city, '—')
  order by delivered_amount desc
  limit p_limit;
$$;

create or replace function public.fn_churned_vips(
  p_months integer default 6, p_min_delivered integer default 2, p_limit integer default 2000
)
returns table (
  customer_id text, name text, phone text, email text, city text,
  lifetime_delivered integer, lifetime_delivered_amount numeric,
  last_order_at date, last_order_state text
)
language sql stable
set search_path = public
as $$
  select i.master_id, i.name, i.phone, i.email, i.city,
    i.lifetime_delivered, i.lifetime_delivered_amount, i.last_order_at, i.last_order_state
  from public.customer_identities i
  where i.lifetime_delivered >= p_min_delivered
    and i.last_order_at is not null
    and i.last_order_at < (current_date - (p_months || ' months')::interval)
  order by i.lifetime_delivered_amount desc nulls last
  limit p_limit;
$$;

create or replace function public.fn_stuck_last_orders(p_limit integer default 2000)
returns table (
  customer_id text, name text, phone text, email text, city text,
  last_order_at date, last_order_state text,
  lifetime_orders integer, lifetime_delivered integer, lifetime_amount numeric
)
language sql stable
set search_path = public
as $$
  select i.master_id, i.name, i.phone, i.email, i.city,
    i.last_order_at, i.last_order_state,
    i.lifetime_orders, i.lifetime_delivered, i.lifetime_amount
  from public.customer_identities i
  where i.last_order_state is not null
    and i.last_order_state not in ('Delivered','Cancelled','Canceled')
  order by i.last_order_at desc nulls last
  limit p_limit;
$$;

create or replace function public.fn_never_purchased(p_limit integer default 25000)
returns table (
  customer_id text, name text, email text, phone text, city text,
  language text, joined_at timestamptz
)
language sql stable
set search_path = public
as $$
  select i.master_id, i.name, i.email, i.phone, i.city, i.language, i.first_joined_at
  from public.customer_identities i
  where i.lifetime_orders = 0
    and i.app_orders = 0
    and coalesce(i.is_active, true)
  order by i.first_joined_at desc nulls last
  limit p_limit;
$$;

create or replace function public.fn_birthdays(p_month integer default null, p_limit integer default 2000)
returns table (
  customer_id text, name text, phone text, email text, city text,
  birthdate date, birth_day integer, orders bigint, lifetime_orders integer,
  total_spent numeric, last_order timestamptz
)
language sql stable
set search_path = public
as $$
  select i.master_id, i.name, i.phone, i.email, i.city,
    i.birthdate,
    extract(day from i.birthdate)::integer as birth_day,
    i.app_orders::bigint as orders,
    greatest(i.lifetime_orders, i.app_orders) as lifetime_orders,
    greatest(i.lifetime_delivered_amount, i.app_amount) as total_spent,
    i.last_app_order_at as last_order
  from public.customer_identities i
  where i.birthdate is not null
    and extract(month from i.birthdate) = coalesce(p_month, extract(month from now()))
    and coalesce(i.is_active, true)
  order by birth_day, total_spent desc
  limit p_limit;
$$;

-- Period customer insights (Analytics / Insights / Reports) counted
-- per person, so "repeat customers" is finally the real number.
create or replace function public.fn_customer_insights(
  p_from timestamptz, p_to timestamptz
)
returns json
language sql stable
set search_path = public
as $$
  with c as (
    select coalesce(l.master_id, o.customer_id) as mid,
      count(*) as n, sum(o.total_order_amount) as spent
    from public.orders o
    left join public.customer_links l on l.customer_id = o.customer_id
    where o.customer_id is not null
      and (p_from is null or o.order_date >= p_from)
      and (p_to is null or o.order_date < p_to)
    group by 1
  ),
  a as (
    select count(*) as accounts
    from (
      select o.customer_id from public.orders o
      where o.customer_id is not null
        and (p_from is null or o.order_date >= p_from)
        and (p_to is null or o.order_date < p_to)
      group by 1
    ) x
  )
  select json_build_object(
    'total_customers', (select count(*) from c),
    'repeat_customers', (select count(*) from c where n > 1),
    'avg_orders_per_customer', (select coalesce(avg(n), 0) from c),
    'avg_spend_per_customer', (select coalesce(avg(spent), 0) from c),
    'accounts_before_merge', (select accounts from a),
    'duplicate_accounts', (select accounts from a) - (select count(*) from c)
  );
$$;

create or replace function public.fn_new_customers(
  p_from timestamptz, p_to timestamptz, p_limit integer default 100
)
returns table (
  customer_id text, name text, email text, phone text, city text,
  joined_at timestamptz, is_active boolean, lifetime_orders integer, lifetime_amount numeric
)
language sql stable
set search_path = public
as $$
  select i.master_id, i.name, i.email, i.phone, i.city,
    i.first_joined_at, i.is_active, i.lifetime_orders, i.lifetime_amount
  from public.customer_identities i
  where i.first_joined_at is not null
    and (p_from is null or i.first_joined_at >= p_from)
    and (p_to is null or i.first_joined_at < p_to)
  order by i.first_joined_at desc
  limit p_limit;
$$;

-- ------------------------------------------------------------
-- 7. Hardening (same rules as migration 014)
-- ------------------------------------------------------------
revoke execute on function public.fn_rebuild_customer_identities(integer) from public, anon;
revoke execute on function public.fn_merge_customers(text[], text) from public, anon;
revoke execute on function public.fn_split_customer(text, text) from public, anon;
revoke execute on function public.fn_clear_customer_override(text) from public, anon;
revoke execute on function public.can_manage_identities() from public, anon;
revoke execute on function public.fn_identities_list(text, text[], text[], text[], text, integer, integer, numeric, numeric, date, date, date, date, integer, boolean, boolean, boolean, boolean, text, text, integer, integer) from public, anon;
revoke execute on function public.fn_identity_detail(text) from public, anon;
revoke execute on function public.fn_identity_summary() from public, anon;
revoke execute on function public.fn_identity_filter_options() from public, anon;
revoke execute on function public.fn_customer_value_summary() from public, anon;
revoke execute on function public.fn_top_lifetime_customers(integer) from public, anon;
revoke execute on function public.fn_lifetime_city_stats(integer) from public, anon;
revoke execute on function public.fn_churned_vips(integer, integer, integer) from public, anon;
revoke execute on function public.fn_stuck_last_orders(integer) from public, anon;
revoke execute on function public.fn_never_purchased(integer) from public, anon;
revoke execute on function public.fn_birthdays(integer, integer) from public, anon;
revoke execute on function public.fn_customer_insights(timestamptz, timestamptz) from public, anon;
revoke execute on function public.fn_new_customers(timestamptz, timestamptz, integer) from public, anon;
