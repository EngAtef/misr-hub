-- ============================================================
-- Misr Hub - Migration 004: RLS write policies + admin_create_user
-- Lets the app run entirely without the service role key.
-- Run after 003_rfm.sql
-- ============================================================

drop policy if exists orders_write on public.orders;
create policy orders_write on public.orders
  for insert with check (public.my_role() in ('admin', 'manager'));

drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update using (public.my_role() in ('admin', 'manager'));

drop policy if exists items_write on public.order_items;
create policy items_write on public.order_items
  for insert with check (public.my_role() in ('admin', 'manager'));

drop policy if exists items_delete on public.order_items;
create policy items_delete on public.order_items
  for delete using (public.my_role() in ('admin', 'manager'));

drop policy if exists events_write on public.order_events;
create policy events_write on public.order_events
  for insert with check (public.my_role() in ('admin', 'manager'));

drop policy if exists events_delete on public.order_events;
create policy events_delete on public.order_events
  for delete using (public.my_role() in ('admin', 'manager'));

drop policy if exists uploads_write on public.uploads;
create policy uploads_write on public.uploads
  for insert with check (public.my_role() in ('admin', 'manager'));

drop policy if exists uploads_update on public.uploads;
create policy uploads_update on public.uploads
  for update using (public.my_role() in ('admin', 'manager'));

drop policy if exists audit_write on public.audit_log;
create policy audit_write on public.audit_log
  for insert with check (public.my_role() in ('admin', 'manager', 'viewer'));

-- Admin-only user creation without service role key.
create or replace function public.admin_create_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_role text
)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
  uid uuid := gen_random_uuid();
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only admins can create users';
  end if;
  if p_role not in ('admin', 'manager', 'viewer') then
    raise exception 'Invalid role';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;
  if exists (select 1 from auth.users where email = lower(p_email)) then
    raise exception 'A user with this email already exists';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    lower(p_email),
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', coalesce(p_full_name, ''), 'role', p_role),
    now(), now(), '', '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), uid,
    jsonb_build_object('sub', uid::text, 'email', lower(p_email), 'email_verified', true),
    'email', uid::text, now(), now(), now()
  );

  update public.profiles set role = p_role, full_name = coalesce(p_full_name, full_name)
  where id = uid;

  return uid;
end;
$$;

revoke execute on function public.admin_create_user(text, text, text, text) from anon;
