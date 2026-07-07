-- ============================================================
-- Migration 017: GA4 "All time" bucket support
-- Multi-month GA4 uploads land under the sentinel month 2000-01-01,
-- shown as "All time (historical)". fn_ga4_summary compares that bucket's
-- traffic against ALL orders; a real monthly upload compares against just
-- that calendar month. Run after 016.
-- ============================================================
create or replace function public.fn_ga4_summary(p_month date)
returns json
language sql stable set search_path = public
as $$
  with g as (
    select * from public.ga4_pages where period_month = p_month
  ),
  o as (
    select count(*) as orders, coalesce(sum(total_order_amount),0) as revenue
    from public.orders
    where order_status not in ('Cancelled')
      and (
        p_month = date '2000-01-01'
        or (order_date >= p_month and order_date < p_month + interval '1 month')
      )
  )
  select json_build_object(
    'views', (select coalesce(sum(views),0) from g),
    'users', (select coalesce(sum(active_users),0) from g),
    'add_to_carts', (select coalesce(sum(add_to_carts),0) from g),
    'app_revenue', (select coalesce(sum(total_revenue),0) from g),
    'avg_bounce', (select avg(bounce_rate) from g where views > 100),
    'orders', (select orders from o),
    'order_revenue', (select revenue from o),
    'atc_rate', case when (select sum(views) from g) > 0 then (select sum(add_to_carts) from g) / (select sum(views) from g) else 0 end,
    'atc_to_order', case when (select sum(add_to_carts) from g) > 0 then (select orders from o)::numeric / (select sum(add_to_carts) from g) else 0 end
  );
$$;
