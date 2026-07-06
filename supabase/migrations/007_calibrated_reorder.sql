-- ============================================================
-- Misr Hub - Migration 007: reorder engine v2 (calibrated)
-- Calibrated against the team's real restock list (restock28june):
-- ~45-day cover of recent velocity, pack-size rounding, 150-unit cap,
-- and stock-out detection (sold well before, zero recent sales).
-- Run after 006_products_ads_targets_team.sql
-- ============================================================

drop function if exists public.fn_reorder_suggestions(integer, integer, integer);

create or replace function public.fn_reorder_suggestions(
  p_period_days integer default 30,
  p_cover_days integer default 45,
  p_min_units integer default 3,
  p_max_order integer default 150
)
returns table (
  sku text, product_name text,
  units_recent bigint, units_prior bigint,
  velocity_per_day numeric, trend_pct numeric,
  projected_demand numeric, current_stock integer,
  lead_time_days integer, days_of_cover numeric,
  suggested_reorder numeric, priority text
)
language sql stable
as $$
  with base as (
    select coalesce(nullif(i.sku,''),'(no sku)') as sku,
      mode() within group (order by i.product_name) as product_name,
      count(*) filter (where o.order_date >= now() - make_interval(days => p_period_days)) as units_recent,
      count(*) filter (where o.order_date >= now() - make_interval(days => p_period_days*2)
                         and o.order_date < now() - make_interval(days => p_period_days)) as units_prior,
      count(*) filter (where o.order_date >= now() - make_interval(days => p_period_days*4)
                         and o.order_date < now() - make_interval(days => p_period_days)) as units_hist
    from public.order_items i
    join public.orders o on o.order_number = i.order_number
    where o.order_status not in ('Cancelled')
      and o.order_date >= now() - make_interval(days => p_period_days*4)
    group by 1
  ),
  calc as (
    select b.*,
      s.current_stock,
      coalesce(s.lead_time_days, 7) as lead_days,
      b.units_recent::numeric / greatest(p_period_days, 1) as vel,
      (b.units_recent = 0 and b.units_hist >= 10) as is_stockout
    from base b
    left join public.stock_items s on s.sku = b.sku
    where b.units_recent >= p_min_units
       or (b.units_recent = 0 and b.units_hist >= 10)
  ),
  demand as (
    select c.*,
      case when c.is_stockout
        then (c.units_hist::numeric / greatest(p_period_days*3, 1)) * (p_cover_days + c.lead_days)
        else c.vel * (p_cover_days + c.lead_days)
      end as proj
    from calc c
  ),
  final as (
    select d.*,
      greatest(d.proj - coalesce(d.current_stock, 0), 0) as gap
    from demand d
  )
  select
    f.sku, f.product_name, f.units_recent, f.units_prior,
    round(f.vel, 3) as velocity_per_day,
    case when f.units_prior = 0 then null
         else round((f.units_recent - f.units_prior)::numeric * 100 / f.units_prior, 1) end as trend_pct,
    round(f.proj, 1) as projected_demand,
    f.current_stock,
    f.lead_days as lead_time_days,
    case when f.current_stock is null or f.vel = 0 then null
         else round(f.current_stock / f.vel, 1) end as days_of_cover,
    case when f.gap <= 0 then 0
         else least(
           coalesce((select min(p) from unnest(array[1,2,3,4,5,6,8,10,12,15,20,25,30,40,50,75,100,150,200,300]) p
                     where p >= f.gap), p_max_order),
           p_max_order)
    end::numeric as suggested_reorder,
    case
      when f.is_stockout then 'stockout'
      when f.current_stock is not null and f.vel > 0
           and f.current_stock / f.vel < f.lead_days then 'urgent'
      when f.units_recent >= p_min_units * 3 and f.current_stock is null then 'high'
      when f.units_prior > 0 and (f.units_recent - f.units_prior)::numeric / f.units_prior > 0.5 then 'rising'
      else 'normal'
    end as priority
  from final f
  order by (case when f.is_stockout then 0 else 1 end), f.units_recent desc;
$$;

-- Reference table holding the team's last manual restock list (for comparison)
create table if not exists public.restock_reference (
  sku text primary key, product_name text, requested_qty integer, list_date date default '2026-06-28'
);
alter table public.restock_reference enable row level security;
drop policy if exists restock_ref_read on public.restock_reference;
create policy restock_ref_read on public.restock_reference for select using (public.my_role() in ('admin','manager','viewer'));
