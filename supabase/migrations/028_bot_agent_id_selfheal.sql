-- Self-healing bot agent id: the webhook resolves the bot's own Chatwoot
-- agent id via /profile when it isn't cached in settings, and persists it
-- through this token-gated function so later requests skip the extra API
-- call. Same gate as fn_chatwoot_bot_config: callers must present the
-- stored webhook token.

create or replace function public.fn_chatwoot_bot_save_agent_id(p_token text, p_agent_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_agent_id is null or p_agent_id <= 0 then
    return;
  end if;
  update app_settings
  set value = jsonb_set(value, '{bot_agent_id}', to_jsonb(p_agent_id)),
      updated_at = now()
  where key = 'chatwoot_bot'
    and coalesce(value->>'webhook_token', '') <> ''
    and value->>'webhook_token' = p_token;
end;
$$;

revoke all on function public.fn_chatwoot_bot_save_agent_id(text, bigint) from public;
grant execute on function public.fn_chatwoot_bot_save_agent_id(text, bigint) to anon, authenticated;
