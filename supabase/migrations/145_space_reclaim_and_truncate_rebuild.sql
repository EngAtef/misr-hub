-- ============================================================
-- 145: reclaim database space (Free plan 500 MB limit, 657 MB used)
--
-- 1. Indexes with zero reads since stats reset (2026-06-30) and one exact
--    duplicate of a primary key: 62 MB.
--      idx_ci_search   42 MB  gin trgm on customer_identities.search_text —
--                             never used: the search predicate sits inside
--                             "(p_search is null or search_text like ...)",
--                             which the planner cannot serve from an index
--      idx_ci_birth, idx_events_date, idx_events_admin — zero reads
--      idx_product_sales_order_sku — identical to product_sales_pkey
--
-- 2. fn_rebuild_customer_identities stops bloating the two tables it owns.
--    It deleted and re-inserted every row (heap at 2.1x, indexes likewise).
--    Now it builds the new rows into temp tables and swaps with TRUNCATE +
--    INSERT at the very end, so the exclusive lock lasts seconds instead of
--    the whole run, and the tables never hold dead rows.
--    The migration-111 statement trigger (first/last source per person,
--    ~30 s scan of orders) is folded into the build step and dropped, so it
--    no longer runs inside the lock window. fn_refresh_identity_sources()
--    stays for the attribution refresh that calls it directly.
--
-- After this migration run, outside a transaction:
--    vacuum full public.customer_identities; ... (see the session notes)
-- ============================================================

drop index if exists public.idx_ci_search;
drop index if exists public.idx_ci_birth;
drop index if exists public.idx_events_date;
drop index if exists public.idx_events_admin;
drop index if exists public.idx_product_sales_order_sku;

drop trigger if exists trg_identity_sources on public.customer_identities;

create or replace function public.fn_rebuild_customer_identities(p_max_key_size integer default 60)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  drop table if exists _n;
  drop table if exists _e;
  drop table if exists _s;
  drop table if exists _links_new;
  drop table if exists _ident_new;

  create temp table _n (cid text primary key, lbl text) on commit drop;
  insert into _n (cid, lbl)
  select lpad(customer_id, 20, '0'), lpad(customer_id, 20, '0') from public.customers;

  create temp table _e (a text, b text) on commit drop;

  with k as (
    select c.customer_id as cid, public.norm_phone_key(c.phone) as v
    from public.customers c
    left join public.customer_merge_overrides o on o.customer_id = c.customer_id
    where c.phone is not null
      and coalesce(o.keep_separate, false) = false
      and public.norm_phone_key(c.phone) ~ '^[0-9]{10,15}$'
      and public.norm_phone_key(c.phone) !~ '^(.)\1+$'
  ),
  g as (
    select v, min(lpad(cid, 20, '0')) as m
    from k group by v
    having count(*) > 1 and count(*) <= p_max_key_size
  )
  insert into _e (a, b)
  select lpad(k.cid, 20, '0'), g.m from k join g using (v)
  where lpad(k.cid, 20, '0') <> g.m;

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

  insert into _e (a, b)
  select lpad(o.customer_id, 20, '0'), lpad(o.force_master, 20, '0')
  from public.customer_merge_overrides o
  join public.customers c1 on c1.customer_id = o.customer_id
  join public.customers c2 on c2.customer_id = o.force_master
  where o.force_master is not null and o.force_master <> o.customer_id;

  create temp table _s (a text, b text) on commit drop;
  insert into _s select a, b from _e union select b, a from _e;
  create index on _s (a);
  execute 'analyze _s';

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

  -- ---------------- new links, built aside ----------------
  create temp table _links_new on commit drop as
  select ltrim(n.cid, '0') as customer_id, ltrim(n.lbl, '0') as master_id,
         case when n.cid = n.lbl then 'primary' else 'linked' end as match_reason,
         now() as linked_at
  from _n n;
  create index on _links_new (customer_id);
  create index on _links_new (master_id);
  execute 'analyze _links_new';

  update public.orders o
  set master_id = l.master_id
  from _links_new l
  where l.customer_id = o.customer_id
    and o.master_id is distinct from l.master_id;

  -- ---------------- one row per person, built aside ----------------
  create temp table _ident_new on commit drop as
  with acc as (
    select l.master_id, c.*
    from _links_new l
    join public.customers c on c.customer_id = l.customer_id
  ),
  ord as (
    select l.master_id,
      count(*) filter (where coalesce(o.order_status,'') not in ('Cancelled'))::int as app_orders,
      coalesce(sum(o.total_order_amount) filter (where coalesce(o.order_status,'') not in ('Cancelled')), 0) as app_amount,
      min(o.order_date) filter (where coalesce(o.order_status,'') not in ('Cancelled')) as first_order_at,
      max(o.order_date) filter (where coalesce(o.order_status,'') not in ('Cancelled')) as last_app_order_at
    from public.orders o
    join _links_new l on l.customer_id = o.customer_id
    where o.customer_id is not null and o.order_date is not null
    group by l.master_id
  ),
  agg as (
    select
      a.master_id,
      count(*)::int as accounts,
      array_agg(a.customer_id order by a.customer_id) as account_ids,
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
  ),
  src as (
    select o.master_id,
           (array_agg(o.attr_bucket order by o.order_date asc  nulls last))[1] as first_source,
           (array_agg(o.attr_bucket order by o.order_date desc nulls last))[1] as last_source
    from public.orders o
    where o.master_id is not null and o.order_date is not null
      and coalesce(o.order_status, '') <> 'Cancelled'
    group by o.master_id
  )
  select
    g.master_id, g.accounts, g.account_ids,
    g.pick_name as name, g.pick_phone as phone, g.pick_email as email,
    g.pick_city as city, g.pick_area as area, g.pick_addresses as addresses,
    g.birthdate, g.language, g.is_active, g.phones, g.emails, g.first_joined_at,
    g.lifetime_orders, g.lifetime_delivered, g.lifetime_canceled,
    g.lifetime_amount, g.lifetime_delivered_amount, g.lifetime_canceled_amount,
    g.last_order_at,
    g.pick_state as last_order_state,
    g.last_delivered_at,
    coalesce(o.app_orders, 0) as app_orders, coalesce(o.app_amount, 0) as app_amount,
    o.first_order_at, o.last_app_order_at,
    case when g.last_order_at is not null then (current_date - g.last_order_at)
         when o.last_app_order_at is not null then (current_date - o.last_app_order_at::date)
    end as recency_days,
    public.rfm_segment(
      greatest(coalesce(g.lifetime_orders, 0) - coalesce(g.lifetime_canceled, 0), coalesce(o.app_orders, 0))::numeric,
      coalesce(
        case when g.last_order_at is not null then (current_date - g.last_order_at) end,
        case when o.last_app_order_at is not null then (current_date - o.last_app_order_at::date) end,
        99999
      )::numeric
    ) as segment,
    g.has_stats,
    lower(concat_ws(' ',
      g.pick_name,
      array_to_string(g.phones, ' '),
      array_to_string(
        (select array_agg(distinct public.norm_phone_key(ph.v)) from unnest(g.phones) as ph(v)), ' '),
      array_to_string(g.emails, ' '),
      g.pick_city, g.pick_area, g.pick_addresses,
      array_to_string(g.account_ids, ' ')
    )) as search_text,
    now() as rebuilt_at,
    s.first_source, s.last_source
  from agg g
  left join ord o on o.master_id = g.master_id
  left join src s on s.master_id = g.master_id;

  -- ---------------- swap: seconds of exclusive lock, no dead rows ----------------
  truncate table public.customer_links, public.customer_identities;

  insert into public.customer_links (customer_id, master_id, match_reason, linked_at)
  select customer_id, master_id, match_reason, linked_at from _links_new;

  insert into public.customer_identities (
    master_id, accounts, account_ids, name, phone, email, city, area, addresses,
    birthdate, language, is_active, phones, emails, first_joined_at,
    lifetime_orders, lifetime_delivered, lifetime_canceled,
    lifetime_amount, lifetime_delivered_amount, lifetime_canceled_amount,
    last_order_at, last_order_state, last_delivered_at,
    app_orders, app_amount, first_order_at, last_app_order_at,
    recency_days, segment, has_stats, search_text, rebuilt_at,
    first_source, last_source
  )
  select
    master_id, accounts, account_ids, name, phone, email, city, area, addresses,
    birthdate, language, is_active, phones, emails, first_joined_at,
    lifetime_orders, lifetime_delivered, lifetime_canceled,
    lifetime_amount, lifetime_delivered_amount, lifetime_canceled_amount,
    last_order_at, last_order_state, last_delivered_at,
    app_orders, app_amount, first_order_at, last_app_order_at,
    recency_days, segment, has_stats, search_text, rebuilt_at,
    first_source, last_source
  from _ident_new;

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
$function$;

revoke execute on function public.fn_rebuild_customer_identities(integer) from public, anon;
