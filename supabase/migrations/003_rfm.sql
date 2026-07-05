-- ============================================================
-- Misr Hub - Migration 003: RFM customer segmentation
-- Run after 002_campaigns.sql
-- ============================================================

-- Shared RFM logic: per-customer recency / frequency / monetary,
-- classified into actionable marketing segments.
--   champions   : 3+ orders, bought in last 60 days
--   loyal       : 2+ orders, bought in last 120 days
--   new         : 1 order, within last 30 days
--   promising   : 1 order, 31-90 days ago
--   at_risk     : 2+ orders, but silent for 120+ days
--   hibernating : 1 order, silent for 90+ days

create or replace function public.fn_rfm_summary()
returns table (
  segment text,
  customers bigint,
  total_revenue numeric,
  avg_orders numeric,
  avg_spend numeric,
  avg_recency_days numeric
)
language sql stable
as $$
  with base as (
    select
      customer_id,
      count(*) as freq,
      sum(total_order_amount) as monetary,
      extract(epoch from (now() - max(order_date))) / 86400.0 as recency
    from public.orders
    where customer_id is not null
      and order_status not in ('Cancelled')
      and order_date is not null
    group by customer_id
  ),
  seg as (
    select *,
      case
        when freq >= 3 and recency <= 60 then 'champions'
        when freq >= 2 and recency <= 120 then 'loyal'
        when freq = 1 and recency <= 30 then 'new'
        when freq = 1 and recency <= 90 then 'promising'
        when freq >= 2 then 'at_risk'
        else 'hibernating'
      end as segment
    from base
  )
  select
    segment,
    count(*) as customers,
    coalesce(sum(monetary), 0) as total_revenue,
    round(avg(freq), 2) as avg_orders,
    round(coalesce(avg(monetary), 0), 0) as avg_spend,
    round(avg(recency), 0) as avg_recency_days
  from seg
  group by segment
  order by total_revenue desc;
$$;

create or replace function public.fn_rfm_customers(p_segment text, p_limit integer default 500)
returns table (
  customer_id text,
  customer_name text,
  customer_phone text,
  city text,
  orders bigint,
  total_spent numeric,
  last_order_date timestamptz,
  recency_days numeric
)
language sql stable
as $$
  with base as (
    select
      o.customer_id,
      max(o.customer_name) as customer_name,
      max(o.customer_phone) as customer_phone,
      max(o.city) as city,
      count(*) as freq,
      sum(o.total_order_amount) as monetary,
      max(o.order_date) as last_order,
      extract(epoch from (now() - max(o.order_date))) / 86400.0 as recency
    from public.orders o
    where o.customer_id is not null
      and o.order_status not in ('Cancelled')
      and o.order_date is not null
    group by o.customer_id
  ),
  seg as (
    select *,
      case
        when freq >= 3 and recency <= 60 then 'champions'
        when freq >= 2 and recency <= 120 then 'loyal'
        when freq = 1 and recency <= 30 then 'new'
        when freq = 1 and recency <= 90 then 'promising'
        when freq >= 2 then 'at_risk'
        else 'hibernating'
      end as segment
    from base
  )
  select
    customer_id,
    customer_name,
    customer_phone,
    city,
    freq as orders,
    coalesce(monetary, 0) as total_spent,
    last_order as last_order_date,
    round(recency, 0) as recency_days
  from seg
  where segment = p_segment
  order by monetary desc nulls last
  limit p_limit;
$$;
