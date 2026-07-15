-- Bot analytics: every routed intent lands in bot_events, feeding the
-- "fallback inbox" on the /bot page (fallback rate, handoff rate, and the
-- actual unmatched customer questions with one-click keyword adding).
--
-- PII rule: message text is stored ONLY for fallbacks (needed to mine new
-- keywords) and truncated; all other events keep intent + conversation id.

create table if not exists public.bot_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  conversation_id bigint,
  intent text not null,
  message text
);

create index if not exists bot_events_created_idx on public.bot_events (created_at desc);

alter table public.bot_events enable row level security;

-- Readable by whoever can manage the bot page (admins + granted users).
drop policy if exists bot_events_read on public.bot_events;
create policy bot_events_read on public.bot_events
  for select using (public.can_edit_bot_script());

-- Writes come only from the webhook, gated by the same webhook token that
-- gates fn_chatwoot_bot_config — no service-role key involved.
create or replace function public.fn_chatwoot_bot_log(
  p_token text,
  p_conversation_id bigint,
  p_intent text,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from app_settings
    where key = 'chatwoot_bot'
      and coalesce(value->>'webhook_token', '') <> ''
      and value->>'webhook_token' = p_token
  ) then
    return;
  end if;
  insert into bot_events (conversation_id, intent, message)
  values (
    p_conversation_id,
    left(p_intent, 60),
    case when p_intent = 'fallback' then left(p_message, 500) else null end
  );
end;
$$;

revoke all on function public.fn_chatwoot_bot_log(text, bigint, text, text) from public;
grant execute on function public.fn_chatwoot_bot_log(text, bigint, text, text) to anon, authenticated;

-- Health now also reports public holidays (non-secret) so the endpoint's
-- within_hours matches the webhook's behaviour.
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
    'work_schedule', s.value->'work_schedule',
    'holidays', s.value->>'holidays'
  )
  from public.app_settings s
  where s.key = 'chatwoot_bot';
$$;

revoke all on function public.fn_chatwoot_bot_health() from public;
grant execute on function public.fn_chatwoot_bot_health() to anon, authenticated;
