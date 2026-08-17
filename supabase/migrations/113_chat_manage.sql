-- 113: group management (rename + members, delete) for the creator or any
-- admin; unread total for the sidebar badge. Members added later see the
-- whole history — messages belong to the conversation, not to join time.
-- Data step done by hand on 2026-08-17: the Team announcements history
-- (15 messages) was moved into a group "E-Commerce Team" (Mohamed Atef,
-- Mai Ali, Rehab Ehab, Mohamed Hassan) and announcements were emptied.

create or replace function public.fn_chat_update_group(p_conv uuid, p_name text, p_members uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
declare v_me uuid := auth.uid(); v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if not exists (select 1 from public.chat_conversations c
                 where c.id = p_conv and c.kind = 'group'
                   and (c.created_by = v_me or (select public.my_role()) = 'admin')) then
    raise exception 'not allowed';
  end if;
  if v_name is not null then
    update public.chat_conversations set name = left(v_name, 80) where id = p_conv;
  end if;
  if p_members is not null then
    delete from public.chat_members where conversation_id = p_conv
      and user_id <> all(array_append(p_members, v_me));
    insert into public.chat_members (conversation_id, user_id)
    select p_conv, u from unnest(array_append(p_members, v_me)) as u
    where exists (select 1 from public.profiles p where p.id = u and p.is_active)
    on conflict do nothing;
  end if;
end $$;
revoke all on function public.fn_chat_update_group(uuid, text, uuid[]) from public, anon;
grant execute on function public.fn_chat_update_group(uuid, text, uuid[]) to authenticated;

create or replace function public.fn_chat_delete_group(p_conv uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.chat_conversations c
                 where c.id = p_conv and c.kind = 'group'
                   and (c.created_by = auth.uid() or (select public.my_role()) = 'admin')) then
    raise exception 'not allowed';
  end if;
  delete from public.chat_conversations where id = p_conv;
end $$;
revoke all on function public.fn_chat_delete_group(uuid) from public, anon;
grant execute on function public.fn_chat_delete_group(uuid) to authenticated;

create or replace function public.fn_chat_unread_total()
returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce(count(*), 0)::int
  from public.chat_messages x
  join public.chat_members m on m.conversation_id = x.conversation_id and m.user_id = auth.uid()
  where x.sender_id <> auth.uid()
    and (m.last_read_at is null or x.created_at > m.last_read_at);
$$;
revoke all on function public.fn_chat_unread_total() from public, anon;
grant execute on function public.fn_chat_unread_total() to authenticated;
