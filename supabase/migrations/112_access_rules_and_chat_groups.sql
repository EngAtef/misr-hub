-- ============================================================
-- Migration 112: (A) access — new sections are owner-only by default,
--                (B) team chat with group conversations.
--
-- (A) page_permissions gains allow_admin (non-owner admins). The app now
--     hides any page that has NO page_permissions row and no per-user
--     grant from everyone but the owner. Pages that were live without a
--     row (catalog, vendors, delivery, returns, pnl, profit, studio,
--     inbox) are seeded to what users see today so nothing disappears.
--     RULE for future migrations: insert new page_keys with all three
--     allow_* = false (owner only) — access is granted from Users.
--
-- (B) chat_conversations / chat_members / chat_messages replace the old
--     1:1 `messages` table for the Inbox: DMs and named groups share one
--     model, RLS by membership, unread by last_read_at. The old table is
--     left untouched (history hidden "for now", nothing deleted).
-- ============================================================

-- ---------------------------------------------------------------- (A)
alter table public.page_permissions
  add column if not exists allow_admin boolean not null default true;

insert into public.page_permissions (page_key, allow_admin, allow_manager, allow_viewer) values
  ('catalog',  true, true,  true),
  ('vendors',  true, true,  true),
  ('delivery', true, true,  true),
  ('returns',  true, true,  true),
  ('pnl',      true, true,  false),
  ('profit',   true, true,  false),
  ('studio',   true, true,  false),
  ('inbox',    true, true,  true)
on conflict (page_key) do nothing;

-- ---------------------------------------------------------------- (B)
create table if not exists public.chat_conversations (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('dm', 'group')),
  name        text,
  dm_key      text unique,                       -- 'uidA:uidB' sorted, dm only
  created_by  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.chat_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz,
  primary key (conversation_id, user_id)
);
create index if not exists idx_chat_members_user on public.chat_members (user_id);

create table if not exists public.chat_messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  body            text not null,
  attachment_path text,
  attachment_name text,
  attachment_type text,
  attachment_size bigint,
  created_at      timestamptz not null default now()
);
create index if not exists idx_chat_messages_conv on public.chat_messages (conversation_id, created_at desc);

alter table public.chat_conversations enable row level security;
alter table public.chat_members       enable row level security;
alter table public.chat_messages      enable row level security;

-- membership test without RLS recursion
create or replace function public.is_chat_member(p_conv uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.chat_members where conversation_id = p_conv and user_id = auth.uid());
$$;
grant execute on function public.is_chat_member(uuid) to authenticated;

drop policy if exists chat_conv_select on public.chat_conversations;
create policy chat_conv_select on public.chat_conversations for select
  using (public.is_chat_member(id));

drop policy if exists chat_members_select on public.chat_members;
create policy chat_members_select on public.chat_members for select
  using (public.is_chat_member(conversation_id));
drop policy if exists chat_members_update on public.chat_members;
create policy chat_members_update on public.chat_members for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists chat_msg_select on public.chat_messages;
create policy chat_msg_select on public.chat_messages for select
  using (public.is_chat_member(conversation_id));
drop policy if exists chat_msg_insert on public.chat_messages;
create policy chat_msg_insert on public.chat_messages for insert
  with check (sender_id = auth.uid() and public.is_chat_member(conversation_id));

-- conversations are created only through the two RPCs below (definer)
create or replace function public.fn_chat_open_dm(p_other uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_me uuid := auth.uid(); v_key text; v_id uuid;
begin
  if v_me is null or p_other is null or p_other = v_me then raise exception 'invalid'; end if;
  if not exists (select 1 from public.profiles where id = p_other and is_active) then raise exception 'unknown user'; end if;
  v_key := least(v_me::text, p_other::text) || ':' || greatest(v_me::text, p_other::text);
  select id into v_id from public.chat_conversations where dm_key = v_key;
  if v_id is null then
    insert into public.chat_conversations (kind, dm_key, created_by) values ('dm', v_key, v_me) returning id into v_id;
    insert into public.chat_members (conversation_id, user_id) values (v_id, v_me), (v_id, p_other);
  end if;
  return v_id;
end $$;
revoke all on function public.fn_chat_open_dm(uuid) from public, anon;
grant execute on function public.fn_chat_open_dm(uuid) to authenticated;

create or replace function public.fn_chat_create_group(p_name text, p_members uuid[])
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_me uuid := auth.uid(); v_id uuid; v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if v_me is null then raise exception 'not signed in'; end if;
  if v_name is null then raise exception 'group name required'; end if;
  if p_members is null or cardinality(p_members) = 0 then raise exception 'pick at least one member'; end if;
  insert into public.chat_conversations (kind, name, created_by) values ('group', left(v_name, 80), v_me) returning id into v_id;
  insert into public.chat_members (conversation_id, user_id)
  select v_id, u from unnest(array_append(p_members, v_me)) as u
  where exists (select 1 from public.profiles p where p.id = u and p.is_active)
  on conflict do nothing;
  return v_id;
end $$;
revoke all on function public.fn_chat_create_group(text, uuid[]) from public, anon;
grant execute on function public.fn_chat_create_group(text, uuid[]) to authenticated;

-- creator (or an admin) can add / remove members later
create or replace function public.fn_chat_set_members(p_conv uuid, p_members uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if not exists (select 1 from public.chat_conversations c
                 where c.id = p_conv and c.kind = 'group'
                   and (c.created_by = v_me or (select public.my_role()) = 'admin')) then
    raise exception 'not allowed';
  end if;
  delete from public.chat_members where conversation_id = p_conv
    and user_id <> all(array_append(p_members, v_me));
  insert into public.chat_members (conversation_id, user_id)
  select p_conv, u from unnest(array_append(p_members, v_me)) as u
  where exists (select 1 from public.profiles p where p.id = u and p.is_active)
  on conflict do nothing;
end $$;
revoke all on function public.fn_chat_set_members(uuid, uuid[]) from public, anon;
grant execute on function public.fn_chat_set_members(uuid, uuid[]) to authenticated;

-- one call for the sidebar: my conversations with members, last message, unread
create or replace function public.fn_chat_summaries()
returns jsonb
language sql stable security definer set search_path = public
as $$
  with mine as (
    select c.*, m.last_read_at
    from public.chat_conversations c
    join public.chat_members m on m.conversation_id = c.id and m.user_id = auth.uid()
  ),
  last_msg as (
    select distinct on (x.conversation_id) x.*
    from public.chat_messages x
    join mine on mine.id = x.conversation_id
    order by x.conversation_id, x.created_at desc
  ),
  unread as (
    select x.conversation_id, count(*) as n
    from public.chat_messages x
    join mine on mine.id = x.conversation_id
    where x.sender_id <> auth.uid()
      and (mine.last_read_at is null or x.created_at > mine.last_read_at)
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', mine.id, 'kind', mine.kind, 'name', mine.name, 'created_by', mine.created_by,
    'created_at', mine.created_at, 'last_read_at', mine.last_read_at,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', cm.user_id, 'last_read_at', cm.last_read_at)), '[]'::jsonb)
                from public.chat_members cm where cm.conversation_id = mine.id),
    'last', (select to_jsonb(l) from last_msg l where l.conversation_id = mine.id),
    'unread', coalesce((select n from unread u where u.conversation_id = mine.id), 0)
  ) order by coalesce((select l.created_at from last_msg l where l.conversation_id = mine.id), mine.created_at) desc), '[]'::jsonb)
  from mine;
$$;
revoke all on function public.fn_chat_summaries() from public, anon;
grant execute on function public.fn_chat_summaries() to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null; end $$;
