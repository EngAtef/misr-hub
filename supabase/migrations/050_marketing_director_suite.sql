-- ============================================================
-- Migration 050: Marketing Studio director suite
--   * norm_ar            Arabic title normalizer (immutable)
--   * fn_marketing_advisor   "what to promote next" ranking
--   * fn_post_sales_impact   post → real sales attribution
--   * fn_best_post_hours     store's real order-hour peaks
--   * marketing_posts: post_wa / ab_group / read_url columns
-- Run after 049_marketing_plan.sql
-- ============================================================

-- Arabic-insensitive matching: strip tashkeel/tatweel, unify alef
-- forms, ta-marbuta and alef-maqsura, drop punctuation noise.
create or replace function public.norm_ar(t text)
returns text
language sql immutable set search_path = public
as $$
  select regexp_replace(
    translate(lower(coalesce(t, '')), 'أإآءةى', 'اااهي'),
    '[ً-ٟـ،؛:.!؟?"''«»()\[\]—_*-]', '', 'g'
  );
$$;

alter table public.marketing_posts
  add column if not exists post_wa text not null default '',
  add column if not exists ab_group uuid,
  add column if not exists read_url text;

-- What should we market next? Ranks SKUs by marketing opportunity:
--   rising    recent velocity clearly up vs the previous window
--   overstock plenty of e-com stock that needs pushing
--   margin    known cost with healthy margin
--   bestseller steady high velocity
create or replace function public.fn_marketing_advisor(p_limit integer default 25)
returns table (
  sku text,
  product_name text,
  category text,
  units_30 bigint,
  units_prev_30 bigint,
  trend_pct numeric,
  revenue_30 numeric,
  ecom_stock numeric,
  cover_days numeric,
  margin_pct numeric,
  tags text[],
  score numeric
)
language sql stable security definer set search_path = public
as $$
  with recent as (
    select oi.sku, max(oi.product_name) as product_name,
           count(*) as units_30, sum(coalesce(oi.price, 0)) as revenue_30
    from public.order_items oi
    join public.orders o on o.order_number = oi.order_number
    where o.order_date >= now() - interval '30 days'
      and coalesce(o.order_status, '') not ilike '%cancel%'
      and oi.sku is not null and oi.sku <> ''
    group by oi.sku
  ),
  prev as (
    select oi.sku, count(*) as units_prev_30
    from public.order_items oi
    join public.orders o on o.order_number = oi.order_number
    where o.order_date >= now() - interval '60 days'
      and o.order_date < now() - interval '30 days'
      and coalesce(o.order_status, '') not ilike '%cancel%'
      and oi.sku is not null and oi.sku <> ''
    group by oi.sku
  ),
  joined as (
    select r.sku,
           coalesce(s.product_name, r.product_name) as product_name,
           s.category,
           r.units_30,
           coalesce(p.units_prev_30, 0) as units_prev_30,
           case when coalesce(p.units_prev_30, 0) > 0
                then round((r.units_30 - p.units_prev_30) * 100.0 / p.units_prev_30, 1)
                else null end as trend_pct,
           r.revenue_30,
           coalesce(s.ecom_stock, 0)::numeric as ecom_stock,
           case when r.units_30 > 0
                then round(coalesce(s.ecom_stock, 0) * 30.0 / r.units_30, 0)
                else null end as cover_days,
           case when coalesce(s.cost, 0) > 0 and r.units_30 > 0
                then round((r.revenue_30 / r.units_30 - s.cost) * 100.0 / nullif(r.revenue_30 / r.units_30, 0), 0)
                else null end as margin_pct
    from recent r
    left join prev p on p.sku = r.sku
    left join public.stock_items s on s.sku = r.sku
    where r.units_30 >= 3
  )
  select j.sku, j.product_name, j.category, j.units_30, j.units_prev_30,
         j.trend_pct, j.revenue_30, j.ecom_stock, j.cover_days, j.margin_pct,
         array_remove(array[
           case when j.trend_pct is not null and j.trend_pct >= 30 then 'rising' end,
           case when j.ecom_stock >= 20 and j.cover_days is not null and j.cover_days > 90 then 'overstock' end,
           case when j.margin_pct is not null and j.margin_pct >= 40 then 'margin' end,
           case when j.units_30 >= 30 then 'bestseller' end
         ], null) as tags,
         round(
           j.units_30
           + greatest(coalesce(j.trend_pct, 0), 0) * 0.5
           + case when j.ecom_stock >= 20 and j.cover_days is not null and j.cover_days > 90 then 15 else 0 end
           + coalesce(j.margin_pct, 0) * 0.2
         , 1) as score
  from joined j
  where public.my_role() in ('admin', 'manager', 'viewer')
  order by score desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- Did the post move sales? Compares delivered-intent orders containing the
-- book (normalized-title match) in the N days after publishing vs the N days
-- before. Revenue = the matched items' line prices.
create or replace function public.fn_post_sales_impact(
  p_keyword text,
  p_published timestamptz,
  p_days integer default 7
)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with matched as (
    select o.order_number, o.order_date, coalesce(oi.price, 0) as price
    from public.order_items oi
    join public.orders o on o.order_number = oi.order_number
    where public.norm_ar(oi.product_name) like '%' || public.norm_ar(p_keyword) || '%'
      and coalesce(o.order_status, '') not ilike '%cancel%'
      and o.order_date >= p_published - make_interval(days => p_days)
      and o.order_date < p_published + make_interval(days => p_days)
  )
  select case when public.my_role() in ('admin', 'manager', 'viewer') then
    jsonb_build_object(
      'before_orders', (select count(distinct order_number) from matched where order_date < p_published),
      'before_units',  (select count(*) from matched where order_date < p_published),
      'before_revenue',(select coalesce(sum(price), 0) from matched where order_date < p_published),
      'after_orders',  (select count(distinct order_number) from matched where order_date >= p_published),
      'after_units',   (select count(*) from matched where order_date >= p_published),
      'after_revenue', (select coalesce(sum(price), 0) from matched where order_date >= p_published),
      'days', p_days
    )
  end;
$$;

-- The store's real posting-time signal: orders by hour-of-day and by
-- day-of-week over the last 90 days. order_date stores Egypt wall time.
create or replace function public.fn_best_post_hours()
returns jsonb
language sql stable security definer set search_path = public
as $$
  with base as (
    select extract(hour from order_date)::int as h,
           extract(isodow from order_date)::int as d
    from public.orders
    where order_date >= now() - interval '90 days'
      and coalesce(order_status, '') not ilike '%cancel%'
  )
  select case when public.my_role() in ('admin', 'manager', 'viewer') then
    jsonb_build_object(
      'hours', (select coalesce(jsonb_agg(jsonb_build_object('h', h, 'orders', c) order by h), '[]'::jsonb)
                from (select h, count(*) as c from base group by h) x),
      'dows',  (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'orders', c) order by d), '[]'::jsonb)
                from (select d, count(*) as c from base group by d) x)
    )
  end;
$$;

revoke execute on function public.fn_marketing_advisor(integer) from anon, public;
revoke execute on function public.fn_post_sales_impact(text, timestamptz, integer) from anon, public;
revoke execute on function public.fn_best_post_hours() from anon, public;
grant execute on function public.fn_marketing_advisor(integer) to authenticated;
grant execute on function public.fn_post_sales_impact(text, timestamptz, integer) to authenticated;
grant execute on function public.fn_best_post_hours() to authenticated;
grant execute on function public.norm_ar(text) to authenticated, anon;
