-- ============================================================
-- Migration 012: profile phone + avatar, self-service update policy
-- Run after 011_security_hardening.sql
-- ============================================================

alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists avatar_url text;

-- Cap avatar payload (~200KB data URL) so a client can't store a huge blob
alter table public.profiles drop constraint if exists avatar_url_size;
alter table public.profiles add constraint avatar_url_size
  check (avatar_url is null or length(avatar_url) < 300000);
-- Cap phone length
alter table public.profiles drop constraint if exists phone_size;
alter table public.profiles add constraint phone_size
  check (phone is null or length(phone) < 40);

-- Let a signed-in user update their OWN profile, but only the safe fields
-- (full_name, phone, avatar_url) — never role / is_active / is_owner.
-- The guard trigger from migration 011 still blocks privilege changes.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select role from public.profiles where id = auth.uid())
    and is_active = (select is_active from public.profiles where id = auth.uid())
    and is_owner = (select is_owner from public.profiles where id = auth.uid())
  );

-- Extend admin_create_user to accept phone (avatar set separately by the user)
create or replace function public.admin_create_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_role text,
  p_phone text default null
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
  if p_role = 'admin' and not public.i_am_owner() then
    raise exception 'Only the owner can grant admin';
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
    jsonb_build_object('full_name', coalesce(p_full_name, '')),
    now(), now(), '', '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), uid,
    jsonb_build_object('sub', uid::text, 'email', lower(p_email), 'email_verified', true),
    'email', uid::text, now(), now(), now()
  );

  update public.profiles
  set role = p_role, is_active = true,
      full_name = coalesce(nullif(p_full_name, ''), full_name),
      phone = p_phone
  where id = uid;

  return uid;
end;
$$;
revoke execute on function public.admin_create_user(text, text, text, text, text) from anon;
