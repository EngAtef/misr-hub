-- ============================================================
-- Migration 082: a stock file is a snapshot, not a patch.
--
-- fn_upsert_stock merged every upload with coalesce(): a SKU that was
-- missing from the new file kept whatever number it had last time, and a
-- file that only spoke for one side still stamped a single updated_at for
-- both. Two things went wrong in practice:
--
--   * SAP was last uploaded on 29 Jul, yet 3,523 SKUs were re-stamped
--     into the 5 Aug snapshot with those 29 Jul warehouse numbers, so the
--     history says "as of 5 Aug" about stock nobody had counted since Jul.
--   * A material that has dropped out of the SAP export (no unrestricted
--     stock left) kept its old quantity forever, and the engine happily
--     proposed moving copies that are not in the warehouse.
--
-- From here on an upload declares its side — 'ecom', 'sap' or 'both' —
-- and that side is REPLACED wholesale:
--   fn_upsert_stock_side()   writes the file's values for its side only,
--                            a 0 included, and stamps when it was taken
--   fn_finalize_stock_side() settles every SKU the file did NOT mention:
--                            SAP -> 0 (not in the warehouse export means
--                            none on hand), e-com -> null (not in the
--                            storefront export means not listed at all),
--                            then writes the day's snapshot for that side
--                            alone, leaving the other side's column as it
--                            was.
--
-- fn_upsert_stock stays as the merging path — the costs upload and the
-- catalogue sync each carry one column and must not wipe the rest.
-- Run after 081_ads_backfill_queue.sql
-- ============================================================

-- 1) When was each side last counted? -------------------------
alter table public.stock_items
  add column if not exists ecom_stock_at timestamptz,
  add column if not exists sap_stock_at  timestamptz;

comment on column public.stock_items.ecom_stock_at is 'When the storefront stock snapshot that produced ecom_stock was taken';
comment on column public.stock_items.sap_stock_at  is 'When the SAP export that produced sap_stock was taken';

-- Backfill e-com from the row stamp: every upload so far touched e-com.
update public.stock_items
   set ecom_stock_at = updated_at
 where ecom_stock is not null and ecom_stock_at is null;

-- SAP has no such stamp, but it leaves a signature in the history: a SAP
-- upload covers the whole material master (~8k SKUs) while an e-com one
-- covers the storefront catalogue (~3.7k). The most recent day whose
-- snapshot carries far more SAP rows than e-com rows is the last real SAP
-- file; midday is used because the export has no clock.
with sap_upload_days as (
  select snapshot_date, count(sap_stock) as sap_rows, count(ecom_stock) as ecom_rows
    from public.stock_snapshots
   group by snapshot_date
), last_sap as (
  select max(snapshot_date) as day from sap_upload_days where sap_rows > ecom_rows * 1.5
)
update public.stock_items s
   set sap_stock_at = ((select day from last_sap) + time '12:00') at time zone 'utc'
 where s.sap_stock is not null
   and s.sap_stock_at is null
   and (select day from last_sap) is not null;

create index if not exists idx_stock_items_sap_at  on public.stock_items (sap_stock_at);
create index if not exists idx_stock_items_ecom_at on public.stock_items (ecom_stock_at);

-- The same signature cleans the history the old merge left behind: on a day
-- that only saw an e-com file, the warehouse column was re-stamped with the
-- previous SAP upload's numbers. Those readings were never taken, so the
-- stock trend charts a straight line that never happened.
with sap_upload_days as (
  select snapshot_date, count(sap_stock) as sap_rows, count(ecom_stock) as ecom_rows
    from public.stock_snapshots
   group by snapshot_date
)
update public.stock_snapshots s
   set sap_stock = null
  from sap_upload_days d
 where d.snapshot_date = s.snapshot_date
   and d.sap_rows <= d.ecom_rows * 1.5
   and s.sap_stock is not null;

delete from public.stock_snapshots where ecom_stock is null and sap_stock is null;

-- 2) Write one side of a snapshot -----------------------------
-- Called once per chunk. Unlike fn_upsert_stock this does NOT coalesce the
-- side it owns: the file's number wins outright, so a book that fell to
-- zero actually reads zero. The other side is untouched.
create or replace function public.fn_upsert_stock_side(
  p_rows jsonb,
  p_side text,
  p_taken_at timestamptz default now()
)
returns integer
language plpgsql set search_path = public
as $$
declare n integer;
begin
  if public.my_role() not in ('admin','manager') then raise exception 'Forbidden'; end if;
  if p_side not in ('ecom','sap','both') then raise exception 'Unknown stock side: %', p_side; end if;

  insert into public.stock_items (
    sku, product_name, ecom_stock, sap_stock, category, vendor,
    ecom_stock_at, sap_stock_at, updated_at
  )
  select distinct on (r->>'sku')
    r->>'sku',
    nullif(r->>'product_name',''),
    case when p_side in ('ecom','both') then nullif(r->>'ecom_stock','')::integer end,
    case when p_side in ('sap','both')  then nullif(r->>'sap_stock','')::integer  end,
    nullif(r->>'category',''),
    nullif(r->>'vendor',''),
    case when p_side in ('ecom','both') then p_taken_at end,
    case when p_side in ('sap','both')  then p_taken_at end,
    now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'sku','') <> ''
  order by r->>'sku'
  on conflict (sku) do update set
    product_name  = coalesce(excluded.product_name, stock_items.product_name),
    ecom_stock    = case when p_side in ('ecom','both') then excluded.ecom_stock else stock_items.ecom_stock end,
    sap_stock     = case when p_side in ('sap','both')  then excluded.sap_stock  else stock_items.sap_stock  end,
    ecom_stock_at = case when p_side in ('ecom','both') then p_taken_at else stock_items.ecom_stock_at end,
    sap_stock_at  = case when p_side in ('sap','both')  then p_taken_at else stock_items.sap_stock_at  end,
    category      = coalesce(excluded.category, stock_items.category),
    vendor        = coalesce(excluded.vendor, stock_items.vendor),
    updated_at    = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 3) Settle the SKUs the file left out ------------------------
-- p_skus is every SKU the file carried. Anything else on record has just
-- been contradicted by the snapshot and is written down accordingly. Then
-- the day's history row is written for this side only.
create or replace function public.fn_finalize_stock_side(
  p_skus jsonb,
  p_side text,
  p_taken_at timestamptz default now()
)
returns jsonb
language plpgsql set search_path = public
as $$
declare
  v_day date;
  v_ecom_cleared integer := 0;
  v_sap_zeroed integer := 0;
begin
  if public.my_role() not in ('admin','manager') then raise exception 'Forbidden'; end if;
  if p_side not in ('ecom','sap','both') then raise exception 'Unknown stock side: %', p_side; end if;
  v_day := (p_taken_at at time zone 'utc')::date;

  create temp table if not exists _snapshot_skus (sku text primary key) on commit drop;
  insert into _snapshot_skus (sku)
  select distinct x from jsonb_array_elements_text(p_skus) x
   where coalesce(x,'') <> ''
  on conflict (sku) do nothing;
  -- without stats the planner reads the list as ~100 rows and picks a nested
  -- loop over 8k stock rows; one analyze turns both anti-joins into hashes
  analyze _snapshot_skus;

  -- A SKU absent from the storefront export is not on the storefront at
  -- all: unknown, not zero — it never gets a "restock me" reading.
  if p_side in ('ecom','both') then
    update public.stock_items s
       set ecom_stock = null, ecom_stock_at = p_taken_at, updated_at = now()
     where s.ecom_stock is not null
       and not exists (select 1 from _snapshot_skus k where k.sku = s.sku);
    get diagnostics v_ecom_cleared = row_count;
  end if;

  -- A material absent from the SAP export has no unrestricted stock, so
  -- zero is the honest number and the engine stops proposing moves.
  if p_side in ('sap','both') then
    update public.stock_items s
       set sap_stock = 0, sap_stock_at = p_taken_at, updated_at = now()
     where s.sap_stock is distinct from 0
       and s.sap_stock is not null
       and not exists (select 1 from _snapshot_skus k where k.sku = s.sku);
    get diagnostics v_sap_zeroed = row_count;
  end if;

  -- History: only the uploaded side is written, so a day that saw an
  -- e-com file alone no longer claims to know the warehouse.
  if p_side in ('ecom','both') then
    insert into public.stock_snapshots (snapshot_date, sku, ecom_stock)
    select v_day, s.sku, s.ecom_stock
      from public.stock_items s
     where s.ecom_stock is not null
    on conflict (snapshot_date, sku) do update set
      ecom_stock = excluded.ecom_stock, created_at = now();
  end if;

  if p_side in ('sap','both') then
    insert into public.stock_snapshots (snapshot_date, sku, sap_stock)
    select v_day, s.sku, s.sap_stock
      from public.stock_items s
     where s.sap_stock is not null
    on conflict (snapshot_date, sku) do update set
      sap_stock = excluded.sap_stock, created_at = now();
  end if;

  drop table if exists _snapshot_skus;

  return jsonb_build_object(
    'side', p_side,
    'taken_at', p_taken_at,
    'ecom_cleared', v_ecom_cleared,
    'sap_zeroed', v_sap_zeroed,
    'ecom_skus', (select count(ecom_stock) from public.stock_items),
    'sap_skus',  (select count(sap_stock)  from public.stock_items)
  );
end;
$$;

-- 4) The merging path keeps working, but now stamps its side --
-- The costs upload and the catalogue sync both come through here: each
-- carries one column for a subset of SKUs and must leave the rest alone.
create or replace function public.fn_upsert_stock(p_rows jsonb)
returns integer
language plpgsql set search_path = public
as $$
declare
  n integer;
  v_has_ecom boolean;
  v_has_sap boolean;
begin
  if public.my_role() not in ('admin','manager') then raise exception 'Forbidden'; end if;

  select bool_or(nullif(r->>'ecom_stock','') is not null),
         bool_or(nullif(r->>'sap_stock','')  is not null)
    into v_has_ecom, v_has_sap
    from jsonb_array_elements(p_rows) r;

  insert into public.stock_items (
    sku, product_name, ecom_stock, sap_stock, category, vendor, cost,
    ecom_stock_at, sap_stock_at, updated_at
  )
  select distinct on (r->>'sku')
    r->>'sku', nullif(r->>'product_name',''),
    nullif(r->>'ecom_stock','')::integer, nullif(r->>'sap_stock','')::integer,
    nullif(r->>'category',''), nullif(r->>'vendor',''), nullif(r->>'cost','')::numeric,
    case when nullif(r->>'ecom_stock','') is not null then now() end,
    case when nullif(r->>'sap_stock','')  is not null then now() end,
    now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'sku','') <> ''
  order by r->>'sku'
  on conflict (sku) do update set
    product_name  = coalesce(excluded.product_name, stock_items.product_name),
    ecom_stock    = coalesce(excluded.ecom_stock, stock_items.ecom_stock),
    sap_stock     = coalesce(excluded.sap_stock, stock_items.sap_stock),
    ecom_stock_at = coalesce(excluded.ecom_stock_at, stock_items.ecom_stock_at),
    sap_stock_at  = coalesce(excluded.sap_stock_at, stock_items.sap_stock_at),
    category      = coalesce(excluded.category, stock_items.category),
    vendor        = coalesce(excluded.vendor, stock_items.vendor),
    cost          = coalesce(excluded.cost, stock_items.cost),
    updated_at    = now();
  get diagnostics n = row_count;

  -- Same-day history for the touched SKUs — but only for a column this
  -- file actually carried. Copying the other side forward is what made the
  -- old snapshots claim a warehouse count nobody had taken that day.
  if v_has_ecom then
    insert into public.stock_snapshots (snapshot_date, sku, ecom_stock)
    select (now() at time zone 'utc')::date, s.sku, s.ecom_stock
    from public.stock_items s
    where s.sku in (select r->>'sku' from jsonb_array_elements(p_rows) r where coalesce(r->>'sku','') <> '')
      and s.ecom_stock is not null
    on conflict (snapshot_date, sku) do update set
      ecom_stock = excluded.ecom_stock, created_at = now();
  end if;

  if v_has_sap then
    insert into public.stock_snapshots (snapshot_date, sku, sap_stock)
    select (now() at time zone 'utc')::date, s.sku, s.sap_stock
    from public.stock_items s
    where s.sku in (select r->>'sku' from jsonb_array_elements(p_rows) r where coalesce(r->>'sku','') <> '')
      and s.sap_stock is not null
    on conflict (snapshot_date, sku) do update set
      sap_stock = excluded.sap_stock, created_at = now();
  end if;

  return n;
end;
$$;

-- 4b) The catalogue upload registers SKUs, it does not count them
-- A FullProductExport carries a stock column too, and routing it through
-- the merge above let a week-old catalogue download quietly walk the store
-- stock backwards — and then stamp it as freshly counted. The e-com stock
-- card owns that number now; the catalogue only seeds SKUs nobody has ever
-- counted, and never writes a history row.
create or replace function public.fn_upsert_stock_catalog(p_rows jsonb)
returns integer
language plpgsql set search_path = public
as $$
declare n integer;
begin
  if public.my_role() not in ('admin','manager') then raise exception 'Forbidden'; end if;
  insert into public.stock_items (
    sku, product_name, ecom_stock, category, vendor, ecom_stock_at, updated_at
  )
  select distinct on (r->>'sku')
    r->>'sku',
    nullif(r->>'product_name',''),
    nullif(r->>'ecom_stock','')::integer,
    nullif(r->>'category',''),
    nullif(r->>'vendor',''),
    case when nullif(r->>'ecom_stock','') is not null then now() end,
    now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'sku','') <> ''
  order by r->>'sku'
  on conflict (sku) do update set
    product_name  = coalesce(excluded.product_name, stock_items.product_name),
    category      = coalesce(excluded.category, stock_items.category),
    vendor        = coalesce(excluded.vendor, stock_items.vendor),
    ecom_stock    = coalesce(stock_items.ecom_stock, excluded.ecom_stock),
    ecom_stock_at = coalesce(stock_items.ecom_stock_at, excluded.ecom_stock_at),
    updated_at    = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 5) How fresh is each side? ----------------------------------
-- The Stock page used max(updated_at) across the table, which reported
-- "updated today" while the warehouse column was a week old.
create or replace function public.fn_stock_freshness()
returns table (side text, taken_at timestamptz, skus bigint, in_stock bigint, units bigint)
language sql stable set search_path = public
as $$
  select 'ecom'::text,
         max(ecom_stock_at),
         count(ecom_stock),
         count(*) filter (where ecom_stock > 0),
         coalesce(sum(ecom_stock), 0)::bigint
    from public.stock_items
  union all
  select 'sap'::text,
         max(sap_stock_at),
         count(sap_stock),
         count(*) filter (where sap_stock > 0),
         coalesce(sum(sap_stock), 0)::bigint
    from public.stock_items;
$$;

-- 6) What would this file change? -----------------------------
-- Read before importing, so the Data Center can say "1,204 SKUs on record
-- are not in this file and will be written down to zero" instead of
-- silently doing it.
create or replace function public.fn_stock_snapshot_preview(p_skus jsonb, p_side text)
returns jsonb
language sql stable set search_path = public
as $$
  with keep as (
    select distinct x as sku from jsonb_array_elements_text(p_skus) x where coalesce(x,'') <> ''
  )
  select jsonb_build_object(
    'side', p_side,
    'matched',      count(*) filter (where k.sku is not null),
    'ecom_missing', count(*) filter (where s.ecom_stock is not null and k.sku is null),
    'sap_missing',  count(*) filter (where s.sap_stock is not null and s.sap_stock <> 0 and k.sku is null),
    'sap_missing_units', coalesce(sum(s.sap_stock) filter (where s.sap_stock > 0 and k.sku is null), 0)
  )
  from public.stock_items s
  left join keep k on k.sku = s.sku;
$$;

grant execute on function public.fn_stock_snapshot_preview(jsonb, text)           to authenticated;
grant execute on function public.fn_upsert_stock_catalog(jsonb)                   to authenticated;
grant execute on function public.fn_upsert_stock_side(jsonb, text, timestamptz)   to authenticated;
grant execute on function public.fn_finalize_stock_side(jsonb, text, timestamptz) to authenticated;
grant execute on function public.fn_stock_freshness()                             to authenticated;
