-- ============================================================
-- Migration 043: recovery operations pack for the Abandoned Center.
--  * fn_abandoned_recall_stats      weekly recall funnel (contacted /
--    responded / recovered + value) for the outcome chart
--  * fn_abandoned_audience          reachable carts containing a SKU or
--    a catalog category -> per-product / per-category retargeting lists
--  * fn_abandoned_categories        category options for that picker
--  * fn_abandoned_promo_attribution orders that used the recovery promo
--    code (all + auto-recovered subset)
--  * recovery promo code setting    app_settings key 'abandoned_recovery'
--    via SECURITY DEFINER get/set fns (admin/manager; not a secret)
--  * fn_chatwoot_abandoned_hint     token-gated lookup so the after-hours
--    bot can drop a private note when a chatting customer has an
--    abandoned cart (same token pattern as fn_chatwoot_bot_config)
-- Run after 042_abandoned_date_filter.sql
-- ============================================================

create or replace function public.fn_abandoned_recall_stats()
returns table (week date, contacted bigint, responded bigint, recovered bigint, recovered_value numeric)
language sql stable set search_path = public
as $$
  with c as (
    select date_trunc('week', recalled_at)::date as w, count(*) as n
    from public.abandoned_carts
    where recalled_at is not null and not is_anomaly
    group by 1
  ),
  resp as (
    select date_trunc('week', updated_at)::date as w, count(*) as n
    from public.abandoned_carts
    where recall_status = 'responded' and not is_anomaly
    group by 1
  ),
  r as (
    select date_trunc('week', recovered_at)::date as w, count(*) as n,
           coalesce(sum(coalesce(recovered_value, cart_value)), 0) as v
    from public.abandoned_carts
    where recovered_at is not null and not is_anomaly
    group by 1
  )
  , weeks as (
    select w from c union select w from resp union select w from r
  )
  select
    weeks.w as week,
    coalesce(c.n, 0) as contacted,
    coalesce(resp.n, 0) as responded,
    coalesce(r.n, 0) as recovered,
    coalesce(r.v, 0) as recovered_value
  from weeks
  left join c on c.w = weeks.w
  left join resp on resp.w = weeks.w
  left join r on r.w = weeks.w
  order by 1
$$;
revoke execute on function public.fn_abandoned_recall_stats() from public, anon;
grant execute on function public.fn_abandoned_recall_stats() to authenticated;

create or replace function public.fn_abandoned_audience(
  p_sku text default null,
  p_category text default null,
  p_from date default null,
  p_to date default null
)
returns table (
  full_name text, phone text, phone_norm text, email text,
  cart_value numeric, created_at timestamptz, recall_status text, customer_id text
)
language sql stable set search_path = public
as $$
  select distinct on (ac.cart_key)
    ac.full_name, ac.phone, ac.phone_norm, ac.email,
    ac.cart_value, ac.created_at, ac.recall_status, ac.customer_id
  from public.abandoned_carts ac
  join public.abandoned_cart_items i
    on i.cart_name = ac.full_name
   and i.created_at between ac.created_at - interval '1 hour' and ac.created_at + interval '1 hour'
  left join public.stock_items s on s.sku = i.sku
  where not ac.is_anomaly
    and (ac.phone_norm is not null or ac.email is not null)
    and ac.recall_status in ('new', 'contacted', 'responded')
    and (p_from is null or ac.created_at >= p_from)
    and (p_to is null or ac.created_at < p_to + interval '1 day')
    and (
      (p_sku is not null and i.sku = p_sku)
      or (p_sku is null and p_category is not null and s.category = p_category)
    )
  order by ac.cart_key, ac.created_at desc
  limit 20000
$$;
revoke execute on function public.fn_abandoned_audience(text, text, date, date) from public, anon;
grant execute on function public.fn_abandoned_audience(text, text, date, date) to authenticated;

create or replace function public.fn_abandoned_categories()
returns table (category text, items bigint)
language sql stable set search_path = public
as $$
  select s.category, count(*) as items
  from public.abandoned_cart_items i
  join public.stock_items s on s.sku = i.sku
  where s.category is not null and s.category <> ''
  group by 1
  order by 2 desc
  limit 100
$$;
revoke execute on function public.fn_abandoned_categories() from public, anon;
grant execute on function public.fn_abandoned_categories() to authenticated;

create or replace function public.fn_abandoned_promo_attribution(p_code text)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'all_orders', (
      select count(*) from public.orders
      where applied_offer ilike p_code
    ),
    'all_value', (
      select coalesce(sum(total_order_amount), 0) from public.orders
      where applied_offer ilike p_code
    ),
    'recovered_orders', (
      select count(*) from public.orders o
      join public.abandoned_carts ac on ac.recovered_order_number = o.order_number
      where o.applied_offer ilike p_code
    ),
    'recovered_value', (
      select coalesce(sum(o.total_order_amount), 0) from public.orders o
      join public.abandoned_carts ac on ac.recovered_order_number = o.order_number
      where o.applied_offer ilike p_code
    )
  )
$$;
revoke execute on function public.fn_abandoned_promo_attribution(text) from public, anon;
grant execute on function public.fn_abandoned_promo_attribution(text) to authenticated;

-- Recovery promo code (marketing setting, not a secret) — SECURITY DEFINER
-- so managers can read/set it even though app_settings RLS is admin-only.
create or replace function public.fn_abandoned_recovery_code()
returns text
language sql stable security definer set search_path = public
as $$
  select case when public.my_role() in ('admin','manager','viewer')
    then (select value->>'promo_code' from public.app_settings where key = 'abandoned_recovery')
    else null end
$$;
revoke all on function public.fn_abandoned_recovery_code() from public, anon;
grant execute on function public.fn_abandoned_recovery_code() to authenticated;

create or replace function public.fn_abandoned_set_recovery_code(p_code text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if public.my_role() not in ('admin','manager') then
    raise exception 'Forbidden';
  end if;
  insert into public.app_settings (key, value)
  values ('abandoned_recovery', jsonb_build_object('promo_code', coalesce(trim(p_code), '')))
  on conflict (key) do update
    set value = jsonb_set(coalesce(app_settings.value, '{}'::jsonb), '{promo_code}', to_jsonb(coalesce(trim(p_code), '')));
end;
$$;
revoke all on function public.fn_abandoned_set_recovery_code(text) from public, anon;
grant execute on function public.fn_abandoned_set_recovery_code(text) to authenticated;

-- Bot hint: does this phone have an active abandoned cart? Token-gated the
-- same way as fn_chatwoot_bot_config (URL token = stored webhook_token or
-- the WEBHOOK_TOKEN env handled app-side). Returns null when no match.
create or replace function public.fn_chatwoot_abandoned_hint(p_token text, p_phone text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case
    when not exists (
      select 1 from public.app_settings
      where key = 'chatwoot_bot' and value->>'webhook_token' = p_token
    ) then null
    else (
      select jsonb_build_object(
        'carts', count(*),
        'total_value', coalesce(sum(cart_value), 0),
        'latest_value', (array_agg(cart_value order by created_at desc))[1],
        'latest_products', (array_agg(products_count order by created_at desc))[1],
        'latest_date', (array_agg(created_at order by created_at desc))[1]
      )
      from public.abandoned_carts
      where phone_norm = public.norm_eg_phone(p_phone)
        and not is_anomaly
        and recall_status in ('new', 'contacted', 'responded')
      having count(*) > 0
    )
  end
$$;
revoke all on function public.fn_chatwoot_abandoned_hint(text, text) from public;
grant execute on function public.fn_chatwoot_abandoned_hint(text, text) to anon, authenticated;
