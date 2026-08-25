-- ============================================================
-- Migration 130: strict role hierarchy on every path
--
-- Target model (owner request, 2026-08-24):
--   owner   → manages everyone, including admins
--   admin   → manages managers & viewers only; cannot touch the owner,
--             other admins, or grant the admin role
--   manager/viewer → see and edit their own profile only; no access
--             management of any kind
--
-- Migration 105's RPCs (admin_create_user / admin_update_user) already
-- enforce this, but two raw paths did not:
--   * profiles RLS let ANY admin update ANY row — a non-owner admin could
--     demote or deactivate a fellow admin through a plain table update
--     (the guard trigger only protected owner rows and admin GRANTS).
--   * user_page_access RLS let any admin rewrite any user's page grants,
--     including other admins'.
-- This migration closes both at the RLS level and adds the missing
-- fellow-admin guard to the trigger, so every path tells the same story.
-- ============================================================

-- profiles: non-owner admins can only update manager/viewer rows.
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
for update
using (
  (select public.my_role()) = 'admin'
  and not is_owner
  and (public.i_am_owner() or role <> 'admin')
)
with check (
  (select public.my_role()) = 'admin'
  and not is_owner
  and role = any (array['admin', 'manager', 'viewer'])
  and (public.i_am_owner() or role <> 'admin')
);

-- user_page_access: non-owner admins manage grants for managers/viewers only.
drop policy if exists upa_admin_write on public.user_page_access;
drop policy if exists upa_admin_update on public.user_page_access;
drop policy if exists upa_admin_delete on public.user_page_access;

create policy upa_admin_write on public.user_page_access
for insert
with check (
  (select public.my_role()) = 'admin'
  and (public.i_am_owner() or exists (
    select 1 from public.profiles p
    where p.id = user_id and not p.is_owner and p.role <> 'admin'))
);

create policy upa_admin_update on public.user_page_access
for update
using (
  (select public.my_role()) = 'admin'
  and (public.i_am_owner() or exists (
    select 1 from public.profiles p
    where p.id = user_id and not p.is_owner and p.role <> 'admin'))
);

create policy upa_admin_delete on public.user_page_access
for delete
using (
  (select public.my_role()) = 'admin'
  and (public.i_am_owner() or exists (
    select 1 from public.profiles p
    where p.id = user_id and not p.is_owner and p.role <> 'admin'))
);

-- Guard trigger: add the fellow-admin rule so even security-definer or
-- future code paths cannot slip past it. Scoped to real user sessions
-- (auth.uid() present) so service jobs are unaffected.
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
  if auth.uid() is not null
     and old.role = 'admin' and not old.is_owner and old.id <> auth.uid()
     and not public.i_am_owner() then
    raise exception 'Only the owner can edit admin accounts';
  end if;
  if old.must_change_password and not new.must_change_password
     and public.my_role() is distinct from 'admin'
     and coalesce(current_setting('app.pw_change', true), '') <> '1' then
    raise exception 'Set a new password to clear this flag';
  end if;
  return new;
end;
$$;
