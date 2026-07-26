-- ============================================================
-- Migration 044: per-person abandonment history.
-- fn_abandoned_history(p_phone_norm) returns every cart tied to a
-- normalized phone (all statuses, anomalies included but flagged),
-- newest first, with that cart's items embedded as jsonb — powers
-- the history drawer opened from the Repeat Abandoners table.
-- Items are matched by cart_name + creation hour (the items export
-- carries no cart id).
-- Run after 043_abandoned_recovery_ops.sql
-- ============================================================

create or replace function public.fn_abandoned_history(p_phone_norm text)
returns table (
  cart_key text,
  full_name text,
  email text,
  phone text,
  created_at timestamptz,
  cart_value numeric,
  products_count integer,
  recall_status text,
  recall_note text,
  is_anomaly boolean,
  recovered_order_number text,
  recovered_at timestamptz,
  recovered_value numeric,
  customer_id text,
  items jsonb
)
language sql stable set search_path = public
as $$
  select
    ac.cart_key,
    ac.full_name,
    ac.email,
    ac.phone,
    ac.created_at,
    ac.cart_value,
    ac.products_count,
    ac.recall_status,
    ac.recall_note,
    ac.is_anomaly,
    ac.recovered_order_number,
    ac.recovered_at,
    ac.recovered_value,
    ac.customer_id,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'sku', i.sku,
        'product_name', i.product_name,
        'qty', i.qty
      ) order by i.product_name)
      from public.abandoned_cart_items i
      where i.cart_name = ac.full_name
        and i.created_at between ac.created_at - interval '1 hour' and ac.created_at + interval '1 hour'
    ), '[]'::jsonb) as items
  from public.abandoned_carts ac
  where ac.phone_norm = p_phone_norm
  order by ac.created_at desc
  limit 100
$$;
revoke execute on function public.fn_abandoned_history(text) from public, anon;
grant execute on function public.fn_abandoned_history(text) to authenticated;
