-- 080_ads_custom_lists.sql — custom lists as first-class ad destinations
--
-- The store's ads don't link to a single product page. They link to a CUSTOM
-- LIST built on the e-commerce site — /ar/products/list/<slug> — which holds
-- anywhere from 5 to 60 books. So the honest unit of ad attribution isn't "the
-- book this ad promotes", it's "the set of books this ad sends traffic to".
--
-- Three identifiers describe the same list and each arrives from a different
-- place, which is why all three are stored:
--
--   list_id   the numeric id in the platform's list export (82, 289, ...)
--   slug      the URL segment the ad actually links to (reem, classic-1, ...)
--   name      the display name — only present in the export's FILE NAME
--
-- The export gives us list_id + items. The ad's link gives us the slug. The
-- slug is therefore attached once per list (by hand, or auto-detected from an
-- ad's destination URL) and from then on any ad linking to that URL resolves
-- to the list without further work.
--
-- Attribution is unchanged from 074/078: an ad maps to a `book_label`, which
-- owns exactly one pool of real store sales, split across its ads by spend
-- share. A list mapping simply resolves to the list's SKUs instead of a
-- hand-picked few, so one list = one revenue pool = one book_label.

-- ---------------------------------------------------------------- tables

create table if not exists public.custom_lists (
  id uuid primary key default gen_random_uuid(),
  list_id integer,                          -- from the platform export
  slug text,                                -- URL segment used in the ad link
  name text not null,
  product_type text not null default 'main',
  item_count integer not null default 0,
  file_name text,
  note text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- partial uniques: a list may be known by its id, its slug, or both
create unique index if not exists uq_custom_lists_list_id
  on public.custom_lists (list_id) where list_id is not null;
create unique index if not exists uq_custom_lists_slug
  on public.custom_lists (lower(slug)) where slug is not null;

-- sort_order, not "position": `position` is reserved in a RETURNS TABLE / record
-- column definition list, which the reader functions below both need
create table if not exists public.custom_list_items (
  list_key uuid not null references public.custom_lists (id) on delete cascade,
  sku text not null,                        -- store SKU, prefix stripped
  raw_sku text,                             -- exactly as exported: main_C0109...
  product_name text,
  sort_order integer,                       -- the export's `order` column
  primary key (list_key, sku)
);

create index if not exists idx_custom_list_items_sku on public.custom_list_items (sku);

-- ------------------------------------------------------- mapping columns

-- An ad can now be connected three ways. `book` keeps the original behaviour
-- (hand-picked SKUs or a keyword); `list` resolves its SKUs from the list;
-- `link` records the destination URL the ad points at and resolves through it.
-- on delete cascade, not set null: a mapping exists only to describe a
-- connection, so if the list it points at is gone the connection is gone and
-- the ad must return to the unmapped backlog. Left dangling it would instead
-- read as "mapped, earned nothing", which is a lie the whole page would repeat.
alter table public.ad_book_map
  add column if not exists target_kind text not null default 'book',
  add column if not exists list_key uuid references public.custom_lists (id) on delete cascade,
  add column if not exists dest_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ad_book_map_target_kind_check') then
    alter table public.ad_book_map
      add constraint ad_book_map_target_kind_check
      check (target_kind in ('book', 'list', 'link'));
  end if;
end $$;

create index if not exists idx_ad_book_map_list on public.ad_book_map (list_key);

-- the destination URL as it came out of the Meta export, when the export
-- carries the column at all — this is what makes auto-linking possible
alter table public.ad_insights
  add column if not exists dest_url text;

-- ------------------------------------------------------------------ RLS

alter table public.custom_lists enable row level security;
alter table public.custom_list_items enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['custom_lists', 'custom_list_items'] loop
    execute format('drop policy if exists %I on public.%I', tbl || '_read', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_write', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_update', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_delete', tbl);
    execute format('drop policy if exists backup_reader_read on public.%I', tbl);
    -- (select my_role()) is the init-plan form: evaluated once, not per row
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

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'backup_reader') then
    execute 'create policy backup_reader_read on public.custom_lists for select to backup_reader using (true)';
    execute 'create policy backup_reader_read on public.custom_list_items for select to backup_reader using (true)';
    execute 'grant select on public.custom_lists, public.custom_list_items to backup_reader';
  end if;
end $$;

-- ----------------------------------------------------------- URL parsing

-- Pulls the meaningful part out of an ad's destination URL.
--   .../ar/products/list/kalam-saleem?utm_source=..  -> ('list', 'kalam-saleem')
--   .../ar/products/c011021110492p                  -> ('product', 'c011021110492p')
-- Query strings, fragments, trailing slashes and locale prefixes are ignored,
-- so the same list resolves whether the ad linked /ar/ or /en/.
create or replace function public.parse_dest_url(p_url text)
returns table (kind text, ref text)
language sql
immutable
set search_path to 'public'
as $$
  with clean as (
    -- strip protocol+host, query and fragment, then collapse trailing slashes
    select regexp_replace(
             regexp_replace(
               regexp_replace(coalesce(p_url, ''), '^\s*[a-z]+://[^/]*', '', 'i'),
               '[?#].*$', ''),
             '/+$', '') as path
  )
  select case when position('/products/list/' in lower(c.path)) > 0 then 'list'
              when position('/products/' in lower(c.path)) > 0 then 'product'
              end,
         case when position('/products/list/' in lower(c.path)) > 0
                then nullif(split_part(substring(c.path from position('/products/list/' in lower(c.path))), '/', 4), '')
              when position('/products/' in lower(c.path)) > 0
                then nullif(split_part(substring(c.path from position('/products/' in lower(c.path))), '/', 3), '')
              end
  from clean c
  where coalesce(p_url, '') <> '';
$$;

-- Resolve a pasted link to something the app can connect an ad to.
create or replace function public.fn_ads_link_resolve(p_url text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with gate as (select (select public.my_role()) in ('admin', 'manager', 'viewer') as ok),
  p as (select kind, ref from public.parse_dest_url(p_url)),
  lst as (
    select c.id, c.name, c.list_id, c.slug, c.item_count
    from p join public.custom_lists c on lower(c.slug) = lower(p.ref)
    where p.kind = 'list'
  ),
  prod as (
    -- a product page: the segment is usually the SKU, sometimes the name slug
    select coalesce(s.sku, pr.sku) as sku, coalesce(s.product_name, pr.name) as product_name
    from p
    left join public.stock_items s on lower(s.sku) = lower(p.ref)
    left join public.products pr on lower(pr.sku) = lower(p.ref) or pr.link = p.ref
    where p.kind = 'product' and coalesce(s.sku, pr.sku) is not null
    limit 1
  )
  select case when not (select ok from gate) then '{}'::jsonb else jsonb_build_object(
    'url', p_url,
    'kind', coalesce((select 'list' from lst limit 1), (select 'product' from prod limit 1), (select p.kind from p), 'unknown'),
    'ref', (select p.ref from p),
    'list_key', (select id from lst limit 1),
    'list_name', (select name from lst limit 1),
    'list_id', (select list_id from lst limit 1),
    'list_items', (select item_count from lst limit 1),
    'sku', (select sku from prod limit 1),
    'product_name', (select product_name from prod limit 1)
  ) end;
$$;

-- --------------------------------------------------- the effective mapping
--
-- Everything downstream (insights, gap, unmapped) reads this instead of
-- ad_book_map, so the "which SKUs does this ad cover" question is answered in
-- exactly one place: a list mapping expands to the list's items, a book
-- mapping keeps its hand-picked SKUs.
create or replace view public.ad_map_effective
with (security_invoker = true) as
  select m.id,
         m.match_level,
         m.pattern,
         m.raw_name,
         m.book_label,
         case when m.target_kind = 'list' then li.skus else m.skus end as skus,
         -- a list resolves by SKU, so its keyword must not also fire
         case when m.target_kind = 'list' then null else m.keyword end as keyword,
         m.is_auto,
         m.active,
         m.updated_at,
         m.target_kind,
         m.list_key,
         m.dest_url,
         c.name as list_name,
         c.slug as list_slug,
         c.list_id,
         coalesce(array_length(li.skus, 1), 0) as list_items
  from public.ad_book_map m
  left join public.custom_lists c on c.id = m.list_key
  left join lateral (
    select array_agg(distinct i.sku) as skus
    from public.custom_list_items i
    where i.list_key = m.list_key
  ) li on true;

grant select on public.ad_map_effective to authenticated;

-- ------------------------------------------------------------ list import
--
-- p_lists is one entry per list found in the uploaded file:
--   [{ list_id, name, slug, product_type, items: [{sku, raw_sku, product_name, sort_order}] }]
-- A list already known by its id (or slug) is refreshed in place — its items
-- are replaced wholesale, because a list export is a full snapshot — and any
-- slug already attached to it survives a re-upload that doesn't carry one.
create or replace function public.fn_custom_lists_import(p_file text, p_lists jsonb)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  r record;
  v_key uuid;
  v_lists integer := 0;
  v_items integer := 0;
  v_n integer;
begin
  if p_lists is null or jsonb_typeof(p_lists) <> 'array' or jsonb_array_length(p_lists) = 0 then
    raise exception 'no lists in payload';
  end if;

  for r in
    select (l ->> 'list_id')::integer as list_id,
           nullif(btrim(l ->> 'name'), '') as name,
           nullif(btrim(l ->> 'slug'), '') as slug,
           coalesce(nullif(btrim(l ->> 'product_type'), ''), 'main') as product_type,
           l -> 'items' as items
    from jsonb_array_elements(coalesce(p_lists, '[]'::jsonb)) as l
  loop
    -- find an existing list by id first, then by slug
    select id into v_key from public.custom_lists
     where r.list_id is not null and list_id = r.list_id;
    if v_key is null and r.slug is not null then
      select id into v_key from public.custom_lists where lower(slug) = lower(r.slug);
    end if;

    if v_key is null then
      insert into public.custom_lists (list_id, slug, name, product_type, file_name, updated_by)
      values (r.list_id, r.slug,
              coalesce(r.name, 'List ' || coalesce(r.list_id::text, '?')),
              r.product_type, p_file, auth.uid())
      returning id into v_key;
    else
      update public.custom_lists
         set list_id = coalesce(r.list_id, list_id),
             slug = coalesce(r.slug, slug),          -- never lose an attached slug
             name = coalesce(r.name, name),
             product_type = r.product_type,
             file_name = p_file,
             updated_by = auth.uid(),
             updated_at = now()
       where id = v_key;
    end if;

    delete from public.custom_list_items where list_key = v_key;

    -- distinct on: a list export can repeat a SKU, and ON CONFLICT cannot
    -- touch the same row twice inside one INSERT
    insert into public.custom_list_items (list_key, sku, raw_sku, product_name, sort_order)
    select distinct on (i.sku) v_key, i.sku, i.raw_sku, i.product_name, i.sort_order
    from jsonb_to_recordset(coalesce(r.items, '[]'::jsonb))
      as i (sku text, raw_sku text, product_name text, sort_order integer)
    where coalesce(btrim(i.sku), '') <> ''
    order by i.sku, i.sort_order nulls last
    on conflict (list_key, sku) do nothing;

    select count(*) into v_n from public.custom_list_items where list_key = v_key;
    update public.custom_lists set item_count = v_n where id = v_key;

    v_lists := v_lists + 1;
    v_items := v_items + v_n;
  end loop;

  return jsonb_build_object('lists', v_lists, 'items', v_items);
end $$;

revoke all on function public.fn_custom_lists_import(text, jsonb) from public, anon;
grant execute on function public.fn_custom_lists_import(text, jsonb) to authenticated;

-- rename a list / attach the slug its ads link to
create or replace function public.fn_custom_list_set(
  p_id uuid,
  p_name text default null,
  p_slug text default null,
  p_note text default null
)
returns void
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  update public.custom_lists
     set name = coalesce(nullif(btrim(p_name), ''), name),
         -- '' clears the slug, null leaves it alone
         slug = case when p_slug is null then slug
                     else nullif(btrim(regexp_replace(p_slug, '^.*/products/list/', '')), '') end,
         note = case when p_note is null then note else nullif(btrim(p_note), '') end,
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_id;
end $$;

revoke all on function public.fn_custom_list_set(uuid, text, text, text) from public, anon;
grant execute on function public.fn_custom_list_set(uuid, text, text, text) to authenticated;

-- ------------------------------------------------------- list performance
--
-- One row per list: what it holds, what it cost, and what its books actually
-- sold in the window. Store sales are the list's own SKUs — the same measure
-- the Books tab uses — so a list's revenue can be compared to its ad spend
-- directly. GA4 landing-page traffic is monthly, so it is reported for the
-- months the window touches and is a context number, not a windowed one.
-- dropped first: the column list has changed since this migration was first
-- applied, and `create or replace` cannot alter a function's return type
drop function if exists public.fn_custom_lists_overview(date, date);

create or replace function public.fn_custom_lists_overview(p_from date default null, p_to date default null)
returns table (
  id uuid, list_id integer, slug text, name text, note text,
  item_count integer, known_items bigint,
  in_stock bigint, out_of_stock bigint, unknown_items bigint, stock_units numeric,
  ads bigint, campaigns text[], accounts text[], spend numeric,
  meta_purchases numeric, meta_value numeric,
  page_views numeric, page_atc numeric, page_revenue numeric,
  orders bigint, units numeric, revenue numeric, net_revenue numeric,
  cancelled_orders bigint, buyers bigint,
  roas numeric, cpa numeric, cancel_rate numeric,
  stock_health text,
  file_name text, updated_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with bounds as (
    -- `(p_from is null or o.order_date >= p_from)` reads naturally but forces a
    -- generic plan the date index can't be used for; coalescing to infinity
    -- keeps it a plain range predicate
    select coalesce(p_from, '-infinity'::date) as lo,
           coalesce(p_to + 1, 'infinity'::date) as hi
  ),
  lists as (
    -- the role gate: no role -> no lists -> empty result, not an error
    select c.* from public.custom_lists c
    where (select public.my_role()) in ('admin', 'manager', 'viewer')
  ),
  items as (
    select i.list_key, i.sku from public.custom_list_items i
    join lists l on l.id = i.list_key
  ),
  live_skus as materialized (
    select distinct sku from items
  ),
  catalog as (
    select it.list_key,
           count(*) filter (where s.sku is not null) as known_items,
           count(*) filter (where coalesce(s.ecom_stock, 0) > 0) as in_stock,
           -- a book absent from stock_items is UNKNOWN, not out of stock —
           -- counting it as out of stock is what made big lists look alarming
           count(*) filter (where s.sku is not null and coalesce(s.ecom_stock, 0) <= 0) as out_of_stock,
           count(*) filter (where s.sku is null) as unknown_items,
           coalesce(sum(s.ecom_stock), 0) as stock_units
    from items it
    left join public.stock_items s on s.sku = it.sku
    group by 1
  ),
  ad_spend_by_list as (
    select coalesce(ma.list_key, mc.list_key) as list_key,
           count(*) as ads,
           array_agg(distinct i.campaign_name) filter (where i.campaign_name is not null) as campaigns,
           array_agg(distinct i.account_label) as accounts,
           coalesce(sum(i.spend), 0) as spend,
           coalesce(sum(i.purchases), 0) as meta_purchases,
           coalesce(sum(i.conversion_value), 0) as meta_value
    from public.ad_insights i
    left join public.ad_map_effective ma
      on ma.match_level = 'ad' and ma.active and ma.pattern = public.norm_ad(i.ad_name)
    left join public.ad_map_effective mc
      on mc.match_level = 'campaign' and mc.active and mc.pattern = public.norm_ad(i.campaign_name)
    where (select public.my_role()) in ('admin', 'manager', 'viewer')
      and i.level = 'ad'
      and (p_from is null or i.period_end >= p_from)
      and (p_to is null or i.period_start <= p_to)
      and coalesce(ma.list_key, mc.list_key) is not null
    group by 1
  ),
  -- ONE pass over the orders, keyed by SKU only. Joining per list membership
  -- instead re-read the same orders for every list a SKU belongs to (3.5k SKUs
  -- but 12.4k memberships) and pushed the all-time window to 7s — near enough
  -- the 8s statement timeout to surface as an empty page instead of an error.
  rows_in_window as materialized (
    select oi.sku, oi.order_number, oi.price, o.order_status,
           coalesce(o.master_id, o.customer_id, o.order_number) as person,
           coalesce(ps.quantity, 1) as qty
    from live_skus ls
    cross join bounds b
    join public.order_items oi on oi.sku = ls.sku
    join public.orders o
      on o.order_number = oi.order_number
     and o.order_date >= b.lo
     and o.order_date < b.hi
    left join public.product_sales ps on ps.order_id = oi.order_number and ps.sku = oi.sku
  ),
  sku_money as (
    select r.sku,
           coalesce(sum(r.qty) filter (where r.order_status <> 'Cancelled'), 0) as units,
           coalesce(sum(r.price) filter (where r.order_status <> 'Cancelled'), 0) as revenue,
           coalesce(sum(r.price) filter (
             where r.order_status not in ('Cancelled', 'Returned', 'Return Request', 'Return Sent To Erp', 'Delivery Failed')), 0) as net_revenue
    from rows_in_window r
    group by 1
  ),
  -- money is additive across a list's SKUs, so summing per-SKU totals is exact
  list_money as (
    select it.list_key,
           coalesce(sum(m.units), 0) as units,
           coalesce(sum(m.revenue), 0) as revenue,
           coalesce(sum(m.net_revenue), 0) as net_revenue
    from items it
    join sku_money m on m.sku = it.sku
    group by 1
  ),
  -- distinct counts genuinely need the fan-out (two books of the same list in
  -- one order are still ONE order), but over slim pairs with no price or
  -- product_sales join hanging off them
  sku_orders as materialized (
    select distinct sku, order_number, order_status, person from rows_in_window
  ),
  list_orders as (
    select it.list_key,
           count(distinct so.order_number) filter (where so.order_status <> 'Cancelled') as orders,
           count(distinct so.order_number) filter (where so.order_status = 'Cancelled') as cancelled_orders,
           count(distinct so.person) filter (where so.order_status <> 'Cancelled') as buyers
    from items it
    join sku_orders so on so.sku = it.sku
    group by 1
  ),
  ga4 as (
    select l.id as list_key,
           sum(g.views) as views,
           sum(g.add_to_carts) as atc,
           sum(g.total_revenue) as revenue
    from lists l
    join public.ga4_pages g
      on g.page_path like '%/products/list/%'
     and lower(split_part(g.page_path, '/products/list/', 2)) = lower(l.slug)
    where l.slug is not null
      and (p_from is null or g.period_month >= date_trunc('month', p_from)::date)
      and (p_to is null or g.period_month <= date_trunc('month', p_to)::date)
    group by 1
  )
  select l.id, l.list_id, l.slug, l.name, l.note,
         l.item_count,
         coalesce(cat.known_items, 0),
         coalesce(cat.in_stock, 0), coalesce(cat.out_of_stock, 0), coalesce(cat.unknown_items, 0),
         coalesce(cat.stock_units, 0),
         coalesce(a.ads, 0), a.campaigns, a.accounts, coalesce(a.spend, 0),
         coalesce(a.meta_purchases, 0), coalesce(a.meta_value, 0),
         g.views, g.atc, g.revenue,
         coalesce(o.orders, 0), coalesce(mn.units, 0),
         round(coalesce(mn.revenue, 0), 2), round(coalesce(mn.net_revenue, 0), 2),
         coalesce(o.cancelled_orders, 0), coalesce(o.buyers, 0),
         case when coalesce(a.spend, 0) > 0 then round(coalesce(mn.revenue, 0) / a.spend, 2) end as roas,
         case when coalesce(o.orders, 0) > 0 and coalesce(a.spend, 0) > 0
              then round(a.spend / o.orders, 2) end as cpa,
         case when coalesce(o.orders, 0) + coalesce(o.cancelled_orders, 0) > 0
              then round(o.cancelled_orders * 100.0 / (o.orders + o.cancelled_orders), 1) end as cancel_rate,
         -- Stock is not pass/fail. A 10-book list with 5 in stock is a fine ad
         -- — there are still 5 things to sell. What matters is how many remain
         -- SELLABLE, and only when that reaches one (or none) does the ad need
         -- pausing or the list restocking. Judged on depletion, not list size:
         -- 2-of-2 available is healthy, 2-of-40 is not.
         case
           when coalesce(cat.known_items, 0) = 0 then 'unknown'
           when coalesce(cat.in_stock, 0) = 0 then 'empty'
           when coalesce(cat.in_stock, 0) = 1 and l.item_count > 1 then 'last_book'
           when coalesce(cat.in_stock, 0) = 2 and coalesce(cat.out_of_stock, 0) > 0 then 'thin'
           else 'ok'
         end as stock_health,
         l.file_name, l.updated_at
  from lists l
  left join catalog cat on cat.list_key = l.id
  left join ad_spend_by_list a on a.list_key = l.id
  left join list_money mn on mn.list_key = l.id
  left join list_orders o on o.list_key = l.id
  left join ga4 g on g.list_key = l.id
  order by coalesce(a.spend, 0) desc, coalesce(mn.revenue, 0) desc, l.name;
$$;

-- Drill-down: every book inside one list, with how it sold in the window.
create or replace function public.fn_custom_list_items(
  p_list uuid,
  p_from date default null,
  p_to date default null
)
returns table (
  sku text, product_name text, sort_order integer, in_catalog boolean,
  ecom_stock integer, price numeric,
  orders bigint, units numeric, revenue numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with bounds as (
    -- same reason as the overview: a coalesced range beats `is null or …`,
    -- which took the 3,511-book list's drill-down from 7.1s to 0.8s
    select coalesce(p_from, '-infinity'::date) as lo,
           coalesce(p_to + 1, 'infinity'::date) as hi
  ),
  items as (
    select i.sku, i.product_name, i.sort_order
    from public.custom_list_items i
    where (select public.my_role()) in ('admin', 'manager', 'viewer')
      and i.list_key = p_list
  ),
  sold as (
    select oi.sku,
           count(distinct oi.order_number) filter (where o.order_status <> 'Cancelled') as orders,
           coalesce(sum(coalesce(ps.quantity, 1)) filter (where o.order_status <> 'Cancelled'), 0) as units,
           coalesce(sum(oi.price) filter (where o.order_status <> 'Cancelled'), 0) as revenue
    from items it
    cross join bounds b
    join public.order_items oi on oi.sku = it.sku
    join public.orders o
      on o.order_number = oi.order_number
     and o.order_date >= b.lo
     and o.order_date < b.hi
    left join public.product_sales ps on ps.order_id = oi.order_number and ps.sku = oi.sku
    group by 1
  )
  select it.sku,
         coalesce(nullif(btrim(it.product_name), ''), s.product_name, pr.name) as product_name,
         it.sort_order,
         (s.sku is not null or pr.sku is not null) as in_catalog,
         s.ecom_stock,
         pr.price,
         coalesce(sd.orders, 0), coalesce(sd.units, 0), round(coalesce(sd.revenue, 0), 2)
  from items it
  left join public.stock_items s on s.sku = it.sku
  left join public.products pr on pr.sku = it.sku
  left join sold sd on sd.sku = it.sku
  order by it.sort_order nulls last, it.sku;
$$;

-- ---------------------------------------------------------- slug helpers

-- Candidate slugs for a list, from two witnesses:
--
--   ad_link  an ad's own destination URL points at this list page — this is
--            precisely the slug that needs attaching, so it ranks first
--   ga4      the page merely had traffic; weaker, but it covers lists whose
--            ads use short links (bit.ly) that hide their destination
--
-- Name similarity is deliberately absent: list names describe themes and ad
-- names describe creatives, so word overlap produces confident nonsense.
create or replace function public.fn_ads_slug_suggest(p_text text, p_limit integer default 8)
returns table (
  slug text, views numeric, taken_by text, score integer,
  source text, ads bigint, spend numeric, ad_names text[]
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with words as (
    select w from unnest(string_to_array(public.norm_ad(coalesce(p_text, '')), ' ')) as w
    where length(w) >= 3
      and w !~ '^(copy|new|video|design|carousel|gif|static|ad|ads|con|adv|v1|v2|the|and|list)$'
  ),
  ad_slugs as (
    select lower(d.ref) as slug,
           count(distinct i.ad_name) as ads,
           coalesce(sum(i.spend), 0) as spend,
           array_agg(distinct i.ad_name) filter (where i.ad_name is not null) as ad_names
    from public.ad_insights i
    cross join lateral public.parse_dest_url(i.dest_url) d
    where (select public.my_role()) in ('admin', 'manager', 'viewer')
      and i.level = 'ad'
      and coalesce(i.dest_url, '') <> ''
      and d.kind = 'list'
      and coalesce(d.ref, '') <> ''
    group by 1
  ),
  ga4_slugs as (
    select lower(split_part(g.page_path, '/products/list/', 2)) as slug,
           sum(g.views) as views
    from public.ga4_pages g
    where (select public.my_role()) in ('admin', 'manager', 'viewer')
      and g.page_path like '%/products/list/%'
      and split_part(g.page_path, '/products/list/', 2) <> ''
    group by 1
  ),
  merged as (
    select coalesce(a.slug, g.slug) as slug,
           g.views,
           coalesce(a.ads, 0) as ads,
           coalesce(a.spend, 0) as spend,
           a.ad_names,
           case when a.slug is not null then 'ad_link' else 'ga4' end as source
    from ad_slugs a
    full outer join ga4_slugs g on g.slug = a.slug
  )
  select m.slug, m.views,
         (select c.name from public.custom_lists c where lower(c.slug) = m.slug) as taken_by,
         (select count(*)::integer from words w
           where replace(replace(m.slug, '-', ' '), '.', ' ') like '%' || w.w || '%'
              or w.w like '%' || m.slug || '%') as score,
         m.source, m.ads, m.spend, m.ad_names
  from merged m
  where m.slug is not null
  order by (m.source = 'ad_link') desc, 4 desc, m.spend desc, m.views desc nulls last
  limit greatest(coalesce(p_limit, 8), 1);
$$;

-- ------------------------------------------------------------- auto-link
--
-- Deterministic only: an ad is linked to a list when its own destination URL
-- resolves to a list we already know. Nothing is guessed from names here —
-- name similarity is offered as a suggestion in the UI instead, because a
-- wrong auto-link silently moves real money into the wrong revenue pool.
create or replace function public.fn_ads_autolink()
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_linked integer := 0;
begin
  if (select public.my_role()) not in ('admin', 'manager') then
    raise exception 'not allowed';
  end if;

  with candidates as (
    select public.norm_ad(i.ad_name) as pattern,
           max(i.ad_name) as raw_name,
           max(i.dest_url) as dest_url
    from public.ad_insights i
    where i.level = 'ad'
      and coalesce(i.dest_url, '') <> ''
      and public.norm_ad(i.ad_name) is not null
      and not exists (
        select 1 from public.ad_book_map m
        where m.match_level = 'ad' and m.pattern = public.norm_ad(i.ad_name)
      )
    group by 1
  ),
  resolved as (
    select distinct on (c.pattern)
           c.pattern, c.raw_name, c.dest_url, cl.id as list_key, cl.name as list_name
    from candidates c
    cross join lateral public.parse_dest_url(c.dest_url) d
    join public.custom_lists cl on lower(cl.slug) = lower(d.ref)
    where d.kind = 'list'
    order by c.pattern
  )
  insert into public.ad_book_map (
    match_level, pattern, raw_name, book_label, skus, keyword,
    target_kind, list_key, dest_url, is_auto, active, updated_by, updated_at)
  select 'ad', r.pattern, r.raw_name, r.list_name, null, null,
         'list', r.list_key, r.dest_url, true, true, auth.uid(), now()
  from resolved r
  on conflict (match_level, pattern) do nothing;

  get diagnostics v_linked = row_count;
  return jsonb_build_object('linked', v_linked);
end $$;

revoke all on function public.fn_ads_autolink() from public, anon;
grant execute on function public.fn_ads_autolink() to authenticated;

-- --------------------------------------------------------- mapping upsert

-- Superset of the 074 signature: the extra arguments default so existing
-- callers keep working, and a list target ignores skus/keyword entirely.
create or replace function public.fn_ads_map_set(
  p_match_level text,
  p_raw_name text,
  p_book_label text,
  p_skus text[] default null,
  p_keyword text default null,
  p_target_kind text default 'book',
  p_list_key uuid default null,
  p_dest_url text default null
)
returns uuid
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_kind text := coalesce(nullif(btrim(p_target_kind), ''), 'book');
  v_label text;
  v_sku text;
  v_product text;
begin
  if coalesce(public.norm_ad(p_raw_name), '') = '' then
    raise exception 'name is required';
  end if;
  if v_kind not in ('book', 'list', 'link') then
    raise exception 'unknown target kind %', v_kind;
  end if;

  -- A pasted link is resolved to a real target here, so the attribution engine
  -- never has to care which door the user came through — and so a link can
  -- never be stored as a connection that measures nothing.
  if v_kind = 'link' and p_list_key is null and coalesce(p_dest_url, '') <> '' then
    -- a link that points at a list IS a list mapping
    select c.id into p_list_key
    from public.parse_dest_url(p_dest_url) d
    join public.custom_lists c on lower(c.slug) = lower(d.ref)
    where d.kind = 'list';

    if p_list_key is not null then
      v_kind := 'list';
    else
      -- a link to a single book's page is a book mapping on that SKU
      select coalesce(s.sku, pr.sku), coalesce(s.product_name, pr.name)
        into v_sku, v_product
      from public.parse_dest_url(p_dest_url) d
      left join public.stock_items s on lower(s.sku) = lower(d.ref)
      left join public.products pr on lower(pr.sku) = lower(d.ref) or pr.link = d.ref
      where d.kind = 'product' and coalesce(s.sku, pr.sku) is not null
      limit 1;

      if v_sku is not null then
        v_kind := 'book';
        p_skus := array[v_sku];
        if coalesce(btrim(p_book_label), '') = '' then
          p_book_label := v_product;
        end if;
      else
        -- refuse rather than record a connection with nothing behind it
        raise exception 'that link matches no uploaded list and no known product';
      end if;
    end if;
  end if;

  if v_kind = 'list' then
    if p_list_key is null then
      raise exception 'a list must be chosen';
    end if;
    -- one list = one revenue pool, so the list name is the default label
    select coalesce(nullif(btrim(p_book_label), ''), c.name) into v_label
    from public.custom_lists c where c.id = p_list_key;
  else
    v_label := coalesce(nullif(btrim(p_book_label), ''), p_raw_name);
  end if;

  insert into public.ad_book_map (
    match_level, pattern, raw_name, book_label, skus, keyword,
    target_kind, list_key, dest_url, is_auto, active, updated_by, updated_at)
  values (
    coalesce(p_match_level, 'ad'), public.norm_ad(p_raw_name), p_raw_name,
    coalesce(v_label, p_raw_name),
    case when v_kind = 'list' then null else nullif(p_skus, '{}') end,
    case when v_kind = 'list' then null else nullif(btrim(coalesce(p_keyword, '')), '') end,
    v_kind, p_list_key, nullif(btrim(coalesce(p_dest_url, '')), ''),
    false, true, auth.uid(), now())
  on conflict (match_level, pattern) do update
    set raw_name = excluded.raw_name,
        book_label = excluded.book_label,
        skus = excluded.skus,
        keyword = excluded.keyword,
        target_kind = excluded.target_kind,
        list_key = excluded.list_key,
        dest_url = excluded.dest_url,
        is_auto = false,
        active = true,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- the 5-argument form is now ambiguous with the 8-argument one for callers
-- that pass positionally, so retire it
drop function if exists public.fn_ads_map_set(text, text, text, text[], text);

revoke all on function public.fn_ads_map_set(text, text, text, text[], text, text, uuid, text) from public, anon;
grant execute on function public.fn_ads_map_set(text, text, text, text[], text, text, uuid, text) to authenticated;

-- ------------------------------------------------------------ import RPC

-- unchanged except that the destination URL rides along when the Meta export
-- carries it (newer exports have a "Link (ad settings)" column)
create or replace function public.fn_ads_import(
  p_account text,
  p_start date,
  p_end date,
  p_file text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_import uuid;
  v_n integer;
  v_spend numeric;
begin
  if coalesce(trim(p_account), '') = '' or p_start is null or p_end is null then
    raise exception 'account and period are required';
  end if;

  insert into public.ad_imports (account_label, source, period_start, period_end, file_name, imported_by)
  values (trim(p_account), 'meta', p_start, p_end, p_file, auth.uid())
  on conflict (account_label, period_start, period_end)
    do update set file_name = excluded.file_name,
                  imported_by = excluded.imported_by,
                  imported_at = now()
  returning id into v_import;

  delete from public.ad_insights where import_id = v_import;

  insert into public.ad_insights (
    import_id, account_label, source, level, campaign_name, adset_name, ad_name,
    period_start, period_end, reach, impressions, frequency, spend, cpm,
    link_clicks, ctr_all, landing_page_views, adds_to_cart, checkouts_initiated,
    purchases, conversion_value, cost_per_purchase, results_roas, delivery_status, dest_url)
  select v_import, trim(p_account), 'meta',
         r.level, nullif(r.campaign_name, ''), nullif(r.adset_name, ''), nullif(r.ad_name, ''),
         p_start, p_end,
         r.reach, r.impressions, r.frequency, r.spend, r.cpm,
         r.link_clicks, r.ctr_all, r.landing_page_views, r.adds_to_cart, r.checkouts_initiated,
         r.purchases, r.conversion_value, r.cost_per_purchase, r.results_roas, r.delivery_status,
         nullif(r.dest_url, '')
  from jsonb_to_recordset(p_rows) as r (
    level text, campaign_name text, adset_name text, ad_name text,
    reach numeric, impressions numeric, frequency numeric, spend numeric, cpm numeric,
    link_clicks numeric, ctr_all numeric, landing_page_views numeric,
    adds_to_cart numeric, checkouts_initiated numeric, purchases numeric,
    conversion_value numeric, cost_per_purchase numeric, results_roas numeric,
    delivery_status text, dest_url text)
  where r.level in ('campaign', 'adset', 'ad')
  on conflict do nothing;

  select count(*), coalesce(sum(spend) filter (where level = 'ad'), 0)
    into v_n, v_spend
  from public.ad_insights where import_id = v_import;

  update public.ad_imports set row_count = v_n, spend_total = v_spend where id = v_import;

  return jsonb_build_object('import_id', v_import, 'rows', v_n, 'spend', v_spend);
end $$;

revoke all on function public.fn_ads_import(text, date, date, text, jsonb) from public, anon;
grant execute on function public.fn_ads_import(text, date, date, text, jsonb) to authenticated;

-- ------------------------------------------------- rebuilt on the new view

-- fn_ads_insights: same shape as 078 plus the ad's target (list / book) and
-- the destination URL, and reading ad_map_effective so a list mapping brings
-- the whole list's SKUs into the sales measurement.
drop function if exists public.fn_ads_insights(date, date);

create or replace function public.fn_ads_insights(p_from date default null, p_to date default null)
returns table (
  id uuid, import_id uuid, account_label text, level text,
  campaign_name text, adset_name text, ad_name text,
  period_start date, period_end date, period_key text, days integer,
  delivery_status text,
  reach numeric, impressions numeric, frequency numeric, spend numeric, cpm numeric,
  link_clicks numeric, ctr_all numeric, landing_page_views numeric,
  adds_to_cart numeric, checkouts_initiated numeric,
  purchases numeric, conversion_value numeric, cost_per_purchase numeric, results_roas numeric,
  cpc numeric, lp_rate numeric, atc_rate numeric, ic_rate numeric,
  purchase_rate numeric, cvr numeric,
  cost_per_lpv numeric, cost_per_atc numeric, cost_per_ic numeric,
  reported_roas numeric, daily_spend numeric,
  book_label text, book_skus text[], map_source text,
  target_kind text, list_key uuid, list_name text, list_slug text, list_items integer,
  dest_url text,
  book_orders bigint, book_units numeric, book_revenue numeric,
  book_net_revenue numeric, book_delivered_revenue numeric,
  book_cancelled_orders bigint, book_buyers bigint,
  book_stock integer, book_avg_price numeric,
  spend_share numeric,
  att_orders numeric, att_units numeric, att_revenue numeric,
  att_net_revenue numeric, att_cancelled_orders numeric,
  actual_roas numeric, net_roas numeric, actual_cpa numeric, cancel_rate numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with base as (
    select i.*
    from public.ad_insights i
    where (p_from is null or i.period_end >= p_from)
      and (p_to is null or i.period_start <= p_to)
      -- the role gate: empty base -> empty result for unauthorised callers
      and (select public.my_role()) in ('admin', 'manager', 'viewer')
  ),
  mapped as (
    select b.id, b.period_start, b.period_end, coalesce(b.spend, 0) as spend,
           coalesce(ma.book_label, mc.book_label) as book_label,
           coalesce(ma.skus, mc.skus) as skus,
           coalesce(ma.keyword, mc.keyword) as keyword,
           coalesce(ma.target_kind, mc.target_kind) as target_kind,
           coalesce(ma.list_key, mc.list_key) as list_key,
           coalesce(ma.list_name, mc.list_name) as list_name,
           coalesce(ma.list_slug, mc.list_slug) as list_slug,
           coalesce(ma.list_items, mc.list_items) as list_items,
           coalesce(ma.dest_url, mc.dest_url) as map_url,
           case when ma.book_label is not null then 'ad'
                when mc.book_label is not null then 'campaign' end as map_source
    from base b
    left join public.ad_map_effective ma
      on ma.match_level = 'ad' and ma.active and ma.pattern = public.norm_ad(b.ad_name)
    left join public.ad_map_effective mc
      on mc.match_level = 'campaign' and mc.active and mc.pattern = public.norm_ad(b.campaign_name)
    where b.level = 'ad'
  ),
  book_defs as (
    select m.book_label,
           array_agg(distinct s.sku) filter (where s.sku is not null) as skus,
           max(m.keyword) as keyword
    from mapped m
    left join lateral unnest(coalesce(m.skus, '{}'::text[])) as s(sku) on true
    where m.book_label is not null
    group by 1
  ),
  book_period as (
    select distinct m.book_label, m.period_start, m.period_end
    from mapped m where m.book_label is not null
  ),
  hits as (
    select bp.book_label, bp.period_start, bp.period_end,
           oi.order_number, oi.sku, oi.price, o.order_status, o.master_id, o.customer_id
    from book_period bp
    join book_defs bd on bd.book_label = bp.book_label
     and bd.skus is not null and array_length(bd.skus, 1) > 0
    join public.order_items oi on oi.sku = any (bd.skus)
    join public.orders o
      on o.order_number = oi.order_number
     and o.order_date >= bp.period_start
     and o.order_date < bp.period_end + 1
    union all
    select bp.book_label, bp.period_start, bp.period_end,
           oi.order_number, oi.sku, oi.price, o.order_status, o.master_id, o.customer_id
    from book_period bp
    join book_defs bd on bd.book_label = bp.book_label
     and (bd.skus is null or array_length(bd.skus, 1) is null)
     and bd.keyword is not null
    join public.order_items oi on oi.product_name ilike '%' || bd.keyword || '%'
    join public.orders o
      on o.order_number = oi.order_number
     and o.order_date >= bp.period_start
     and o.order_date < bp.period_end + 1
  ),
  sales as (
    select h.book_label, h.period_start, h.period_end,
           count(distinct h.order_number) filter (where h.order_status <> 'Cancelled') as orders,
           coalesce(sum(coalesce(ps.quantity, 1)) filter (where h.order_status <> 'Cancelled'), 0) as units,
           coalesce(sum(h.price) filter (where h.order_status <> 'Cancelled'), 0) as revenue,
           coalesce(sum(h.price) filter (
             where h.order_status not in ('Cancelled', 'Returned', 'Return Request', 'Return Sent To Erp', 'Delivery Failed')), 0) as net_revenue,
           coalesce(sum(h.price) filter (where h.order_status = 'Delivered'), 0) as delivered_revenue,
           count(distinct h.order_number) filter (where h.order_status = 'Cancelled') as cancelled_orders,
           count(distinct coalesce(h.master_id, h.customer_id, h.order_number))
             filter (where h.order_status <> 'Cancelled') as buyers
    from hits h
    left join public.product_sales ps on ps.order_id = h.order_number and ps.sku = h.sku
    group by 1, 2, 3
  ),
  stock as (
    select bd.book_label, sum(si.ecom_stock)::integer as stock
    from book_defs bd
    join lateral unnest(coalesce(bd.skus, '{}'::text[])) as s(sku) on true
    join public.stock_items si on si.sku = s.sku
    group by 1
  ),
  shares as (
    select m.id, sum(m.spend) over w as book_spend, count(*) over w as book_ads, m.spend
    from mapped m
    where m.book_label is not null
    window w as (partition by m.book_label, m.period_start, m.period_end)
  )
  select
    b.id, b.import_id, b.account_label, b.level,
    b.campaign_name, b.adset_name, b.ad_name,
    b.period_start, b.period_end,
    b.period_start::text || '_' || b.period_end::text as period_key,
    (b.period_end - b.period_start + 1)::integer as days,
    b.delivery_status,
    b.reach, b.impressions, b.frequency, b.spend,
    coalesce(b.cpm, case when b.impressions > 0 then round(b.spend * 1000 / b.impressions, 2) end) as cpm,
    b.link_clicks, b.ctr_all, b.landing_page_views,
    b.adds_to_cart, b.checkouts_initiated,
    b.purchases, b.conversion_value, b.cost_per_purchase, b.results_roas,
    case when b.link_clicks > 0 then round(b.spend / b.link_clicks, 2) end as cpc,
    case when b.link_clicks > 0 then round(b.landing_page_views * 100 / b.link_clicks, 1) end as lp_rate,
    case when b.landing_page_views > 0 then round(b.adds_to_cart * 100 / b.landing_page_views, 1) end as atc_rate,
    case when b.adds_to_cart > 0 then round(b.checkouts_initiated * 100 / b.adds_to_cart, 1) end as ic_rate,
    case when b.checkouts_initiated > 0 then round(b.purchases * 100 / b.checkouts_initiated, 1) end as purchase_rate,
    case when b.link_clicks > 0 then round(b.purchases * 100 / b.link_clicks, 2) end as cvr,
    case when b.landing_page_views > 0 then round(b.spend / b.landing_page_views, 2) end as cost_per_lpv,
    case when b.adds_to_cart > 0 then round(b.spend / b.adds_to_cart, 2) end as cost_per_atc,
    case when b.checkouts_initiated > 0 then round(b.spend / b.checkouts_initiated, 2) end as cost_per_ic,
    case when b.spend > 0 then round(coalesce(b.conversion_value, 0) / b.spend, 2) end as reported_roas,
    round(coalesce(b.spend, 0) / greatest(b.period_end - b.period_start + 1, 1), 2) as daily_spend,
    m.book_label,
    bd.skus as book_skus,
    m.map_source,
    m.target_kind, m.list_key, m.list_name, m.list_slug, m.list_items,
    coalesce(b.dest_url, m.map_url) as dest_url,
    s.orders, s.units, s.revenue, s.net_revenue, s.delivered_revenue,
    s.cancelled_orders, s.buyers,
    st.stock,
    case when s.units > 0 then round(s.revenue / s.units, 2) end as book_avg_price,
    sh.share as spend_share,
    round(coalesce(s.orders, 0) * sh.share, 2) as att_orders,
    round(coalesce(s.units, 0) * sh.share, 2) as att_units,
    round(coalesce(s.revenue, 0) * sh.share, 2) as att_revenue,
    round(coalesce(s.net_revenue, 0) * sh.share, 2) as att_net_revenue,
    round(coalesce(s.cancelled_orders, 0) * sh.share, 2) as att_cancelled_orders,
    case when b.spend > 0 then round(coalesce(s.revenue, 0) * sh.share / b.spend, 2) end as actual_roas,
    case when b.spend > 0 then round(coalesce(s.net_revenue, 0) * sh.share / b.spend, 2) end as net_roas,
    case when coalesce(s.orders, 0) * sh.share > 0 then round(b.spend / (s.orders * sh.share), 2) end as actual_cpa,
    case when coalesce(s.orders, 0) + coalesce(s.cancelled_orders, 0) > 0
         then round(s.cancelled_orders * 100.0 / (s.orders + s.cancelled_orders), 1) end as cancel_rate
  from base b
  left join mapped m on m.id = b.id
  left join book_defs bd on bd.book_label = m.book_label
  left join sales s
    on s.book_label = m.book_label and s.period_start = b.period_start and s.period_end = b.period_end
  left join stock st on st.book_label = m.book_label
  left join lateral (
    select case when sh0.book_spend > 0 then sh0.spend / sh0.book_spend
                else 1.0 / greatest(sh0.book_ads, 1) end as share
    from shares sh0 where sh0.id = b.id
  ) sh on true
  order by b.period_start desc, b.spend desc nulls last;
$$;

-- fn_ads_gap: same reconciliation, reading the effective mapping
create or replace function public.fn_ads_gap(p_from date, p_to date)
returns table (
  book_label text, campaigns text[], ads bigint, spend numeric,
  meta_purchases numeric, meta_value numeric, meta_roas numeric,
  ga4_sessions numeric, ga4_atc numeric, ga4_purchases numeric, ga4_revenue numeric,
  ga4_tracked_orders bigint, ga4_tracked_revenue numeric,
  store_orders bigint, store_units numeric, store_revenue numeric,
  store_net_revenue numeric, store_cancelled bigint,
  actual_roas numeric, claim_vs_reality numeric, purchases_vs_orders numeric,
  verdict text, gsc_clicks numeric, gsc_impressions numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with ads as (
    select coalesce(ma.book_label, mc.book_label) as book_label,
           i.campaign_name, i.spend, i.purchases, i.conversion_value,
           coalesce(ma.skus, mc.skus) as skus,
           coalesce(ma.keyword, mc.keyword) as keyword
    from public.ad_insights i
    left join public.ad_map_effective ma
      on ma.match_level = 'ad' and ma.active and ma.pattern = public.norm_ad(i.ad_name)
    left join public.ad_map_effective mc
      on mc.match_level = 'campaign' and mc.active and mc.pattern = public.norm_ad(i.campaign_name)
    where i.level = 'ad'
      and i.period_end >= p_from and i.period_start <= p_to
      and (select public.my_role()) in ('admin', 'manager', 'viewer')
  ),
  books as (
    select a.book_label,
           array_agg(distinct a.campaign_name) filter (where a.campaign_name is not null) as campaigns,
           array_agg(distinct public.norm_ad(a.campaign_name))
             filter (where a.campaign_name is not null) as campaign_keys,
           count(*) as ads,
           coalesce(sum(a.spend), 0) as spend,
           coalesce(sum(a.purchases), 0) as meta_purchases,
           coalesce(sum(a.conversion_value), 0) as meta_value
    from ads a
    where a.book_label is not null
    group by 1
  ),
  book_skus as (
    select a.book_label,
           array_agg(distinct s.sku) filter (where s.sku is not null) as skus,
           max(a.keyword) as keyword
    from ads a
    left join lateral unnest(coalesce(a.skus, '{}'::text[])) as s(sku) on true
    where a.book_label is not null
    group by 1
  ),
  hits as (
    select bs.book_label, oi.order_number, oi.sku, oi.price, o.order_status
    from book_skus bs
    join public.order_items oi on oi.sku = any (bs.skus)
    join public.orders o on o.order_number = oi.order_number
     and o.order_date >= p_from and o.order_date < p_to + 1
    where bs.skus is not null and array_length(bs.skus, 1) > 0
    union all
    select bs.book_label, oi.order_number, oi.sku, oi.price, o.order_status
    from book_skus bs
    join public.order_items oi on oi.product_name ilike '%' || bs.keyword || '%'
    join public.orders o on o.order_number = oi.order_number
     and o.order_date >= p_from and o.order_date < p_to + 1
    where (bs.skus is null or array_length(bs.skus, 1) is null) and bs.keyword is not null
  ),
  store as (
    select h.book_label,
           count(distinct h.order_number) filter (where h.order_status <> 'Cancelled') as orders,
           coalesce(sum(coalesce(ps.quantity, 1)) filter (where h.order_status <> 'Cancelled'), 0) as units,
           coalesce(sum(h.price) filter (where h.order_status <> 'Cancelled'), 0) as revenue,
           coalesce(sum(h.price) filter (
             where h.order_status not in ('Cancelled', 'Returned', 'Return Request', 'Return Sent To Erp', 'Delivery Failed')), 0) as net_revenue,
           count(distinct h.order_number) filter (where h.order_status = 'Cancelled') as cancelled
    from hits h
    left join public.product_sales ps on ps.order_id = h.order_number and ps.sku = h.sku
    group by 1
  ),
  src_camp as materialized (
    select campaign, public.norm_ad(campaign) as key
    from (select distinct campaign from public.ga4_sources
          where date between p_from and p_to and campaign is not null) c
  ),
  ga4_src as (
    select b.book_label,
           sum(g.sessions) as sessions,
           sum(g.add_to_carts) as atc,
           sum(g.purchases) as purchases,
           sum(g.revenue) as revenue
    from books b
    join src_camp sc on sc.key = any (b.campaign_keys)
    join public.ga4_sources g
      on g.campaign = sc.campaign and g.date between p_from and p_to
    group by 1
  ),
  tx_camp as materialized (
    select campaign, public.norm_ad(campaign) as key
    from (select distinct campaign from public.ga4_transactions where campaign is not null) c
  ),
  ga4_tx as (
    select b.book_label,
           count(distinct o.order_number) as orders,
           coalesce(sum(o.total_order_amount) filter (where o.order_status <> 'Cancelled'), 0) as revenue
    from books b
    join tx_camp tc on tc.key = any (b.campaign_keys)
    join public.ga4_transactions t on t.campaign = tc.campaign
    join public.orders o
      on o.tx_key = t.transaction_id
     and o.order_date >= p_from and o.order_date < p_to + 1
    group by 1
  ),
  gsc_norm as materialized (
    select q.query, public.norm_ar(q.query) as nq, q.clicks, q.impressions
    from public.gsc_queries q
    where q.period_month >= date_trunc('month', p_from)::date
      and q.period_month <= date_trunc('month', p_to)::date
  ),
  gsc as (
    select b.book_label,
           sum(q.clicks) as clicks,
           sum(q.impressions) as impressions
    from books b
    join lateral (
      select w from unnest(string_to_array(public.norm_ar(b.book_label), ' ')) as w
      where length(w) >= 4
    ) words on true
    join gsc_norm q on q.nq like '%' || words.w || '%'
    group by 1
  )
  select
    b.book_label, b.campaigns, b.ads, round(b.spend, 2),
    b.meta_purchases, round(b.meta_value, 2),
    case when b.spend > 0 then round(b.meta_value / b.spend, 2) end as meta_roas,
    gs.sessions, gs.atc, gs.purchases, round(gs.revenue, 2),
    gt.orders, round(gt.revenue, 2),
    coalesce(st.orders, 0), coalesce(st.units, 0),
    round(coalesce(st.revenue, 0), 2), round(coalesce(st.net_revenue, 0), 2),
    coalesce(st.cancelled, 0),
    case when b.spend > 0 then round(coalesce(st.revenue, 0) / b.spend, 2) end as actual_roas,
    case when coalesce(st.revenue, 0) > 0 then round(b.meta_value / st.revenue, 2) end as claim_vs_reality,
    case when coalesce(st.orders, 0) > 0 then round(b.meta_purchases / st.orders, 2) end as purchases_vs_orders,
    case
      when b.meta_purchases > coalesce(st.orders, 0) then 'impossible'
      when b.meta_value > coalesce(st.revenue, 0) * 1.15 then 'inflated'
      else 'plausible'
    end as verdict,
    g.clicks, g.impressions
  from books b
  left join store st on st.book_label = b.book_label
  left join ga4_src gs on gs.book_label = b.book_label
  left join ga4_tx gt on gt.book_label = b.book_label
  left join gsc g on g.book_label = b.book_label
  order by b.spend desc;
$$;

-- fn_ads_unmapped: the backlog, now carrying the ad's own destination URL and
-- the list it most likely belongs to, so connecting is one click
drop function if exists public.fn_ads_unmapped(date, date);

create or replace function public.fn_ads_unmapped(p_from date default null, p_to date default null)
returns table (
  ad_name text, pattern text, campaigns text[], accounts text[],
  spend numeric, purchases numeric, conversion_value numeric, periods bigint,
  dest_url text, suggest_list_key uuid, suggest_list_name text, suggest_reason text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with backlog as (
    select max(i.ad_name) as ad_name,
           public.norm_ad(i.ad_name) as pattern,
           array_agg(distinct i.campaign_name) filter (where i.campaign_name is not null) as campaigns,
           array_agg(distinct i.account_label) as accounts,
           coalesce(sum(i.spend), 0) as spend,
           coalesce(sum(i.purchases), 0) as purchases,
           coalesce(sum(i.conversion_value), 0) as conversion_value,
           count(distinct i.period_start) as periods,
           max(i.dest_url) as dest_url
    from public.ad_insights i
    where (select public.my_role()) in ('admin', 'manager', 'viewer')
      and i.level = 'ad'
      and (p_from is null or i.period_end >= p_from)
      and (p_to is null or i.period_start <= p_to)
      and not exists (
        select 1 from public.ad_book_map m
        where m.active
          and ((m.match_level = 'ad' and m.pattern = public.norm_ad(i.ad_name))
            or (m.match_level = 'campaign' and m.pattern = public.norm_ad(i.campaign_name)))
      )
    group by public.norm_ad(i.ad_name)
  )
  select b.ad_name, b.pattern, b.campaigns, b.accounts,
         b.spend, b.purchases, b.conversion_value, b.periods,
         b.dest_url,
         sg.id, sg.name, sg.reason
  from backlog b
  left join lateral (
    -- ONLY the ad's own destination URL. Name similarity is deliberately not
    -- used: a list is named for a theme ("Award-Winning Books") while its ads
    -- are named for creatives, so word overlap produces confident nonsense —
    -- and a wrong connection silently moves real money into the wrong pool.
    select c.id, c.name, 'url'::text as reason
    from public.parse_dest_url(b.dest_url) d
    join public.custom_lists c on lower(c.slug) = lower(d.ref)
    where d.kind = 'list'
    limit 1
  ) sg on true
  order by b.spend desc;
$$;

-- fn_ads_map_list: the current links, with what each one actually resolves to
drop function if exists public.fn_ads_map_list();

create or replace function public.fn_ads_map_list()
returns table (
  id uuid, match_level text, pattern text, raw_name text, book_label text,
  skus text[], keyword text, is_auto boolean, active boolean, updated_at timestamptz,
  target_kind text, list_key uuid, list_name text, list_slug text, list_items integer,
  dest_url text, ad_count bigint, spend numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.id, m.match_level, m.pattern, m.raw_name, m.book_label, m.skus, m.keyword,
         m.is_auto, m.active, m.updated_at,
         m.target_kind, m.list_key, m.list_name, m.list_slug, m.list_items, m.dest_url,
         count(i.id) as ad_count,
         coalesce(sum(i.spend), 0) as spend
  from public.ad_map_effective m
  left join public.ad_insights i
    on i.level = 'ad'
   and ((m.match_level = 'ad' and public.norm_ad(i.ad_name) = m.pattern)
     or (m.match_level = 'campaign' and public.norm_ad(i.campaign_name) = m.pattern))
  where (select public.my_role()) in ('admin', 'manager', 'viewer')
  group by m.id, m.match_level, m.pattern, m.raw_name, m.book_label, m.skus, m.keyword,
           m.is_auto, m.active, m.updated_at, m.target_kind, m.list_key, m.list_name,
           m.list_slug, m.list_items, m.dest_url
  order by spend desc, m.book_label;
$$;

-- --------------------------------------------------------------- grants

revoke all on function public.parse_dest_url(text) from public, anon;
revoke all on function public.fn_ads_link_resolve(text) from public, anon;
revoke all on function public.fn_custom_lists_overview(date, date) from public, anon;
revoke all on function public.fn_custom_list_items(uuid, date, date) from public, anon;
revoke all on function public.fn_ads_slug_suggest(text, integer) from public, anon;
revoke all on function public.fn_ads_insights(date, date) from public, anon;
revoke all on function public.fn_ads_gap(date, date) from public, anon;
revoke all on function public.fn_ads_unmapped(date, date) from public, anon;
revoke all on function public.fn_ads_map_list() from public, anon;

grant execute on function public.parse_dest_url(text) to authenticated;
grant execute on function public.fn_ads_link_resolve(text) to authenticated;
grant execute on function public.fn_custom_lists_overview(date, date) to authenticated;
grant execute on function public.fn_custom_list_items(uuid, date, date) to authenticated;
grant execute on function public.fn_ads_slug_suggest(text, integer) to authenticated;
grant execute on function public.fn_ads_insights(date, date) to authenticated;
grant execute on function public.fn_ads_gap(date, date) to authenticated;
grant execute on function public.fn_ads_unmapped(date, date) to authenticated;
grant execute on function public.fn_ads_map_list() to authenticated;
