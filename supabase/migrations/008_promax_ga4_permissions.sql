-- ============================================================
-- Migration 008: ProMax stock engine (two locations: e-com + SAP),
-- GA4 traffic import, per-page permissions, owner (super admin) powers.
-- Run after 007_calibrated_reorder.sql
-- ============================================================

alter table public.stock_items add column if not exists ecom_stock integer;
alter table public.stock_items add column if not exists sap_stock integer;
alter table public.stock_items add column if not exists category text;
alter table public.stock_items add column if not exists min_override integer;

update public.stock_items set ecom_stock = current_stock where ecom_stock is null and current_stock is not null;

create or replace function public.fn_stock_engine(
  p_window_days integer default 30,
  p_coverage_days integer default 45,
  p_global_min integer default 0,
  p_bestseller_min integer default 20,
  p_bestseller_units integer default 20,
  p_max_order integer default 300
)
returns table (
  sku text, product_name text, category text,
  units bigint, velocity numeric, forecast numeric,
  min_applied integer, target numeric,
  ecom_stock integer, sap_stock integer,
  cover_days numeric, need numeric, move_qty numeric, shortfall numeric,
  surplus numeric, status text
)
language sql stable
as $$
  with sales as (
    select coalesce(nullif(i.sku,''),'(no sku)') as sku,
      mode() within group (order by i.product_name) as product_name,
      count(*) filter (where o.order_date >= now() - make_interval(days => p_window_days)) as units,
      count(*) filter (where o.order_date >= now() - make_interval(days => p_window_days*4)
                         and o.order_date < now() - make_interval(days => p_window_days)) as units_hist
    from public.order_items i
    join public.orders o on o.order_number = i.order_number
    where o.order_status not in ('Cancelled')
      and o.order_date >= now() - make_interval(days => p_window_days*4)
    group by 1
  ),
  merged as (
    select
      coalesce(s.sku, st.sku) as sku,
      coalesce(s.product_name, st.product_name) as product_name,
      st.category,
      coalesce(s.units, 0) as units,
      coalesce(s.units_hist, 0) as units_hist,
      st.ecom_stock, st.sap_stock, st.min_override
    from sales s
    full outer join public.stock_items st on st.sku = s.sku
  ),
  calc as (
    select m.*,
      m.units::numeric / greatest(p_window_days,1) as velocity,
      (m.units::numeric / greatest(p_window_days,1)) * p_coverage_days as forecast,
      coalesce(
        m.min_override,
        case when m.units >= p_bestseller_units then greatest(p_bestseller_min, p_global_min)
             when m.units > 0 then p_global_min
             else 0 end
      ) as min_applied
    from merged m
    where m.units > 0 or m.units_hist >= 10 or coalesce(m.ecom_stock,0) > 0 or coalesce(m.sap_stock,0) > 0
  ),
  eng as (
    select c.*,
      greatest(ceil(c.forecast), c.min_applied) as target,
      greatest(greatest(ceil(c.forecast), c.min_applied) - coalesce(c.ecom_stock, 0), 0) as need
    from calc c
  )
  select
    e.sku, e.product_name, e.category,
    e.units,
    round(e.velocity, 3) as velocity,
    round(e.forecast, 1) as forecast,
    e.min_applied::integer,
    e.target::numeric,
    e.ecom_stock, e.sap_stock,
    case when e.ecom_stock is null or e.velocity = 0 then null
         else round(e.ecom_stock / e.velocity, 1) end as cover_days,
    e.need::numeric,
    least(least(e.need, coalesce(e.sap_stock, e.need)), p_max_order)::numeric as move_qty,
    greatest(e.need - coalesce(e.sap_stock, 0), 0)::numeric as shortfall,
    case when e.ecom_stock is not null then greatest(coalesce(e.ecom_stock,0) - ceil(e.forecast), 0) else null end::numeric as surplus,
    case
      when coalesce(e.ecom_stock,0) = 0 and coalesce(e.sap_stock,0) = 0 and e.units = 0 and e.units_hist >= 10 then 'oos_reorder'
      when coalesce(e.ecom_stock,0) = 0 and coalesce(e.sap_stock,0) = 0 and e.units > 0 then 'oos_reorder'
      when e.need > 0 and coalesce(e.sap_stock,0) < e.need then 'low_sap'
      when e.need > 0 then 'move'
      when e.ecom_stock is not null and coalesce(e.ecom_stock,0) - ceil(e.forecast) > greatest(e.target,10) then 'overstock'
      else 'ok'
    end as status
  from eng e
  order by e.need desc, e.units desc;
$$;

create or replace function public.fn_upsert_stock(p_rows jsonb)
returns integer
language plpgsql
as $$
declare n integer;
begin
  if public.my_role() not in ('admin','manager') then
    raise exception 'Forbidden';
  end if;
  insert into public.stock_items (sku, product_name, ecom_stock, sap_stock, category, updated_at)
  select
    r->>'sku',
    nullif(r->>'product_name',''),
    nullif(r->>'ecom_stock','')::integer,
    nullif(r->>'sap_stock','')::integer,
    nullif(r->>'category',''),
    now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'sku','') <> ''
  on conflict (sku) do update set
    product_name = coalesce(excluded.product_name, stock_items.product_name),
    ecom_stock = coalesce(excluded.ecom_stock, stock_items.ecom_stock),
    sap_stock = coalesce(excluded.sap_stock, stock_items.sap_stock),
    category = coalesce(excluded.category, stock_items.category),
    updated_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

create table if not exists public.ga4_pages (
  id uuid primary key default gen_random_uuid(),
  period_month date not null,
  page_path text not null,
  views numeric, active_users numeric, views_per_user numeric,
  avg_engagement_secs numeric, event_count numeric, add_to_carts numeric,
  key_events numeric, total_revenue numeric, bounce_rate numeric, engagement_rate numeric,
  imported_at timestamptz not null default now(),
  unique (period_month, page_path)
);
alter table public.ga4_pages enable row level security;
drop policy if exists ga4_read on public.ga4_pages;
create policy ga4_read on public.ga4_pages for select using (public.my_role() in ('admin','manager','viewer'));
drop policy if exists ga4_write on public.ga4_pages;
create policy ga4_write on public.ga4_pages for insert with check (public.my_role() in ('admin','manager'));
drop policy if exists ga4_update on public.ga4_pages;
create policy ga4_update on public.ga4_pages for update using (public.my_role() in ('admin','manager'));
drop policy if exists ga4_delete on public.ga4_pages;
create policy ga4_delete on public.ga4_pages for delete using (public.my_role() in ('admin','manager'));

create or replace function public.fn_ga4_months()
returns table (period_month date, pages bigint, views numeric, users numeric, add_to_carts numeric)
language sql stable
as $$
  select period_month, count(*) as pages, sum(views) as views,
         sum(active_users) as users, sum(add_to_carts) as add_to_carts
  from public.ga4_pages
  group by 1 order by 1 desc;
$$;

create or replace function public.fn_ga4_summary(p_month date)
returns json
language sql stable
as $$
  with g as (
    select * from public.ga4_pages where period_month = p_month
  ),
  o as (
    select count(*) as orders, coalesce(sum(total_order_amount),0) as revenue
    from public.orders
    where order_status not in ('Cancelled')
      and order_date >= p_month and order_date < p_month + interval '1 month'
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

create table if not exists public.page_permissions (
  page_key text primary key,
  allow_manager boolean not null default true,
  allow_viewer boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.page_permissions enable row level security;
drop policy if exists pageperm_read on public.page_permissions;
create policy pageperm_read on public.page_permissions for select using (auth.uid() is not null);
drop policy if exists pageperm_write on public.page_permissions;
create policy pageperm_write on public.page_permissions for insert with check (public.my_role() = 'admin');
drop policy if exists pageperm_update on public.page_permissions;
create policy pageperm_update on public.page_permissions for update using (public.my_role() = 'admin');

insert into public.page_permissions (page_key, allow_manager, allow_viewer) values
  ('overview', true, true), ('orders', true, true), ('products', true, true),
  ('analytics', true, true), ('insights', true, true), ('customers', true, true),
  ('ads', true, true), ('campaigns', true, true), ('stock', true, true),
  ('targets', true, true), ('traffic', true, true), ('reports', true, true),
  ('team', true, false), ('data-center', true, false), ('assistant', true, true)
on conflict (page_key) do nothing;

alter table public.profiles add column if not exists is_owner boolean not null default false;

create or replace function public.i_am_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_owner from public.profiles where id = auth.uid() and is_active), false);
$$;

create or replace function public.admin_update_user(
  p_user_id uuid,
  p_full_name text default null,
  p_email text default null,
  p_password text default null,
  p_role text default null,
  p_is_active boolean default null
)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_target_role text;
  v_target_owner boolean;
begin
  if public.my_role() <> 'admin' then
    raise exception 'Only admins can edit users';
  end if;
  select role, is_owner into v_target_role, v_target_owner from public.profiles where id = p_user_id;
  if v_target_owner and not public.i_am_owner() then
    raise exception 'Only the owner can edit the owner account';
  end if;
  if v_target_role = 'admin' and p_user_id <> auth.uid() and not public.i_am_owner() then
    raise exception 'Only the owner can edit other admins';
  end if;
  if p_role is not null and p_role = 'admin' and not public.i_am_owner() then
    raise exception 'Only the owner can grant admin';
  end if;
  if p_user_id = auth.uid() and (p_is_active = false or (p_role is not null and p_role <> 'admin')) then
    raise exception 'You cannot demote or deactivate yourself';
  end if;

  update public.profiles set
    full_name = coalesce(p_full_name, full_name),
    email = coalesce(lower(p_email), email),
    role = coalesce(p_role, role),
    is_active = coalesce(p_is_active, is_active),
    updated_at = now()
  where id = p_user_id;

  if p_email is not null then
    update auth.users set email = lower(p_email), updated_at = now() where id = p_user_id;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', lower(p_email))
    where user_id = p_user_id and provider = 'email';
  end if;
  if p_password is not null then
    if length(p_password) < 8 then raise exception 'Password must be at least 8 characters'; end if;
    update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
    where id = p_user_id;
  end if;
end;
$$;
revoke execute on function public.admin_update_user(uuid, text, text, text, text, boolean) from anon;

create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_target_owner boolean;
begin
  if public.my_role() <> 'admin' then
    raise exception 'Only admins can delete users';
  end if;
  select is_owner into v_target_owner from public.profiles where id = p_user_id;
  if coalesce(v_target_owner, false) then
    raise exception 'The owner account cannot be deleted';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot delete yourself';
  end if;
  if not public.i_am_owner() then
    raise exception 'Only the owner can delete users';
  end if;
  delete from auth.users where id = p_user_id;
end;
$$;
revoke execute on function public.admin_delete_user(uuid) from anon;
