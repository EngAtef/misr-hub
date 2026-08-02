-- ============================================================
-- Migration 063: actually STORE the uploaded product catalog.
--
-- parseCatalogFile pulls 16+ fields per book out of the
-- FullProductExport (price, cover image, barcode, publisher, language,
-- age group, series, release date, page count, ...), but the upload
-- only ever wrote sku/name/stock/category/vendor into stock_items and
-- a missing-field BITMASK into app_settings.catalog_snapshot. Every
-- other value the user uploaded was parsed and then thrown away, so no
-- page could show it.
--
-- public.products keeps the full row per SKU, plus an `attributes`
-- jsonb catch-all holding every attribute_name/value pair in the file
-- so nothing is silently dropped again when the platform adds a field.
-- Run after 062_catalog_products.sql
-- ============================================================

create table if not exists public.products (
  sku text primary key,
  name text,
  english_name text,
  price numeric,
  stock text,
  stock_qty integer,
  section text,
  category text,
  language text,
  age text,
  series text,
  publisher text,
  author text,
  other_authors text,
  translated_from text,
  book_type text,
  cover_type text,
  paper_type text,
  pages text,
  dimensions text,
  semester text,
  link text,
  release_date text,
  description text,
  image text,
  barcode text,
  vendor text,
  attributes jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_products_section on public.products (section);
create index if not exists idx_products_vendor on public.products (vendor);
create index if not exists idx_products_author on public.products (author);

alter table public.products enable row level security;
drop policy if exists products_read on public.products;
create policy products_read on public.products for select
  using ((select public.my_role()) in ('admin', 'manager', 'viewer'));
drop policy if exists products_write on public.products;
create policy products_write on public.products for insert
  with check ((select public.my_role()) in ('admin', 'manager'));
drop policy if exists products_update on public.products;
create policy products_update on public.products for update
  using ((select public.my_role()) in ('admin', 'manager'));
drop policy if exists products_delete on public.products;
create policy products_delete on public.products for delete
  using ((select public.my_role()) = 'admin');

-- Merge-upsert: a value already on record is never replaced by NULL, so
-- a thinner export can add SKUs without wiping detail an earlier, richer
-- file supplied. `attributes` is merged key-by-key for the same reason.
create or replace function public.fn_upsert_products(p_rows jsonb)
returns integer
language plpgsql set search_path = public
as $$
declare n integer;
begin
  if (select public.my_role()) not in ('admin', 'manager') then
    raise exception 'Forbidden';
  end if;

  insert into public.products (
    sku, name, english_name, price, stock, stock_qty, section, category,
    language, age, series, publisher, author, other_authors, translated_from,
    book_type, cover_type, paper_type, pages, dimensions, semester,
    link, release_date, description, image, barcode, vendor, attributes, updated_at
  )
  select
    r->>'sku',
    nullif(r->>'name', ''),
    nullif(r->>'english_name', ''),
    nullif(regexp_replace(coalesce(r->>'price', ''), '[^0-9.\-]', '', 'g'), '')::numeric,
    nullif(r->>'stock', ''),
    nullif(r->>'stock_qty', '')::integer,
    nullif(r->>'section', ''),
    nullif(r->>'category', ''),
    nullif(r->>'language', ''),
    nullif(r->>'age', ''),
    nullif(r->>'series', ''),
    nullif(r->>'publisher', ''),
    nullif(r->>'author', ''),
    nullif(r->>'other_authors', ''),
    nullif(r->>'translated_from', ''),
    nullif(r->>'book_type', ''),
    nullif(r->>'cover_type', ''),
    nullif(r->>'paper_type', ''),
    nullif(r->>'pages', ''),
    nullif(r->>'dimensions', ''),
    nullif(r->>'semester', ''),
    nullif(r->>'link', ''),
    nullif(r->>'release_date', ''),
    nullif(r->>'description', ''),
    nullif(r->>'image', ''),
    nullif(r->>'barcode', ''),
    nullif(r->>'vendor', ''),
    coalesce(r->'attributes', '{}'::jsonb),
    now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'sku', '') <> ''
  on conflict (sku) do update set
    name = coalesce(excluded.name, products.name),
    english_name = coalesce(excluded.english_name, products.english_name),
    price = coalesce(excluded.price, products.price),
    stock = coalesce(excluded.stock, products.stock),
    stock_qty = coalesce(excluded.stock_qty, products.stock_qty),
    section = coalesce(excluded.section, products.section),
    category = coalesce(excluded.category, products.category),
    language = coalesce(excluded.language, products.language),
    age = coalesce(excluded.age, products.age),
    series = coalesce(excluded.series, products.series),
    publisher = coalesce(excluded.publisher, products.publisher),
    author = coalesce(excluded.author, products.author),
    other_authors = coalesce(excluded.other_authors, products.other_authors),
    translated_from = coalesce(excluded.translated_from, products.translated_from),
    book_type = coalesce(excluded.book_type, products.book_type),
    cover_type = coalesce(excluded.cover_type, products.cover_type),
    paper_type = coalesce(excluded.paper_type, products.paper_type),
    pages = coalesce(excluded.pages, products.pages),
    dimensions = coalesce(excluded.dimensions, products.dimensions),
    semester = coalesce(excluded.semester, products.semester),
    link = coalesce(excluded.link, products.link),
    release_date = coalesce(excluded.release_date, products.release_date),
    description = coalesce(excluded.description, products.description),
    image = coalesce(excluded.image, products.image),
    barcode = coalesce(excluded.barcode, products.barcode),
    vendor = coalesce(excluded.vendor, products.vendor),
    attributes = products.attributes || excluded.attributes,
    updated_at = now();

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.fn_upsert_products(jsonb) from public, anon;
grant execute on function public.fn_upsert_products(jsonb) to authenticated;

-- ---- fn_catalog_products: carry the uploaded detail ----------------
-- Universe now also includes SKUs that exist in products, and each row
-- returns price / cover image / author / publisher so the table can show
-- what was uploaded instead of just a name.
drop function if exists public.fn_catalog_products(timestamptz, timestamptz, text, text, text, text, integer, integer);
create or replace function public.fn_catalog_products(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_search text default null,
  p_scope text default 'all',
  p_sort text default 'units',
  p_dir text default 'desc',
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  sku text,
  product_name text,
  category text,
  vendor text,
  ecom_stock integer,
  sap_stock integer,
  price numeric,
  image text,
  author text,
  publisher text,
  language text,
  age text,
  series text,
  barcode text,
  units bigint,
  orders bigint,
  revenue numeric,
  lifetime_units bigint,
  lifetime_orders bigint,
  lifetime_revenue numeric,
  first_order_date timestamptz,
  last_order_date timestamptz,
  total_count bigint
)
language sql stable set search_path = public
as $$
  with life as (
    select
      coalesce(nullif(i.sku, ''), '(no sku)') as sku,
      mode() within group (order by i.product_name) as product_name,
      count(*)::bigint as l_units,
      count(distinct i.order_number)::bigint as l_orders,
      coalesce(sum(i.price), 0) as l_revenue,
      min(o.order_date) as first_order_date,
      max(o.order_date) as last_order_date,
      count(*) filter (
        where (p_from is null or o.order_date >= p_from)
          and (p_to is null or o.order_date < p_to)
      )::bigint as r_units,
      count(distinct i.order_number) filter (
        where (p_from is null or o.order_date >= p_from)
          and (p_to is null or o.order_date < p_to)
      )::bigint as r_orders,
      coalesce(sum(i.price) filter (
        where (p_from is null or o.order_date >= p_from)
          and (p_to is null or o.order_date < p_to)
      ), 0) as r_revenue
    from public.order_items i
    join public.orders o on o.order_number = i.order_number
    where o.order_status not in ('Cancelled')
    group by 1
  ),
  universe as (
    select s.sku from public.stock_items s
    union
    select p.sku from public.products p
    union
    select l.sku from life l
  ),
  joined as (
    select
      u.sku,
      coalesce(nullif(p.name, ''), nullif(s.product_name, ''), l.product_name, u.sku) as product_name,
      coalesce(s.category, p.section) as category,
      coalesce(s.vendor, p.vendor, p.publisher) as vendor,
      coalesce(s.ecom_stock, p.stock_qty) as ecom_stock,
      s.sap_stock,
      p.price,
      p.image,
      p.author,
      p.publisher,
      p.language,
      p.age,
      p.series,
      p.barcode,
      coalesce(l.r_units, 0)::bigint as units,
      coalesce(l.r_orders, 0)::bigint as orders,
      coalesce(l.r_revenue, 0) as revenue,
      coalesce(l.l_units, 0)::bigint as lifetime_units,
      coalesce(l.l_orders, 0)::bigint as lifetime_orders,
      coalesce(l.l_revenue, 0) as lifetime_revenue,
      l.first_order_date,
      l.last_order_date
    from universe u
    left join public.stock_items s on s.sku = u.sku
    left join public.products p on p.sku = u.sku
    left join life l on l.sku = u.sku
  ),
  filtered as (
    select * from joined j
    where (
        p_search is null or p_search = ''
        or j.product_name ilike '%' || p_search || '%'
        or j.sku ilike '%' || p_search || '%'
        or j.author ilike '%' || p_search || '%'
        or j.publisher ilike '%' || p_search || '%'
        or j.series ilike '%' || p_search || '%'
        or j.barcode ilike '%' || p_search || '%'
      )
      and case lower(coalesce(p_scope, 'all'))
            when 'sold' then j.units > 0
            when 'unsold' then j.units = 0
            when 'never' then j.lifetime_units = 0
            when 'ever' then j.lifetime_units > 0
            when 'oos' then coalesce(j.ecom_stock, 0) <= 0
            when 'instock' then coalesce(j.ecom_stock, 0) > 0
            else true
          end
  )
  select
    f.sku, f.product_name, f.category, f.vendor, f.ecom_stock, f.sap_stock,
    f.price, f.image, f.author, f.publisher, f.language, f.age, f.series, f.barcode,
    f.units, f.orders, f.revenue,
    f.lifetime_units, f.lifetime_orders, f.lifetime_revenue,
    f.first_order_date, f.last_order_date,
    count(*) over ()::bigint as total_count
  from filtered f
  order by
    case when lower(coalesce(p_sort, 'units')) = 'name' and lower(coalesce(p_dir, 'desc')) = 'asc' then f.product_name end asc nulls last,
    case when lower(coalesce(p_sort, 'units')) = 'name' and lower(coalesce(p_dir, 'desc')) <> 'asc' then f.product_name end desc nulls last,
    case when lower(coalesce(p_sort, 'units')) = 'sku' and lower(coalesce(p_dir, 'desc')) = 'asc' then f.sku end asc nulls last,
    case when lower(coalesce(p_sort, 'units')) = 'sku' and lower(coalesce(p_dir, 'desc')) <> 'asc' then f.sku end desc nulls last,
    (case when lower(coalesce(p_dir, 'desc')) = 'asc' then 1 else -1 end) *
    (case lower(coalesce(p_sort, 'units'))
       when 'orders' then f.orders::numeric
       when 'revenue' then f.revenue
       when 'lifetime_units' then f.lifetime_units::numeric
       when 'lifetime_orders' then f.lifetime_orders::numeric
       when 'lifetime_revenue' then f.lifetime_revenue
       when 'stock' then coalesce(f.ecom_stock, 0)::numeric
       when 'price' then coalesce(f.price, 0)
       when 'last_sale' then coalesce(extract(epoch from f.last_order_date), 0)::numeric
       else f.units::numeric
     end) asc nulls last,
    f.sku asc
  limit greatest(coalesce(p_limit, 100), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke execute on function public.fn_catalog_products(timestamptz, timestamptz, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.fn_catalog_products(timestamptz, timestamptz, text, text, text, text, integer, integer) to authenticated;

-- totals must be redefined too: it selects * from the function above
drop function if exists public.fn_catalog_products_totals(timestamptz, timestamptz, text, text);
create or replace function public.fn_catalog_products_totals(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_search text default null,
  p_scope text default 'all'
)
returns table (
  products bigint,
  never_sold bigint,
  out_of_stock bigint,
  units bigint,
  orders bigint,
  revenue numeric,
  lifetime_units bigint,
  lifetime_revenue numeric
)
language sql stable set search_path = public
as $$
  with r as (
    select * from public.fn_catalog_products(p_from, p_to, p_search, p_scope, 'units', 'desc', 1000000, 0)
  )
  select
    count(*)::bigint,
    count(*) filter (where r.lifetime_units = 0)::bigint,
    count(*) filter (where coalesce(r.ecom_stock, 0) <= 0)::bigint,
    coalesce(sum(r.units), 0)::bigint,
    coalesce(sum(r.orders), 0)::bigint,
    coalesce(sum(r.revenue), 0),
    coalesce(sum(r.lifetime_units), 0)::bigint,
    coalesce(sum(r.lifetime_revenue), 0)
  from r;
$$;

revoke execute on function public.fn_catalog_products_totals(timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.fn_catalog_products_totals(timestamptz, timestamptz, text, text) to authenticated;
