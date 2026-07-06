-- ============================================================
-- Migration 011: SECURITY HARDENING (run in Supabase SQL Editor)
-- Fixes found by the multi-agent code review:
-- 1) HIGH: a self-signup could grant itself an ACTIVE ADMIN account by
--    sending role metadata (signUp options.data.role = 'admin'). The
--    trigger now IGNORES client metadata entirely: every non-first user
--    starts as an INACTIVE viewer; admin_create_user (security definer)
--    sets the real role + activates afterwards.
-- 2) profiles UPDATE had no WITH CHECK and no owner-flag protection:
--    an admin could flip is_owner/role directly on the table. A guard
--    trigger now enforces owner-only changes.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_role text := 'viewer';
  v_active boolean := false;
  v_admin_exists boolean;
begin
  select exists (select 1 from public.profiles where role = 'admin') into v_admin_exists;
  if not v_admin_exists then
    v_role := 'admin';      -- bootstrap: very first user
    v_active := true;
  end if;
  -- NOTE: raw_user_meta_data is CLIENT-controlled and must never decide
  -- role or activation. admin_create_user updates the profile right after.
  insert into public.profiles (id, email, full_name, role, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    v_role,
    v_active
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- admin_create_user must now activate the accounts it creates
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
  set role = p_role, is_active = true, full_name = coalesce(nullif(p_full_name, ''), full_name)
  where id = uid;

  return uid;
end;
$$;
revoke execute on function public.admin_create_user(text, text, text, text) from anon;

-- Guard direct profile updates: only the owner may change is_owner or
-- grant/revoke the admin role; nobody deactivates the owner.
create or replace function public.guard_profiles_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.is_owner is distinct from old.is_owner and not public.i_am_owner() then
    raise exception 'Only the owner can change ownership';
  end if;
  if old.is_owner and (new.is_active = false or new.role <> 'admin') and not public.i_am_owner() then
    raise exception 'The owner account cannot be demoted';
  end if;
  if new.role = 'admin' and old.role <> 'admin' and not public.i_am_owner() then
    raise exception 'Only the owner can grant admin';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_profiles on public.profiles;
create trigger trg_guard_profiles
  before update on public.profiles
  for each row execute function public.guard_profiles_update();
