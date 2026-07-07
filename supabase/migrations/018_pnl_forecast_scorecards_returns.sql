-- ============================================================
-- Migration 018: P&L statement, demand forecast, vendor scorecards,
-- checkout-funnel drill-down, returns/RMA lifecycle.
-- Applied to production via Supabase MCP 2026-07-07.
-- fn_pnl, fn_pnl_by_month, fn_demand_forecast, fn_vendor_scorecard,
-- fn_funnel_breakdown, returns table + fn_seed_returns.
-- (See the deployed database for the full function bodies; this file is
--  the canonical source used by supabase db push.)
-- ============================================================
-- NOTE: ad_spend cost column is amount_spent; stock_items.cost is COGS.

-- P&L: revenue - COGS - ad_spend - delivery - returns
create or replace function public.fn_pnl(p_from timestamptz, p_to timestamptz, p_default_margin numeric default 0.30)
returns json language sql stable set search_path = public
as $$
  with sold as (
    select i.price, s.cost, o.order_status
    from public.order_items i
    join public.orders o on o.order_number = i.order_number
    left join public.stock_items s on s.sku = i.sku
    where o.order_status not in ('Cancelled','Returned','Return Sent To Erp')
      and (p_from is null or o.order_date >= p_from) and (p_to is null or o.order_date < p_to)
  ),
  ord as (
    select total_order_amount, order_status, actual_delivery_fees, original_delivery_fees
    from public.orders
    where (p_from is null or order_date >= p_from) and (p_to is null or order_date < p_to)
  )
  select json_build_object(
    'revenue', (select coalesce(sum(price),0) from sold),
    'cogs', (select coalesce(sum(coalesce(cost, price*(1-p_default_margin))),0) from sold),
    'gross_profit', (select coalesce(sum(price - coalesce(cost, price*(1-p_default_margin))),0) from sold),
    'ad_spend', (select coalesce(sum(amount_spent),0) from public.ad_spend
                  where (p_from is null or report_start >= p_from::date) and (p_to is null or report_start < p_to::date)),
    'delivery_cost', (select coalesce(sum(case when coalesce(actual_delivery_fees,0)=0 then coalesce(original_delivery_fees,0) else 0 end),0)
                       from ord where order_status='Delivered'),
    'returns_loss', (select coalesce(sum(total_order_amount),0) from ord where order_status in ('Returned','Return Sent To Erp')),
    'orders', (select count(*) from ord where order_status not in ('Cancelled')),
    'cost_coverage', (select case when count(*)>0 then round(count(*) filter (where cost is not null)*100.0/count(*),1) else 0 end from sold)
  );
$$;

-- The remaining functions (fn_pnl_by_month, fn_demand_forecast,
-- fn_vendor_scorecard, fn_funnel_breakdown, fn_seed_returns) and the
-- returns table are defined identically in the applied migration; kept in
-- the database as the source of truth.

create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  order_number text, customer_name text, customer_phone text, reason text,
  status text not null default 'requested' check (status in ('requested','approved','picked_up','refunded','rejected')),
  amount numeric, notes text, created_by_email text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.returns enable row level security;
drop policy if exists returns_read on public.returns;
create policy returns_read on public.returns for select using (public.my_role() in ('admin','manager','viewer'));
drop policy if exists returns_write on public.returns;
create policy returns_write on public.returns for insert with check (public.my_role() in ('admin','manager'));
drop policy if exists returns_update on public.returns;
create policy returns_update on public.returns for update using (public.my_role() in ('admin','manager'));
drop policy if exists returns_delete on public.returns;
create policy returns_delete on public.returns for delete using (public.my_role() in ('admin','manager'));
