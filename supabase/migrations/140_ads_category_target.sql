-- 140: an ad can be connected to a catalog category or subcategory.
--
-- Ads don't only link to custom lists and single books: a good share point at
-- a whole section of the store (/category/kids, /category/al-adwaa/primary-
-- stage) or a subcategory inside it (/category/cultural/cultural-islamic-
-- books). Until now those could only be mapped by hand-picking SKUs, which
-- nobody does for 1,500 books, so they stayed unmapped and their spend was
-- blind.
--
-- The products catalog already carries the store's two-level tree:
--   section   Kids / Cultural / Comics / Foreign books / AL-Adwaa
--   category  the subcategory inside a section (Stories & Adventures, ...)
--
-- A category target stores (section, category-or-null) on the mapping and
-- resolves its SKU pool LIVE from `products` in ad_map_effective, so a book
-- that moves into the category next month is counted from then on without
-- anyone re-saving the ad. As with lists, one category = one revenue pool =
-- one book_label, and the attribution engine (fn_ads_insights & co.) keeps
-- reading `skus` from the view and never learns a new kind exists.
--
-- Nothing in the store's category URLs matches the catalog's names exactly
-- (/category/kids/fiction vs "Stories & Adventures"), so link resolution is
-- best-effort: the section is always recognised; the subcategory is matched
-- on a folded spelling and otherwise left for the user to pick.

-- ---------------------------------------------------------------- columns

alter table public.ad_book_map
  add column if not exists cat_section text,
  add column if not exists cat_category text;

alter table public.ad_book_map drop constraint if exists ad_book_map_target_kind_check;
alter table public.ad_book_map
  add constraint ad_book_map_target_kind_check
  check (target_kind in ('book', 'list', 'link', 'category'));

create index if not exists idx_products_section_category
  on public.products (section, category);

-- ---------------------------------------------------------------- helpers

-- "cultural-islamic-books" / "Islamic Books" -> "islamicbooks"; section words
-- and "and"/"&" are dropped so the store's slug and the catalog's name meet in
-- the middle. Every section word goes, not just the current one: the store
-- prefixes some slugs with a section they don't belong to (comics/cultural-
-- mickey).
create or replace function public.fold_category(p text, p_section text default null)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(p, '')), '(^|[^a-z0-9])(kids|cultural|comics|al-?adwaa|foreign|and|' || coalesce(nullif(lower(regexp_replace(coalesce(p_section, ''), '[^A-Za-z0-9]', '', 'g')), ''), 'and') || ')([^a-z0-9]|$)', '\1\3', 'g'),
        '&', '', 'g'),
      '[^a-z0-9ء-ي]', '', 'g'),
    '');
$$;

-- the store's URL section words -> catalog section names
create or replace function public.section_from_slug(p_slug text)
returns text
language sql
stable
set search_path to 'public'
as $$
  select s.section
  from (select distinct section from public.products where section is not null) s
  where lower(regexp_replace(s.section, '[^A-Za-z0-9]', '', 'g'))
        = lower(regexp_replace(coalesce(p_slug, ''), '[^A-Za-z0-9]', '', 'g'))
  limit 1;
$$;

-- the category tree with sizes, for the picker
create or replace function public.fn_catalog_categories()
returns table (section text, category text, products bigint, in_stock bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.section, p.category,
         count(*) as products,
         count(*) filter (where coalesce(p.stock_qty, 0) > 0) as in_stock
  from public.products p
  where p.section is not null
    and (select public.my_role()) in ('admin', 'manager', 'viewer')
  group by p.section, p.category
  order by p.section, count(*) desc;
$$;

revoke all on function public.fn_catalog_categories() from public, anon;
grant execute on function public.fn_catalog_categories() to authenticated;

-- ---------------------------------------------------------------- URL shapes

create or replace function public.parse_dest_url(p_url text)
returns table (kind text, ref text)
language sql
immutable
set search_path to 'public'
as $$
  with clean as (
    select regexp_replace(
             regexp_replace(
               regexp_replace(coalesce(p_url, ''), '^\s*[a-z]+://[^/]*', '', 'i'),
               '[?#].*$', ''),
             '/+$', '') as path
  )
  select case when position('/products/list/' in lower(c.path)) > 0 then 'list'
              when position('/products/' in lower(c.path)) > 0 then 'product'
              when position('/category/' in lower(c.path)) > 0 then 'category'
              end,
         case when position('/products/list/' in lower(c.path)) > 0
                then nullif(split_part(substring(c.path from position('/products/list/' in lower(c.path))), '/', 4), '')
              when position('/products/' in lower(c.path)) > 0
                then nullif(split_part(substring(c.path from position('/products/' in lower(c.path))), '/', 3), '')
              when position('/category/' in lower(c.path)) > 0
                -- "kids/fiction": section slug, then the optional sub slug
                then nullif(substring(c.path from position('/category/' in lower(c.path)) + 10), '')
              end
  from clean c
  where coalesce(p_url, '') <> '';
$$;

-- ---------------------------------------------------------------- the view

create or replace view public.ad_map_effective
with (security_invoker = true) as
  select m.id,
         m.match_level,
         m.pattern,
         m.raw_name,
         m.book_label,
         case when m.target_kind = 'list' then li.skus
              when m.target_kind = 'category' then ca.skus
              else m.skus end as skus,
         -- a list or category resolves by SKU, so its keyword must not fire
         case when m.target_kind in ('list', 'category') then null else m.keyword end as keyword,
         m.is_auto,
         m.active,
         m.updated_at,
         m.target_kind,
         m.list_key,
         m.dest_url,
         -- a category rides in the list columns so every reader that shows
         -- "name · N books" for a list shows the same for a category
         case when m.target_kind = 'category'
              then m.cat_section || coalesce(' › ' || m.cat_category, '')
              else c.name end as list_name,
         c.slug as list_slug,
         c.list_id,
         case when m.target_kind = 'category' then coalesce(array_length(ca.skus, 1), 0)
              else coalesce(array_length(li.skus, 1), 0) end as list_items,
         m.cat_section,
         m.cat_category
  from public.ad_book_map m
  left join public.custom_lists c on c.id = m.list_key
  left join lateral (
    select array_agg(distinct i.sku) as skus
    from public.custom_list_items i
    where i.list_key = m.list_key
  ) li on true
  left join lateral (
    select array_agg(distinct p.sku) as skus
    from public.products p
    where m.target_kind = 'category'
      and p.section = m.cat_section
      and (m.cat_category is null or p.category = m.cat_category)
  ) ca on true;

-- ---------------------------------------------------------------- resolve

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
    select coalesce(s.sku, pr.sku) as sku, coalesce(s.product_name, pr.name) as product_name
    from p
    left join public.stock_items s on lower(s.sku) = lower(p.ref)
    left join public.products pr on lower(pr.sku) = lower(p.ref) or pr.link = p.ref
    where p.kind = 'product' and coalesce(s.sku, pr.sku) is not null
    limit 1
  ),
  cat as (
    select public.section_from_slug(split_part(p.ref, '/', 1)) as section,
           nullif(split_part(p.ref, '/', 2), '') as sub_slug
    from p where p.kind = 'category'
  ),
  catm as (
    -- the subcategory, when the folded slug meets exactly one catalog name
    select c.section, c.sub_slug,
           (select min(x.category) from (
              select distinct pr.category
              from public.products pr
              where pr.section = c.section and pr.category is not null
                and public.fold_category(pr.category, c.section) = public.fold_category(c.sub_slug, c.section)
            ) x having count(*) = 1) as category
    from cat c where c.section is not null
  ),
  catn as (
    select cm.section, cm.sub_slug, cm.category,
           (select count(*) from public.products pr
             where pr.section = cm.section and (cm.category is null or pr.category = cm.category)) as items
    from catm cm
  )
  select case when not (select ok from gate) then '{}'::jsonb else jsonb_build_object(
    'url', p_url,
    'kind', coalesce((select 'list' from lst limit 1), (select 'product' from prod limit 1),
                     (select 'category' from catn limit 1), (select p.kind from p), 'unknown'),
    'ref', (select p.ref from p),
    'list_key', (select id from lst limit 1),
    'list_name', (select name from lst limit 1),
    'list_id', (select list_id from lst limit 1),
    'list_items', (select item_count from lst limit 1),
    'sku', (select sku from prod limit 1),
    'product_name', (select product_name from prod limit 1),
    'cat_section', (select section from catn limit 1),
    'cat_category', (select category from catn limit 1),
    'cat_sub_slug', (select sub_slug from catn limit 1),
    'cat_items', (select items from catn limit 1)
  ) end;
$$;

-- ---------------------------------------------------------------- map_set

drop function if exists public.fn_ads_map_set(text, text, text, text[], text, text, uuid, text);

create or replace function public.fn_ads_map_set(
  p_match_level text,
  p_raw_name text,
  p_book_label text,
  p_skus text[] default null,
  p_keyword text default null,
  p_target_kind text default 'book',
  p_list_key uuid default null,
  p_dest_url text default null,
  p_cat_section text default null,
  p_cat_category text default null
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
  v_section text := nullif(btrim(coalesce(p_cat_section, '')), '');
  v_category text := nullif(btrim(coalesce(p_cat_category, '')), '');
  v_n integer;
begin
  if coalesce(public.norm_ad(p_raw_name), '') = '' then
    raise exception 'name is required';
  end if;
  if v_kind not in ('book', 'list', 'link', 'category') then
    raise exception 'unknown target kind %', v_kind;
  end if;

  -- A pasted link is resolved to a real target here, so the attribution engine
  -- never has to care which door the user came through — and so a link can
  -- never be stored as a connection that measures nothing.
  if v_kind = 'link' and p_list_key is null and coalesce(p_dest_url, '') <> '' then
    select c.id into p_list_key
    from public.parse_dest_url(p_dest_url) d
    join public.custom_lists c on lower(c.slug) = lower(d.ref)
    where d.kind = 'list';

    if p_list_key is not null then
      v_kind := 'list';
    else
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
        -- a category link: the caller may already have picked the section
        -- and subcategory from what the resolver showed; otherwise resolve
        -- it here the same way
        if v_section is null then
          select r ->> 'cat_section', r ->> 'cat_category'
            into v_section, v_category
          from public.fn_ads_link_resolve(p_dest_url) r
          where r ->> 'kind' = 'category';
        end if;
        if v_section is not null then
          v_kind := 'category';
        else
          raise exception 'that link matches no uploaded list, no known product and no store category';
        end if;
      end if;
    end if;
  end if;

  if v_kind = 'list' then
    if p_list_key is null then
      raise exception 'a list must be chosen';
    end if;
    select coalesce(nullif(btrim(p_book_label), ''), c.name) into v_label
    from public.custom_lists c where c.id = p_list_key;
  elsif v_kind = 'category' then
    if v_section is null then
      raise exception 'a section must be chosen';
    end if;
    select count(*) into v_n from public.products p
     where p.section = v_section and (v_category is null or p.category = v_category);
    if v_n = 0 then
      raise exception 'no products in % / %', v_section, coalesce(v_category, '(all)');
    end if;
    -- one category = one revenue pool, so its path is the default label
    v_label := coalesce(nullif(btrim(p_book_label), ''), v_section || coalesce(' › ' || v_category, ''));
  else
    v_label := coalesce(nullif(btrim(p_book_label), ''), p_raw_name);
  end if;

  insert into public.ad_book_map (
    match_level, pattern, raw_name, book_label, skus, keyword,
    target_kind, list_key, dest_url, cat_section, cat_category,
    is_auto, active, updated_by, updated_at)
  values (
    coalesce(p_match_level, 'ad'), public.norm_ad(p_raw_name), p_raw_name,
    coalesce(v_label, p_raw_name),
    case when v_kind in ('list', 'category') then null else nullif(p_skus, '{}') end,
    case when v_kind in ('list', 'category') then null else nullif(btrim(coalesce(p_keyword, '')), '') end,
    v_kind,
    case when v_kind = 'list' then p_list_key end,
    nullif(btrim(coalesce(p_dest_url, '')), ''),
    case when v_kind = 'category' then v_section end,
    case when v_kind = 'category' then v_category end,
    false, true, auth.uid(), now())
  on conflict (match_level, pattern) do update
    set raw_name = excluded.raw_name,
        book_label = excluded.book_label,
        skus = excluded.skus,
        keyword = excluded.keyword,
        target_kind = excluded.target_kind,
        list_key = excluded.list_key,
        dest_url = excluded.dest_url,
        cat_section = excluded.cat_section,
        cat_category = excluded.cat_category,
        is_auto = false,
        active = true,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.fn_ads_map_set(text, text, text, text[], text, text, uuid, text, text, text) from public, anon;
grant execute on function public.fn_ads_map_set(text, text, text, text[], text, text, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------- map_list

drop function if exists public.fn_ads_map_list();

create or replace function public.fn_ads_map_list()
returns table (
  id uuid, match_level text, pattern text, raw_name text, book_label text,
  skus text[], keyword text, is_auto boolean, active boolean, updated_at timestamptz,
  target_kind text, list_key uuid, list_name text, list_slug text, list_items integer,
  dest_url text, ad_count bigint, spend numeric,
  cat_section text, cat_category text
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
         coalesce(sum(i.spend), 0) as spend,
         m.cat_section, m.cat_category
  from public.ad_map_effective m
  left join public.ad_insights i
    on i.level = 'ad'
   and ((m.match_level = 'ad' and public.norm_ad(i.ad_name) = m.pattern)
     or (m.match_level = 'campaign' and public.norm_ad(i.campaign_name) = m.pattern))
  where (select public.my_role()) in ('admin', 'manager', 'viewer')
  group by m.id, m.match_level, m.pattern, m.raw_name, m.book_label, m.skus, m.keyword,
           m.is_auto, m.active, m.updated_at, m.target_kind, m.list_key, m.list_name,
           m.list_slug, m.list_items, m.dest_url, m.cat_section, m.cat_category
  order by spend desc, m.book_label;
$$;

revoke all on function public.fn_ads_map_list() from public, anon;
grant execute on function public.fn_ads_map_list() to authenticated;
