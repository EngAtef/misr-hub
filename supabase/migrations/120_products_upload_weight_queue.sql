-- ============================================================
-- Migration 120: products upload no longer dies on the weight recompute.
--
-- Symptom: uploading FullProductExport failed with "needs manager or
-- admin role" even for the owner (admin, active). The role check was
-- fine — the real failure was the recompute tail of fn_upsert_products:
-- with every product carrying a weight, EACH 400-row chunk re-weighed
-- ~6,700 orders and ~11,400 abandoned carts (~10s measured) and blew
-- the authenticated role's 8s statement_timeout. And it updated 0 rows,
-- because the weights had not changed. The client mapped any error to
-- the role message.
--
-- Fix:
--   1) fn_upsert_products recomputes only for SKUs whose weight actually
--      CHANGED (or that are new) — a re-upload of the same file now skips
--      the recompute entirely;
--   2) when a mass weight change does arrive (> 100 changed SKUs in a
--      chunk), the SKUs go to weight_recompute_queue instead and a
--      pg_cron job drains it in batches — the upload stays fast and the
--      corrected weights flow to orders/carts within minutes.
-- Run after 119.
-- ============================================================

create table if not exists public.weight_recompute_queue (
  sku text primary key,
  queued_at timestamptz not null default now()
);
alter table public.weight_recompute_queue enable row level security;
-- written only from security-definer paths / cron; no client policies needed

create or replace function public.fn_upsert_products(p_rows jsonb)
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  n integer;
  v_changed text[];
  v_orders text[];
  v_carts text[];
begin
  if (select public.my_role()) not in ('admin', 'manager') then
    raise exception 'Forbidden';
  end if;

  -- which incoming weights actually change anything? (must look before the upsert)
  select array_agg(x.sku) into v_changed
  from (
    select r->>'sku' as sku,
           nullif(regexp_replace(coalesce(r->>'weight_kg', ''), '[^0-9.]', '', 'g'), '')::numeric as w
    from jsonb_array_elements(p_rows) r
    where coalesce(r->>'weight_kg', '') <> '' and coalesce(r->>'sku', '') <> ''
  ) x
  left join public.products p on p.sku = x.sku
  where x.w is not null and (p.sku is null or p.weight_kg is distinct from x.w);

  insert into public.products (
    sku, name, english_name, price, stock, stock_qty, section, category,
    language, age, series, publisher, author, other_authors, translated_from,
    book_type, cover_type, paper_type, pages, dimensions, semester,
    link, release_date, description, image, barcode, vendor, attributes, weight_kg, updated_at
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
    nullif(regexp_replace(coalesce(r->>'weight_kg', ''), '[^0-9.]', '', 'g'), '')::numeric,
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
    weight_kg = coalesce(excluded.weight_kg, products.weight_kg),
    updated_at = now();

  get diagnostics n = row_count;

  if v_changed is not null then
    if array_length(v_changed, 1) <= 100 then
      -- small fix (e.g. one corrected weight): flow it through immediately
      select array_agg(distinct order_id) into v_orders
      from public.product_sales where sku = any(v_changed);
      if v_orders is not null then
        perform public.fn_recompute_order_weights(v_orders);
      end if;

      select array_agg(distinct ac.cart_key) into v_carts
      from public.abandoned_carts ac
      where ac.skus && v_changed;
      if v_carts is not null then
        perform public.fn_recompute_cart_weights(v_carts);
      end if;
    else
      -- mass change: queue it, the cron drain re-weighs within minutes
      insert into public.weight_recompute_queue (sku)
      select unnest(v_changed)
      on conflict (sku) do nothing;
    end if;
  end if;

  return n;
end;
$function$;

-- Drains up to 400 queued SKUs per run; a no-op costs one index probe.
create or replace function public.fn_drain_weight_queue()
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  v_skus text[];
  v_orders text[];
  v_carts text[];
begin
  select array_agg(sku) into v_skus
  from (select sku from public.weight_recompute_queue order by queued_at limit 400) q;
  if v_skus is null then
    return 0;
  end if;

  select array_agg(distinct order_id) into v_orders
  from public.product_sales where sku = any(v_skus);
  if v_orders is not null then
    perform public.fn_recompute_order_weights(v_orders);
  end if;

  select array_agg(distinct ac.cart_key) into v_carts
  from public.abandoned_carts ac where ac.skus && v_skus;
  if v_carts is not null then
    perform public.fn_recompute_cart_weights(v_carts);
  end if;

  delete from public.weight_recompute_queue where sku = any(v_skus);
  return array_length(v_skus, 1);
end;
$function$;

select cron.schedule('weight-queue-drain', '*/5 * * * *', $$select public.fn_drain_weight_queue()$$);
