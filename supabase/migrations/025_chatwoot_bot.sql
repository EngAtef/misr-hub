-- Chatwoot after-hours bot: in-app configuration.
-- Settings live in app_settings (admin-only via existing RLS):
--   key "chatwoot_bot"        → connection + hours (incl. bot_token, webhook_token)
--   key "chatwoot_bot_script" → reply-script overrides (merged over code defaults)
--
-- The webhook route runs unauthenticated (Chatwoot calls it), so it reads
-- settings through a SECURITY DEFINER function gated by the webhook token:
-- callers who don't present the exact stored token get NULL. This avoids
-- needing the service-role key while keeping the bot token unreadable to
-- anon users.

create or replace function public.fn_chatwoot_bot_config(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(s.value->>'webhook_token', '') <> ''
     and s.value->>'webhook_token' = p_token
    then jsonb_build_object(
      'config', s.value,
      'script', coalesce(
        (select value from public.app_settings where key = 'chatwoot_bot_script'),
        '{}'::jsonb
      )
    )
    else null
  end
  from public.app_settings s
  where s.key = 'chatwoot_bot';
$$;

revoke all on function public.fn_chatwoot_bot_config(text) from public;
grant execute on function public.fn_chatwoot_bot_config(text) to anon, authenticated;

-- Non-secret status for the public /api/chatwoot/health endpoint.
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
    'work_end', coalesce((s.value->>'work_end')::int, 18)
  )
  from public.app_settings s
  where s.key = 'chatwoot_bot';
$$;

revoke all on function public.fn_chatwoot_bot_health() from public;
grant execute on function public.fn_chatwoot_bot_health() to anon, authenticated;
