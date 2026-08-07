-- 086: search a book on the GAPS page and see every order with its proven
-- source — or its gap. One row per (order, matched SKU); the source verdict
-- is order-level: what GA4 recorded for that transaction, bucketed the same
-- way as fn_gaps_report. An order with no GA4 record is only called a gap
-- when GA4 has actually synced past that day — otherwise it is just late.

create or replace function public.fn_gaps_book_orders(
  p_query text,
  p_from date default null,
  p_to date default null,
  p_limit integer default 400
)
returns table(
  order_number text,
  order_date timestamptz,
  order_status text,
  app_channel text,
  payment_method text,
  city text,
  order_total numeric,
  sku text,
  product_name text,
  item_price numeric,
  ga4_source text,
  ga4_medium text,
  ga4_campaign text,
  bucket text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with ga4_edge as (
    select max(date) as last_day from public.ga4_daily where sessions > 0
  )
  select
    o.order_number,
    o.order_date,
    o.order_status,
    o.source,
    o.payment_method,
    o.city,
    o.total_order_amount,
    oi.sku,
    oi.product_name,
    oi.price,
    t.source,
    t.medium,
    t.campaign,
    case
      when t.source is null and o.order_date::date > (select last_day from ga4_edge) then 'awaiting'
      when t.source is null then 'gap'
      when t.source ~* 'facebook|instagram|meta' or t.source ~* '^(fb|ig|adv)$'
        or t.medium ~* '^(paid|adv|static|post|parent)' then 'meta'
      when t.source = 'google' and t.medium = 'cpc' then 'google_ads'
      when t.source = 'google' and t.medium = 'organic' then 'google_organic'
      when t.source ~* 'bit\.ly' then 'shortlinks'
      when t.source = '(direct)' then 'direct'
      else 'other'
    end
  from public.order_items oi
  join public.orders o on o.order_number = oi.order_number
  left join public.ga4_transactions t
    on t.transaction_id = o.order_number
   and t.period_month = date_trunc('month', o.order_date)::date
  where (oi.sku ilike '%' || p_query || '%' or oi.product_name ilike '%' || p_query || '%')
    and (p_from is null or o.order_date >= p_from)
    and (p_to is null or o.order_date < p_to + 1)
    and length(trim(p_query)) >= 3
    and (select public.my_role()) in ('admin', 'manager', 'viewer')
  order by o.order_date desc
  limit least(greatest(p_limit, 1), 1000);
$$;

grant execute on function public.fn_gaps_book_orders(text, date, date, integer) to authenticated;
