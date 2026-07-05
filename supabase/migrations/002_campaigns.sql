-- ============================================================
-- Misr Hub - Migration 002: campaign management
-- Run after 001_init.sql
-- ============================================================

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null default 'other' check (channel in ('facebook', 'instagram', 'tiktok', 'google', 'email', 'sms', 'whatsapp', 'influencer', 'offline', 'other')),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'completed')),
  budget numeric default 0,
  spent numeric default 0,
  start_date date,
  end_date date,
  promo_code text,
  campaign_key text,
  target_audience text,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.campaigns enable row level security;

drop policy if exists campaigns_read on public.campaigns;
create policy campaigns_read on public.campaigns
  for select using (public.my_role() in ('admin', 'manager', 'viewer'));

drop policy if exists campaigns_insert on public.campaigns;
create policy campaigns_insert on public.campaigns
  for insert with check (public.my_role() in ('admin', 'manager'));

drop policy if exists campaigns_update on public.campaigns;
create policy campaigns_update on public.campaigns
  for update using (public.my_role() in ('admin', 'manager'));

drop policy if exists campaigns_delete on public.campaigns;
create policy campaigns_delete on public.campaigns
  for delete using (public.my_role() = 'admin');

-- Matches orders to a campaign by promo code and/or campaign key
create or replace function public.fn_campaign_stats(p_promo text, p_campaign_key text, p_from date, p_to date)
returns json
language sql stable
as $$
  select json_build_object(
    'orders', count(*),
    'revenue', coalesce(sum(total_order_amount), 0),
    'delivered', count(*) filter (where order_status = 'Delivered'),
    'cancelled', count(*) filter (where order_status in ('Cancelled', 'Returned', 'Return Sent To Erp')),
    'unique_customers', count(distinct customer_id),
    'avg_order_value', coalesce(avg(total_order_amount), 0)
  )
  from public.orders
  where (
      (p_promo is not null and p_promo <> '' and (applied_promotion = p_promo or applied_offer = p_promo))
      or (p_campaign_key is not null and p_campaign_key <> '' and campaign_id = p_campaign_key)
    )
    and (p_from is null or order_date >= p_from)
    and (p_to is null or order_date < (p_to + interval '1 day'));
$$;

-- Orders needing operational attention (OMS follow-up queue)
create or replace function public.fn_attention_orders(p_limit integer default 100)
returns table (
  order_number text,
  order_date timestamptz,
  order_status text,
  delivery_status text,
  customer_name text,
  customer_phone text,
  city text,
  total_order_amount numeric,
  days_open numeric,
  reason text
)
language sql stable
as $$
  select
    o.order_number, o.order_date, o.order_status, o.delivery_status,
    o.customer_name, o.customer_phone, o.city, o.total_order_amount,
    round(extract(epoch from (now() - o.order_date)) / 86400.0, 1) as days_open,
    case
      when o.order_status in ('Out For Delivery', 'Shipped', 'Picked by courier')
        and o.order_date < now() - interval '5 days' then 'stuck_in_delivery'
      when o.order_status = 'Return Request' then 'return_pending'
      when o.order_status in ('Placed', 'Confirmed') and o.order_date < now() - interval '3 days' then 'not_shipped'
      when o.order_status = 'Delivery Failed' then 'delivery_failed'
      else 'other'
    end as reason
  from public.orders o
  where
    (o.order_status in ('Out For Delivery', 'Shipped', 'Picked by courier') and o.order_date < now() - interval '5 days')
    or o.order_status = 'Return Request'
    or (o.order_status in ('Placed', 'Confirmed') and o.order_date < now() - interval '3 days')
    or o.order_status = 'Delivery Failed'
  order by o.order_date asc
  limit p_limit;
$$;
