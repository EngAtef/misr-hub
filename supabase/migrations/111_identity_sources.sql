-- ============================================================
-- Migration 111: how each customer was acquired.
--
-- customer_identities.first_source = GA4 bucket of the person's earliest
-- order (across linked accounts) — the acquisition channel; last_source =
-- the latest order's. Kept current two ways: an AFTER INSERT statement
-- trigger (fn_rebuild_customer_identities deletes+inserts the table, and
-- merge/split/import all go through it), and at the end of
-- fn_refresh_order_attribution (GA4 sync). NULL = that order had no GA4
-- transaction.
-- ============================================================

alter table public.customer_identities
  add column if not exists first_source text,
  add column if not exists last_source  text;

create index if not exists customer_identities_first_source_idx on public.customer_identities (first_source);

create or replace function public.fn_refresh_identity_sources()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  with per as (
    select o.master_id,
           (array_agg(o.attr_bucket order by o.order_date asc  nulls last))[1] as first_source,
           (array_agg(o.attr_bucket order by o.order_date desc nulls last))[1] as last_source
    from public.orders o
    where o.master_id is not null and o.order_date is not null
      and coalesce(o.order_status, '') <> 'Cancelled'
    group by o.master_id
  )
  update public.customer_identities i
     set first_source = p.first_source,
         last_source  = p.last_source
    from per p
   where p.master_id = i.master_id
     and (i.first_source is distinct from p.first_source or i.last_source is distinct from p.last_source);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.fn_refresh_identity_sources() from public, anon;
grant execute on function public.fn_refresh_identity_sources() to authenticated, service_role;

-- after every rebuild (delete + one insert statement) the columns come back
create or replace function public.trg_identity_sources()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.fn_refresh_identity_sources();
  return null;
end $$;
drop trigger if exists trg_identity_sources on public.customer_identities;
create trigger trg_identity_sources
  after insert on public.customer_identities
  for each statement execute function public.trg_identity_sources();

-- and after every attribution refresh (GA4 sync)
create or replace function public.fn_refresh_order_attribution(p_from date default null, p_to date default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  if (select public.my_role()) not in ('admin', 'manager') and not public.is_service_role() then
    raise exception 'not allowed';
  end if;
  update public.orders o
     set attr_bucket   = public.ga4_source_bucket(t.source, t.medium),
         attr_source   = t.source,
         attr_medium   = t.medium,
         attr_campaign = nullif(t.campaign, '(not set)')
    from public.ga4_transactions t
   where t.transaction_id = o.order_number
     and (p_from is null or o.order_date >= p_from)
     and (p_to   is null or o.order_date <  p_to)
     and (o.attr_bucket is distinct from public.ga4_source_bucket(t.source, t.medium)
          or o.attr_source is distinct from t.source
          or o.attr_medium is distinct from t.medium
          or o.attr_campaign is distinct from nullif(t.campaign, '(not set)'));
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform public.fn_refresh_identity_sources();
  end if;
  return v_n;
end $$;

select public.fn_refresh_identity_sources();
