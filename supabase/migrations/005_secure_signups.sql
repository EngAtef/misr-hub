-- ============================================================
-- Misr Hub - Migration 005: quarantine self-registered users
-- Self-signups (not created via admin_create_user) start deactivated;
-- an admin must activate them from the Users page.
-- Run after 004_write_policies.sql
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_role text := 'viewer';
  v_active boolean := true;
  v_admin_exists boolean;
begin
  select exists (select 1 from public.profiles where role = 'admin') into v_admin_exists;
  if not v_admin_exists then
    v_role := 'admin';
  elsif new.raw_user_meta_data ->> 'role' is null then
    v_active := false;
  end if;
  insert into public.profiles (id, email, full_name, role, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'role', v_role),
    v_active
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
