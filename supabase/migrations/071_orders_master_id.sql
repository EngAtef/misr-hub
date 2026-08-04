-- ============================================================
-- Migration 071: "unique customers" everywhere = unique PEOPLE.
--
-- Follows 070_customer_identity.sql. Four KPI functions counted
-- `count(distinct customer_id)` over public.orders, i.e. platform
-- ACCOUNTS — so a customer who checked out once as a guest and once
-- signed in counted twice. Resolving the person per row with a
-- function call was correct but cost ~2.6s on the all-time KPI query,
-- so the resolved person id is stored on the order itself.
--
--   orders.master_id       person the order belongs to
--   trg_orders_master_id   keeps it right for newly imported orders
--   fn_rebuild_customer_identities  refreshes it on every rebuild
--
-- The KPI functions are patched by rewriting their stored definition
-- (pg_get_functiondef -> replace -> execute) so the rest of each
-- function stays exactly as its own migration wrote it.
--
-- Run after 070_customer_identity.sql
-- ============================================================

-- Resolve any platform account id to the PERSON it belongs to.
create or replace function public.master_id(p text)
returns text
language sql stable
set search_path = public
as $fn$
  select coalesce((select l.master_id from public.customer_links l where l.customer_id = p), p);
$fn$;

alter table public.orders add column if not exists master_id text;
create index if not exists idx_orders_master_id on public.orders (master_id);

update public.orders o
set master_id = l.master_id
from public.customer_links l
where l.customer_id = o.customer_id
  and o.master_id is distinct from l.master_id;

update public.orders o
set master_id = o.customer_id
where o.master_id is null and o.customer_id is not null;

create or replace function public.trg_orders_master_id()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.master_id := public.master_id(new.customer_id);
  return new;
end;
$fn$;

drop trigger if exists orders_set_master_id on public.orders;
create trigger orders_set_master_id
  before insert or update of customer_id on public.orders
  for each row execute function public.trg_orders_master_id();

-- Every rebuild re-points the orders at their (possibly new) person.
do $mig$
declare def text; newdef text; ins text;
begin
  ins := concat_ws(E'\n',
    '  update public.orders o',
    '  set master_id = l.master_id',
    '  from public.customer_links l',
    '  where l.customer_id = o.customer_id',
    '    and o.master_id is distinct from l.master_id;',
    '',
    '  delete from public.customer_identities;');

  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fn_rebuild_customer_identities';

  newdef := replace(def, '  delete from public.customer_identities;', ins);
  if newdef = def then
    raise exception 'anchor not found in fn_rebuild_customer_identities';
  end if;
  execute newdef;
end
$mig$;

-- fn_kpis / fn_campaign_stats / fn_vendor_kpis / fn_vendor_grp_kpis.
-- The two vendor functions build a narrow CTE first, so master_id has
-- to be added to that CTE's select list before the count can use it.
do $mig$
declare r record; def text; newdef text;
begin
  for r in
    select p.oid, p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.prosrc like '%count(distinct customer_id)%'
  loop
    def := pg_get_functiondef(r.oid);
    newdef := replace(def, 'o.customer_id, o.order_date,', 'o.customer_id, o.master_id, o.order_date,');
    newdef := replace(newdef,
      'select o.order_number, o.order_status, o.customer_id, i.product_name',
      'select o.order_number, o.order_status, o.customer_id, o.master_id, i.product_name');
    newdef := replace(newdef,
      'count(distinct customer_id)',
      'count(distinct coalesce(master_id, customer_id))');
    begin
      execute newdef;
    exception when others then
      raise notice 'could not patch %: %', r.proname, sqlerrm;
      execute def;
    end;
  end loop;
end
$mig$;

-- RFM and the period customer insights read the stored person id too,
-- instead of joining customer_links for every order row.
do $mig$
declare r record; def text; newdef text;
begin
  for r in
    select p.oid from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('fn_rfm_summary','fn_rfm_customers','fn_customer_insights')
  loop
    def := pg_get_functiondef(r.oid);
    newdef := replace(def, '    left join public.customer_links l on l.customer_id = o.customer_id' || E'\n', '');
    newdef := replace(newdef, 'coalesce(l.master_id, o.customer_id)', 'coalesce(o.master_id, o.customer_id)');
    if newdef <> def then execute newdef; end if;
  end loop;
end
$mig$;

-- Pure helpers: no reason for the anonymous role to reach them.
revoke execute on function public.master_id(text) from public, anon;
revoke execute on function public.rfm_segment(numeric, numeric) from public, anon;
