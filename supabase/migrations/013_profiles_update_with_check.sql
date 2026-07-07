-- ============================================================
-- Migration 013: explicit WITH CHECK on the admin profiles-update
-- policy (defense-in-depth alongside the guard trigger from 011).
-- Run after 012.
-- ============================================================
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update
  using (public.my_role() = 'admin')
  with check (
    public.my_role() = 'admin'
    and role in ('admin', 'manager', 'viewer')
  );
