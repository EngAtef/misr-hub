-- ============================================================
-- Migration 029: owner suite
-- 1. user_activity  — silent per-user tracking (visits/clicks/actions),
--    owner-only read, 30-day retention via purge_old_activity()
-- 2. trash          — soft delete: BEFORE DELETE triggers snapshot rows,
--    owner can restore (trash_restore) or purge (RLS delete)
-- 3. sessions       — owner_list_sessions / owner_terminate_session RPCs
--    over auth.sessions
-- 4. messages + notifications — internal inbox & notification center,
--    realtime enabled
-- Run after 028.
-- ============================================================

-- ---------- 1. USER ACTIVITY ----------
create table if not exists public.user_activity (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  user_email text,
  kind text not null check (kind in ('visit','click','action')),
  page text,
  label text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_user_activity_created on public.user_activity (created_at desc);
create index if not exists idx_user_activity_user on public.user_activity (user_id, created_at desc);
alter table public.user_activity enable row level security;

drop policy if exists ua_insert on public.user_activity;
create policy ua_insert on public.user_activity for insert with check (auth.uid() = user_id);
drop policy if exists ua_select on public.user_activity;
create policy ua_select on public.user_activity for select using (public.i_am_owner());
-- no update/delete policies: the log is immutable through the API

create or replace function public.purge_old_activity()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  -- callable by the owner from the app, or by the cron job (service role, uid is null)
  if auth.uid() is not null and not public.i_am_owner() then
    raise exception 'owner only';
  end if;
  delete from public.user_activity where created_at < now() - interval '30 days';
end $$;
revoke execute on function public.purge_old_activity() from public, anon;

-- ---------- 2. TRASH / SOFT DELETE ----------
create table if not exists public.trash (
  id bigint generated always as identity primary key,
  table_name text not null,
  label text,
  payload jsonb not null,
  extra jsonb,
  deleted_by uuid,
  deleted_by_email text,
  deleted_at timestamptz not null default now()
);
create index if not exists idx_trash_deleted_at on public.trash (deleted_at desc);
alter table public.trash enable row level security;

drop policy if exists trash_select on public.trash;
create policy trash_select on public.trash for select using (public.i_am_owner());
drop policy if exists trash_purge on public.trash;
create policy trash_purge on public.trash for delete using (public.i_am_owner());
-- inserts only via the security-definer trigger below

create or replace function public.fn_trash_capture()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
  v_row jsonb := to_jsonb(old);
  v_label text;
  v_extra jsonb := null;
begin
  select email into v_email from public.profiles where id = auth.uid();
  v_label := coalesce(
    v_row->>'name', v_row->>'title', v_row->>'po_number',
    v_row->>'list_number', v_row->>'path', v_row->>'id');
  if tg_table_name = 'stock_move_lists' then
    select jsonb_agg(to_jsonb(i)) into v_extra
    from public.stock_move_items i where i.list_id = old.id;
  end if;
  insert into public.trash (table_name, label, payload, extra, deleted_by, deleted_by_email)
  values (tg_table_name, v_label, v_row, v_extra, auth.uid(), v_email);
  return old;
end $$;
revoke execute on function public.fn_trash_capture() from public, anon, authenticated;

drop trigger if exists trg_trash_campaigns on public.campaigns;
create trigger trg_trash_campaigns before delete on public.campaigns
  for each row execute function public.fn_trash_capture();
drop trigger if exists trg_trash_purchase_orders on public.purchase_orders;
create trigger trg_trash_purchase_orders before delete on public.purchase_orders
  for each row execute function public.fn_trash_capture();
drop trigger if exists trg_trash_team_contacts on public.team_contacts;
create trigger trg_trash_team_contacts before delete on public.team_contacts
  for each row execute function public.fn_trash_capture();
drop trigger if exists trg_trash_stock_move_lists on public.stock_move_lists;
create trigger trg_trash_stock_move_lists before delete on public.stock_move_lists
  for each row execute function public.fn_trash_capture();
drop trigger if exists trg_trash_flipbooks on public.flipbooks;
create trigger trg_trash_flipbooks before delete on public.flipbooks
  for each row execute function public.fn_trash_capture();

create or replace function public.trash_restore(p_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r record;
begin
  if not public.i_am_owner() then
    raise exception 'owner only';
  end if;
  select * into r from public.trash where id = p_id;
  if not found then
    raise exception 'trash item not found';
  end if;
  if r.table_name not in ('campaigns','purchase_orders','team_contacts','stock_move_lists','flipbooks') then
    raise exception 'unsupported table %', r.table_name;
  end if;
  execute format(
    'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1) on conflict do nothing',
    r.table_name, r.table_name
  ) using r.payload;
  if r.table_name = 'stock_move_lists' and r.extra is not null then
    -- id is GENERATED ALWAYS: restore with fresh ids
    insert into public.stock_move_items (list_id, sku, product_name, qty, shortfall)
    select list_id, sku, product_name, qty, shortfall
    from jsonb_populate_recordset(null::public.stock_move_items, r.extra)
    on conflict do nothing;
  end if;
  delete from public.trash where id = p_id;
end $$;
revoke execute on function public.trash_restore(bigint) from public, anon;

-- ---------- 3. SESSIONS ----------
create or replace function public.owner_list_sessions()
returns table (
  session_id uuid,
  user_id uuid,
  email text,
  full_name text,
  created_at timestamptz,
  updated_at timestamptz,
  user_agent text,
  ip text
)
language sql stable security definer set search_path = public
as $$
  select s.id, s.user_id, p.email, p.full_name,
         s.created_at, s.updated_at, s.user_agent, host(s.ip)
  from auth.sessions s
  join public.profiles p on p.id = s.user_id
  where public.i_am_owner()
  order by s.updated_at desc;
$$;
revoke execute on function public.owner_list_sessions() from public, anon;

create or replace function public.owner_terminate_session(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.i_am_owner() then
    raise exception 'owner only';
  end if;
  delete from auth.sessions where id = p_session_id;
end $$;
revoke execute on function public.owner_terminate_session(uuid) from public, anon;

create or replace function public.owner_terminate_user_sessions(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.i_am_owner() then
    raise exception 'owner only';
  end if;
  delete from auth.sessions where user_id = p_user_id;
end $$;
revoke execute on function public.owner_terminate_user_sessions(uuid) from public, anon;

-- ---------- 4. MESSAGES & NOTIFICATIONS ----------
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists idx_messages_recipient on public.messages (recipient_id, created_at desc);
create index if not exists idx_messages_sender on public.messages (sender_id, created_at desc);
create index if not exists idx_messages_unread on public.messages (recipient_id) where read_at is null;
alter table public.messages enable row level security;

drop policy if exists msg_select on public.messages;
create policy msg_select on public.messages for select
  using (auth.uid() in (sender_id, recipient_id));
drop policy if exists msg_insert on public.messages;
create policy msg_insert on public.messages for insert
  with check (auth.uid() = sender_id and sender_id <> recipient_id);
drop policy if exists msg_update on public.messages;
create policy msg_update on public.messages for update
  using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);

-- recipients may only flip read_at, nothing else
create or replace function public.fn_messages_guard_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.body is distinct from old.body
     or new.sender_id is distinct from old.sender_id
     or new.recipient_id is distinct from old.recipient_id
     or new.created_at is distinct from old.created_at then
    raise exception 'messages are immutable';
  end if;
  return new;
end $$;
revoke execute on function public.fn_messages_guard_update() from public, anon, authenticated;
drop trigger if exists trg_messages_guard on public.messages;
create trigger trg_messages_guard before update on public.messages
  for each row execute function public.fn_messages_guard_update();

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  sender_email text,
  kind text not null default 'user' check (kind in ('user','system')),
  title text,
  body text not null,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists idx_notifications_recipient on public.notifications (recipient_id, created_at desc);
alter table public.notifications enable row level security;

drop policy if exists ntf_select on public.notifications;
create policy ntf_select on public.notifications for select
  using (auth.uid() in (recipient_id, sender_id));
drop policy if exists ntf_insert on public.notifications;
create policy ntf_insert on public.notifications for insert
  with check (auth.uid() = sender_id);
drop policy if exists ntf_update on public.notifications;
create policy ntf_update on public.notifications for update
  using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);
drop policy if exists ntf_delete on public.notifications;
create policy ntf_delete on public.notifications for delete
  using (auth.uid() = recipient_id);

-- directory of active users for the inbox / notification composer
create or replace function public.fn_user_directory()
returns table (id uuid, full_name text, email text, role text, avatar_url text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.email, p.role, p.avatar_url
  from public.profiles p
  where p.is_active and auth.uid() is not null
  order by p.full_name nulls last, p.email;
$$;
revoke execute on function public.fn_user_directory() from public, anon;

create or replace function public.fn_unread_counts()
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'messages', (select count(*) from public.messages where recipient_id = auth.uid() and read_at is null),
    'notifications', (select count(*) from public.notifications where recipient_id = auth.uid() and read_at is null)
  );
$$;
revoke execute on function public.fn_unread_counts() from public, anon;

-- realtime for inbox + notification bell
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;
