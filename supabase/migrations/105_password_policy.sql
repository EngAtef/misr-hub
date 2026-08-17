-- ============================================================
-- Migration 105: password policy + forced change on first login
--
--  * profiles.must_change_password — set by an admin when creating an
--    account (optional) or resetting a password; the app blocks every
--    page until the user picks a new password, which clears the flag.
--  * is_strong_password() — 8+ chars, one capital, one digit, one
--    special character. Enforced in every place a password is written.
--  * admin_create_user / admin_update_user gain a p_must_change arg
--    (old overloads dropped so PostgREST never sees an ambiguous call).
--  * change_own_password() — the signed-in user sets their own password
--    (strength enforced server-side) and the flag is cleared atomically.
-- ============================================================

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

create or replace function public.is_strong_password(p text)
returns boolean
language sql immutable
as $$
  select p is not null
     and length(p) >= 8
     and p ~ '[A-Z]'
     and p ~ '[0-9]'
     and p ~ '[^A-Za-z0-9]';
$$;

-- ---------- admin_create_user ----------
drop function if exists public.admin_create_user(text, text, text, text);
drop function if exists public.admin_create_user(text, text, text, text, text);

create or replace function public.admin_create_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_role text,
  p_phone text default null,
  p_must_change boolean default true
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
  if not public.is_strong_password(p_password) then
    raise exception 'Password must be at least 8 characters with a capital letter, a number and a special character';
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

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), uid, uid::text,
    jsonb_build_object('sub', uid::text, 'email', lower(p_email), 'email_verified', true),
    'email', now(), now(), now()
  );

  -- profiles row is created by the auth.users trigger; fill it in
  update public.profiles
  set role = p_role, is_active = true,
      full_name = coalesce(nullif(p_full_name, ''), full_name),
      phone = p_phone,
      must_change_password = coalesce(p_must_change, true)
  where id = uid;

  return uid;
end;
$$;
revoke execute on function public.admin_create_user(text, text, text, text, text, boolean) from public, anon;
grant execute on function public.admin_create_user(text, text, text, text, text, boolean) to authenticated;

-- ---------- admin_update_user ----------
drop function if exists public.admin_update_user(uuid, text, text, text, text, boolean);

create or replace function public.admin_update_user(
  p_user_id uuid,
  p_full_name text default null,
  p_email text default null,
  p_password text default null,
  p_role text default null,
  p_is_active boolean default null,
  p_must_change boolean default null
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
  if p_password is not null and not public.is_strong_password(p_password) then
    raise exception 'Password must be at least 8 characters with a capital letter, a number and a special character';
  end if;

  update public.profiles set
    full_name = coalesce(p_full_name, full_name),
    email = coalesce(lower(p_email), email),
    role = coalesce(p_role, role),
    is_active = coalesce(p_is_active, is_active),
    must_change_password = coalesce(p_must_change, must_change_password),
    updated_at = now()
  where id = p_user_id;

  if p_email is not null then
    update auth.users set email = lower(p_email), updated_at = now() where id = p_user_id;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', lower(p_email))
    where user_id = p_user_id and provider = 'email';
  end if;
  if p_password is not null then
    update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
    where id = p_user_id;
  end if;
end;
$$;
revoke execute on function public.admin_update_user(uuid, text, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.admin_update_user(uuid, text, text, text, text, boolean, boolean) to authenticated;

-- ---------- change_own_password ----------
create or replace function public.change_own_password(p_password text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_strong_password(p_password) then
    raise exception 'Password must be at least 8 characters with a capital letter, a number and a special character';
  end if;
  -- lets the guard trigger tell this apart from a raw table update
  perform set_config('app.pw_change', '1', true);
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = auth.uid();
  update public.profiles
     set must_change_password = false, updated_at = now()
   where id = auth.uid();
end;
$$;
revoke execute on function public.change_own_password(text) from public, anon;
grant execute on function public.change_own_password(text) to authenticated;

-- Only an admin, or change_own_password(), may clear the flag — never a
-- direct update to the user's own row (profiles_update_self allows updates).
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
  if old.must_change_password and not new.must_change_password
     and public.my_role() is distinct from 'admin'
     and coalesce(current_setting('app.pw_change', true), '') <> '1' then
    raise exception 'Set a new password to clear this flag';
  end if;
  return new;
end;
$$;

-- The trigger from 011 was found missing on the live database (function
-- present, trigger gone) — re-attach it so all four guards actually run.
drop trigger if exists trg_guard_profiles on public.profiles;
create trigger trg_guard_profiles
  before update on public.profiles
  for each row execute function public.guard_profiles_update();
