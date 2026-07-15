-- After-Hours Bot standalone page (/bot) + delegated script editing.
--
-- The bot gets its own nav page so an admin can grant it to a specific
-- account via the existing per-user page checklist (user_page_access) or
-- role defaults (page_permissions). Whoever can open the page may edit the
-- reply script (app_settings key "chatwoot_bot_script") — but NOT the
-- connection settings ("chatwoot_bot", which holds tokens and stays
-- admin-only via the original app_settings policies).

-- Hidden from managers/viewers by default: only admins see /bot until an
-- admin grants it per user.
insert into public.page_permissions (page_key, allow_manager, allow_viewer)
values ('bot', false, false)
on conflict (page_key) do nothing;

-- True when the current user may open the /bot page.
create or replace function public.can_edit_bot_script()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when public.my_role() = 'admin' then true
    else coalesce(
      (select allowed from public.user_page_access
        where user_id = auth.uid() and page_key = 'bot'),
      (select case when public.my_role() = 'manager' then allow_manager
                   when public.my_role() = 'viewer' then allow_viewer
                   else false end
         from public.page_permissions where page_key = 'bot'),
      false)
  end;
$$;

revoke all on function public.can_edit_bot_script() from public, anon;
grant execute on function public.can_edit_bot_script() to authenticated;

-- Script-only access for granted users (admin-wide policies already exist
-- and OR-combine with these).
drop policy if exists settings_bot_script_read on public.app_settings;
create policy settings_bot_script_read on public.app_settings
  for select using (key = 'chatwoot_bot_script' and public.can_edit_bot_script());

drop policy if exists settings_bot_script_insert on public.app_settings;
create policy settings_bot_script_insert on public.app_settings
  for insert with check (key = 'chatwoot_bot_script' and public.can_edit_bot_script());

drop policy if exists settings_bot_script_update on public.app_settings;
create policy settings_bot_script_update on public.app_settings
  for update using (key = 'chatwoot_bot_script' and public.can_edit_bot_script())
  with check (key = 'chatwoot_bot_script' and public.can_edit_bot_script());

-- Health now also reports the per-day schedule (non-secret).
create or replace function public.fn_chatwoot_bot_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'configured', coalesce(s.value->>'bot_token', '') <> ''
              and coalesce(s.value->>'webhook_token', '') <> '',
    'enabled', coalesce((s.value->>'enabled')::boolean, true),
    'after_hours_only', coalesce((s.value->>'after_hours_only')::boolean, true),
    'work_timezone', coalesce(s.value->>'work_timezone', 'Africa/Cairo'),
    'work_days', coalesce(s.value->>'work_days', 'sun,mon,tue,wed,thu'),
    'work_start', coalesce((s.value->>'work_start')::int, 9),
    'work_end', coalesce((s.value->>'work_end')::int, 18),
    'work_schedule', s.value->'work_schedule'
  )
  from public.app_settings s
  where s.key = 'chatwoot_bot';
$$;

revoke all on function public.fn_chatwoot_bot_health() from public;
grant execute on function public.fn_chatwoot_bot_health() to anon, authenticated;
