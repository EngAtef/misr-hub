-- ============================================================
-- Migration 024: product-level sales lines (ProductSalesExport).
-- One row per (order, sku) with category/brand hierarchy and
-- discount detail the OrderExport lacks. Re-uploads update rows
-- (e.g. status Confirmed -> Delivered).
-- Run after 023_customer_lifetime_stats.sql
-- ============================================================

create table if not exists public.product_sales (
  order_id text not null,
  sku text not null,
  status text,
  order_date timestamptz,
  month_year text,
  payment_method text,
  product_name text,
  category text,
  sub_category text,
  group_name text,
  brand text,
  unit_price numeric,
  unit_price_after_discount numeric,
  quantity numeric,
  price numeric,
  price_after_discount numeric,
  total_amount numeric,
  branch_name text,
  promotion text,
  custom_discount text,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (order_id, sku)
);
create index if not exists idx_product_sales_sku on public.product_sales (sku);
create index if not exists idx_product_sales_date on public.product_sales (order_date);
create index if not exists idx_product_sales_brand on public.product_sales (brand);
alter table public.product_sales enable row level security;
drop policy if exists product_sales_read on public.product_sales;
create policy product_sales_read on public.product_sales for select using (public.my_role() in ('admin','manager','viewer'));
drop policy if exists product_sales_write on public.product_sales;
create policy product_sales_write on public.product_sales for insert with check (public.my_role() in ('admin','manager'));
drop policy if exists product_sales_update on public.product_sales;
create policy product_sales_update on public.product_sales for update using (public.my_role() in ('admin','manager'));
drop policy if exists product_sales_delete on public.product_sales;
create policy product_sales_delete on public.product_sales for delete using (public.my_role() in ('admin','manager'));

-- Upsert sales lines, then enrich stock_items with brand/category per
-- SKU (fills gaps only — never overwrites curated vendor/category).
create or replace function public.fn_upsert_product_sales(p_rows jsonb)
returns integer
language plpgsql set search_path = public
as $$
declare n integer;
begin
  if public.my_role() not in ('admin','manager') then
    raise exception 'Forbidden';
  end if;
  insert into public.product_sales (
    order_id, sku, status, order_date, month_year, payment_method,
    product_name, category, sub_category, group_name, brand,
    unit_price, unit_price_after_discount, quantity,
    price, price_after_discount, total_amount,
    branch_name, promotion, custom_discount, updated_at
  )
  select
    r->>'order_id', r->>'sku',
    nullif(r->>'status',''),
    nullif(r->>'order_date','')::timestamptz,
    nullif(r->>'month_year',''),
    nullif(r->>'payment_method',''),
    nullif(r->>'product_name',''),
    nullif(r->>'category',''),
    nullif(r->>'sub_category',''),
    nullif(r->>'group_name',''),
    nullif(r->>'brand',''),
    nullif(r->>'unit_price','')::numeric,
    nullif(r->>'unit_price_after_discount','')::numeric,
    nullif(r->>'quantity','')::numeric,
    nullif(r->>'price','')::numeric,
    nullif(r->>'price_after_discount','')::numeric,
    nullif(r->>'total_amount','')::numeric,
    nullif(r->>'branch_name',''),
    nullif(r->>'promotion',''),
    nullif(r->>'custom_discount',''),
    now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'order_id','') <> '' and coalesce(r->>'sku','') <> ''
  on conflict (order_id, sku) do update set
    status = coalesce(excluded.status, product_sales.status),
    order_date = coalesce(excluded.order_date, product_sales.order_date),
    month_year = coalesce(excluded.month_year, product_sales.month_year),
    payment_method = coalesce(excluded.payment_method, product_sales.payment_method),
    product_name = coalesce(excluded.product_name, product_sales.product_name),
    category = coalesce(excluded.category, product_sales.category),
    sub_category = coalesce(excluded.sub_category, product_sales.sub_category),
    group_name = coalesce(excluded.group_name, product_sales.group_name),
    brand = coalesce(excluded.brand, product_sales.brand),
    unit_price = coalesce(excluded.unit_price, product_sales.unit_price),
    unit_price_after_discount = coalesce(excluded.unit_price_after_discount, product_sales.unit_price_after_discount),
    quantity = coalesce(excluded.quantity, product_sales.quantity),
    price = coalesce(excluded.price, product_sales.price),
    price_after_discount = coalesce(excluded.price_after_discount, product_sales.price_after_discount),
    total_amount = coalesce(excluded.total_amount, product_sales.total_amount),
    branch_name = coalesce(excluded.branch_name, product_sales.branch_name),
    promotion = coalesce(excluded.promotion, product_sales.promotion),
    custom_discount = coalesce(excluded.custom_discount, product_sales.custom_discount),
    updated_at = now();
  get diagnostics n = row_count;

  -- connect to the stock/vendor world: fill missing vendor (= brand),
  -- category and name on stock_items for the SKUs we just saw
  insert into public.stock_items (sku, product_name, category, vendor, updated_at)
  select distinct on (r->>'sku')
    r->>'sku', nullif(r->>'product_name',''), nullif(r->>'category',''), nullif(r->>'brand',''), now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'sku','') <> ''
  on conflict (sku) do update set
    product_name = coalesce(stock_items.product_name, excluded.product_name),
    category = coalesce(stock_items.category, excluded.category),
    vendor = coalesce(stock_items.vendor, excluded.vendor),
    updated_at = now();

  return n;
end;
$$;

-- Sales rollup by category / brand for the products page.
create or replace function public.fn_product_sales_breakdown(p_by text default 'category', p_from timestamptz default null, p_to timestamptz default null)
returns table (
  key text, lines bigint, units numeric, revenue numeric, discounted_revenue numeric, discount_amount numeric
)
language sql stable set search_path = public
as $$
  select
    coalesce(
      case when p_by = 'brand' then brand
           when p_by = 'group' then group_name
           when p_by = 'sub_category' then sub_category
           else category end,
      '—'
    ) as key,
    count(*) as lines,
    coalesce(sum(quantity), 0) as units,
    coalesce(sum(price), 0) as revenue,
    coalesce(sum(coalesce(price_after_discount, price)), 0) as discounted_revenue,
    coalesce(sum(coalesce(price, 0) - coalesce(price_after_discount, price, 0)), 0) as discount_amount
  from public.product_sales
  where (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < p_to)
    and coalesce(status, '') not in ('Cancelled')
  group by 1
  order by revenue desc;
$$;

alter function public.fn_upsert_product_sales(jsonb) set search_path = public;
alter function public.fn_product_sales_breakdown(text, timestamptz, timestamptz) set search_path = public;
revoke execute on function public.fn_upsert_product_sales(jsonb) from public, anon;
revoke execute on function public.fn_product_sales_breakdown(text, timestamptz, timestamptz) from public, anon;
