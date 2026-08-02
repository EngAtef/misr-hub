-- ============================================================
-- Migration 068: delivery quality — one view that joins delivery
-- speed, ratings, cancellations and returns on the same orders.
--
-- The three facts already lived in the DB but never met:
--   * shipping_date / delivery_date  (20.5k orders carry both)
--   * customer_rating / driver_rating (3k rated orders)
--   * cancellation_reason             (11 distinct reasons)
--
-- fn_delivery_quality() returns every section of the report in one
-- jsonb payload so the page makes a single round trip instead of
-- pulling 60k order rows into the browser the way /delivery does.
--
-- Cancellation reasons arrive from the platform in two shapes —
-- "Ordered by mistake" and "Ordered by mistake | تم الطلب بالخطأ" —
-- so everything is keyed on the part before the pipe.
-- ============================================================

create or replace function public.fn_delivery_quality(
  p_from timestamptz default null,
  p_to   timestamptz default null,
  p_min_orders integer default 50
)
returns jsonb
language sql stable set search_path = public
as $$
  with base as (
    select
      o.order_number,
      coalesce(nullif(trim(o.city), ''), '—')           as city,
      coalesce(nullif(trim(o.payment_method), ''), '—') as payment_method,
      o.total_order_amount,
      o.customer_rating,
      o.driver_rating,
      btrim(split_part(coalesce(o.cancellation_reason, ''), '|', 1)) as reason,
      o.order_status ilike '%cancel%'                        as is_cancelled,
      o.order_status ilike '%return%'                        as is_returned,
      o.delivery_status ilike '%Returned to Shipper%'        as is_rts,
      o.order_status = 'Delivered'                           as is_delivered,
      case
        when o.delivery_date is not null and o.order_date is not null
         and o.delivery_date::date >= o.order_date::date
        then (o.delivery_date::date - o.order_date::date)
      end as days,
      case
        when o.shipping_date is not null and o.order_date is not null
         and o.shipping_date::date >= o.order_date::date
        then (o.shipping_date::date - o.order_date::date)
      end as handling_days
    from public.orders o
    where (p_from is null or o.order_date >= p_from)
      and (p_to   is null or o.order_date <= p_to)
  ),
  -- delivery-speed buckets, ordered
  speed as (
    select
      case
        when days <= 1  then '0-1'
        when days <= 3  then '2-3'
        when days <= 7  then '4-7'
        when days <= 14 then '8-14'
        else '15+'
      end as bucket,
      case
        when days <= 1  then 1
        when days <= 3  then 2
        when days <= 7  then 3
        when days <= 14 then 4
        else 5
      end as bucket_order,
      *
    from base
    where days is not null
  )
  select jsonb_build_object(
    'summary', (
      select jsonb_build_object(
        'orders',        count(*),
        'delivered',     count(*) filter (where is_delivered),
        'cancelled',     count(*) filter (where is_cancelled),
        'returned',      count(*) filter (where is_returned),
        'rts',           count(*) filter (where is_rts),
        'lost_value',    round(coalesce(sum(total_order_amount) filter (where is_cancelled or is_returned), 0)),
        'avg_days',      round(avg(days)::numeric, 1),
        'median_days',   percentile_cont(0.5) within group (order by days),
        'avg_handling_days', round(avg(handling_days)::numeric, 1),
        'rated',         count(customer_rating),
        'avg_customer_rating', round(avg(customer_rating)::numeric, 2),
        'avg_driver_rating',   round(avg(driver_rating)::numeric, 2),
        'cancel_pct',    round(100.0 * count(*) filter (where is_cancelled) / nullif(count(*), 0), 1),
        'return_pct',    round(100.0 * count(*) filter (where is_returned)  / nullif(count(*), 0), 1)
      )
      from base
    ),

    -- where are we losing orders: one row per city
    'by_city', coalesce((
      select jsonb_agg(x order by x.cancel_pct desc nulls last)
      from (
        select
          city,
          count(*)                                      as orders,
          count(*) filter (where is_delivered)          as delivered,
          count(*) filter (where is_cancelled)          as cancelled,
          count(*) filter (where is_returned)           as returned,
          count(*) filter (where is_rts)                as rts,
          round(coalesce(sum(total_order_amount) filter (where is_cancelled or is_returned), 0)) as lost_value,
          round(avg(days)::numeric, 1)                  as avg_days,
          round(avg(handling_days)::numeric, 1)         as handling_days,
          count(customer_rating)                        as rated,
          round(avg(customer_rating)::numeric, 2)       as customer_rating,
          round(avg(driver_rating)::numeric, 2)         as driver_rating,
          round(100.0 * count(*) filter (where is_cancelled) / nullif(count(*), 0), 1) as cancel_pct,
          round(100.0 * count(*) filter (where is_returned)  / nullif(count(*), 0), 1) as return_pct,
          round(100.0 * count(*) filter (where is_rts)       / nullif(count(*), 0), 1) as rts_pct
        from base
        group by city
        having count(*) >= p_min_orders
      ) x
    ), '[]'::jsonb),

    -- does slow delivery actually cost us anything?
    'by_speed', coalesce((
      select jsonb_agg(x order by x.bucket_order)
      from (
        select
          bucket,
          bucket_order,
          count(*)                                as orders,
          round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1) as share_pct,
          count(customer_rating)                  as rated,
          round(avg(customer_rating)::numeric, 2) as customer_rating,
          round(avg(driver_rating)::numeric, 2)   as driver_rating,
          count(*) filter (where is_returned)     as returned,
          round(100.0 * count(*) filter (where is_returned) / nullif(count(*), 0), 1) as return_pct,
          round(avg(total_order_amount)::numeric) as aov
        from speed
        group by bucket, bucket_order
      ) x
    ), '[]'::jsonb),

    -- why customers cancel, with the money attached
    'by_reason', coalesce((
      select jsonb_agg(x order by x.orders desc)
      from (
        select
          reason,
          count(*)                                          as orders,
          round(coalesce(sum(total_order_amount), 0))       as value,
          round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1) as share_pct,
          round(avg(days)::numeric, 1)                      as avg_days,
          (
            select b2.city
            from base b2
            where b2.reason = b.reason
            group by b2.city
            order by count(*) desc
            limit 1
          ) as top_city
        from base b
        where reason <> ''
        group by reason
      ) x
    ), '[]'::jsonb),

    -- payment method is the other half of the cancellation story (COD)
    'by_payment', coalesce((
      select jsonb_agg(x order by x.orders desc)
      from (
        select
          payment_method,
          count(*)                                as orders,
          round(avg(days)::numeric, 1)            as avg_days,
          round(100.0 * count(*) filter (where is_cancelled) / nullif(count(*), 0), 1) as cancel_pct,
          round(100.0 * count(*) filter (where is_returned)  / nullif(count(*), 0), 1) as return_pct,
          round(avg(customer_rating)::numeric, 2) as customer_rating,
          round(coalesce(sum(total_order_amount) filter (where is_cancelled or is_returned), 0)) as lost_value
        from base
        group by payment_method
        having count(*) >= p_min_orders
      ) x
    ), '[]'::jsonb),

    -- rating distribution, both sides
    'ratings', coalesce((
      select jsonb_agg(x order by x.kind, x.rating)
      from (
        select 'customer' as kind, customer_rating as rating, count(*) as orders
        from base where customer_rating is not null group by customer_rating
        union all
        select 'driver', driver_rating, count(*)
        from base where driver_rating is not null group by driver_rating
      ) x
    ), '[]'::jsonb)
  );
$$;

comment on function public.fn_delivery_quality(timestamptz, timestamptz, integer) is
  'Delivery speed x ratings x cancellations x returns, per city / speed bucket / reason / payment method. One jsonb payload per call.';

revoke all on function public.fn_delivery_quality(timestamptz, timestamptz, integer) from anon, public;
grant execute on function public.fn_delivery_quality(timestamptz, timestamptz, integer) to authenticated;
