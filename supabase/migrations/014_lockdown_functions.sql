-- ============================================================
-- Migration 014: reduce function attack surface (Supabase advisor)
-- - trigger functions not callable via REST
-- - admin_* functions not callable by anon/public
-- - role_of() only callable internally (prevents role enumeration by uid)
-- - pin search_path = public on every public function
-- Run after 013.
-- ============================================================
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.guard_profiles_update() from public, anon, authenticated;

revoke execute on function public.admin_create_user(text, text, text, text) from public, anon;
revoke execute on function public.admin_create_user(text, text, text, text, text) from public, anon;
revoke execute on function public.admin_update_user(uuid, text, text, text, text, boolean) from public, anon;
revoke execute on function public.admin_delete_user(uuid) from public, anon;

-- role_of() is only called internally by my_role() (SECURITY DEFINER).
-- my_role() and i_am_owner() must stay callable by authenticated because
-- RLS policies evaluate them; they return only the caller's own status.
revoke execute on function public.role_of(uuid) from public, anon, authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('alter function %s set search_path = public', r.sig);
  end loop;
end $$;
