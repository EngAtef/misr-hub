-- ============================================================
-- Migration 036: promo codes (platform Promos export).
-- One row per promo code; orders reference it via applied_offer
-- (verified: uses in the export matches applied_offer counts).
-- type: 1 = fixed EGP, 2 = percent, 3 = free delivery, 4 = gift.
-- Also adds the applied_offer dim to fn_breakdown so the orders
-- page can offer a promo filter with real usage counts.
-- Run after 035_orders_category_filter.sql
-- ============================================================

create table if not exists public.promo_codes (
  id bigint primary key,
  name text not null,
  description text,
  amount numeric,
  minimum_order_amount numeric,
  type integer,
  uses integer,
  start_date timestamptz,
  expiration_date timestamptz,
  max_uses_per_user numeric,
  max_usage_limit numeric,
  free_delivery boolean,
  active boolean,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_promo_codes_name on public.promo_codes (name);
alter table public.promo_codes enable row level security;
drop policy if exists promo_codes_read on public.promo_codes;
create policy promo_codes_read on public.promo_codes for select using (public.my_role() in ('admin','manager','viewer'));
drop policy if exists promo_codes_write on public.promo_codes;
create policy promo_codes_write on public.promo_codes for insert with check (public.my_role() in ('admin','manager'));
drop policy if exists promo_codes_update on public.promo_codes;
create policy promo_codes_update on public.promo_codes for update using (public.my_role() in ('admin','manager'));
drop policy if exists promo_codes_delete on public.promo_codes;
create policy promo_codes_delete on public.promo_codes for delete using (public.my_role() in ('admin','manager'));

create or replace function public.fn_upsert_promo_codes(p_rows jsonb)
returns integer
language plpgsql set search_path = public
as $$
declare n integer;
begin
  if public.my_role() not in ('admin','manager') then
    raise exception 'Forbidden';
  end if;
  insert into public.promo_codes (
    id, name, description, amount, minimum_order_amount, type, uses,
    start_date, expiration_date, max_uses_per_user, max_usage_limit,
    free_delivery, active, updated_at
  )
  select
    (r->>'id')::bigint,
    r->>'name',
    nullif(r->>'description',''),
    nullif(r->>'amount','')::numeric,
    nullif(r->>'minimum_order_amount','')::numeric,
    nullif(r->>'type','')::integer,
    nullif(r->>'uses','')::integer,
    nullif(r->>'start_date','')::timestamptz,
    nullif(r->>'expiration_date','')::timestamptz,
    nullif(r->>'max_uses_per_user','')::numeric,
    nullif(r->>'max_usage_limit','')::numeric,
    nullif(r->>'free_delivery','')::integer::boolean,
    nullif(r->>'active','')::integer::boolean,
    now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'id','') <> '' and coalesce(r->>'name','') <> ''
  on conflict (id) do update set
    name = excluded.name,
    description = coalesce(excluded.description, promo_codes.description),
    amount = excluded.amount,
    minimum_order_amount = excluded.minimum_order_amount,
    type = excluded.type,
    uses = coalesce(excluded.uses, promo_codes.uses),
    start_date = excluded.start_date,
    expiration_date = excluded.expiration_date,
    max_uses_per_user = excluded.max_uses_per_user,
    max_usage_limit = excluded.max_usage_limit,
    free_delivery = excluded.free_delivery,
    active = excluded.active,
    updated_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

alter function public.fn_upsert_promo_codes(jsonb) set search_path = public;
revoke execute on function public.fn_upsert_promo_codes(jsonb) from public, anon;

-- fn_breakdown: add the applied_offer (promo code) dimension.
create or replace function public.fn_breakdown(p_dim text, p_from timestamptz, p_to timestamptz, p_limit integer default 30)
returns table (label text, orders bigint, revenue numeric, delivered bigint, cancelled_or_returned bigint)
language sql stable
as $$
  select
    coalesce(nullif(trim(case p_dim
      when 'city' then city
      when 'area' then area
      when 'payment_method' then payment_method
      when 'order_status' then order_status
      when 'delivery_status' then delivery_status
      when 'source' then source
      when 'store_name' then store_name
      when 'branch_name' then branch_name
      when 'cancellation_reason' then cancellation_reason
      when 'applied_promotion' then applied_promotion
      when 'applied_offer' then applied_offer
      when 'campaign_id' then campaign_id
    end), ''), '(none)') as label,
    count(*) as orders,
    coalesce(sum(total_order_amount), 0) as revenue,
    count(*) filter (where order_status = 'Delivered') as delivered,
    count(*) filter (where order_status in ('Cancelled', 'Returned', 'Return Sent To Erp', 'Return Request')) as cancelled_or_returned
  from public.orders
  where (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < p_to)
  group by 1
  order by 2 desc
  limit p_limit;
$$;

-- re-pin search_path (014 lockdown) after the recreate above
alter function public.fn_breakdown(text, timestamptz, timestamptz, integer) set search_path = public;
