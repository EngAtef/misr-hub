-- ============================================================
-- Migration 032: alerts→notifications, login tracking, insights,
--                announcements, chat attachments, wider trash
-- 1. sync_alert_notifications(): fn_alerts conditions become persistent
--    admin notifications, deduped to once per 3 days per alert key
-- 2. register_login()/log_failed_login(): login history in user_activity,
--    owner notification on sign-in from a new device
-- 3. fn_activity_insights(): owner-only aggregates for the Insights tab
-- 4. announcements + announcement_reads: team-wide channel (realtime)
-- 5. messages attachment columns + private chat-uploads bucket
-- 6. trash: profiles archived on delete (not restorable), ad batches
--    trashed on explicit clear via trash_ad_batch()
-- Run after 031.
-- ============================================================

-- ---------- 1. SMART ALERTS -> NOTIFICATIONS ----------
create table if not exists public.alert_notified (
  alert_key text primary key,
  notified_at timestamptz not null default now()
);
alter table public.alert_notified enable row level security;
-- no policies: written only by the security-definer sync below

create or replace function public.sync_alert_notifications()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a jsonb;
  alerts jsonb := '[]'::jsonb;
  elem jsonb;
  achieved numeric;
begin
  a := public.fn_alerts();
  if a is null then
    return;
  end if;

  -- mirror the thresholds of the in-app alerts bar (red/amber alerts only)
  if (a->>'tracking_rate') is not null and (a->>'tracking_rate')::numeric < 95 then
    alerts := alerts || jsonb_build_array(jsonb_build_object(
      'key', 'tracking',
      'title', 'انخفاض معدل التتبع',
      'body', 'معدل تتبع الطلبات ' || (a->>'tracking_rate') || '% — ' || coalesce(a->>'untracked', '0') || ' طلب غير متتبع',
      'link', '/traffic'));
  end if;
  if coalesce((a->>'stockouts')::int, 0) > 0 then
    alerts := alerts || jsonb_build_array(jsonb_build_object(
      'key', 'stockouts',
      'title', 'منتجات نفدت من المخزون',
      'body', (a->>'stockouts') || ' منتج نفد من المخزون — راجع صفحة المخزون',
      'link', '/stock'));
  end if;
  if coalesce((a->>'cancel_rate_recent')::numeric, 0) > 5
     and coalesce((a->>'cancel_rate_prior')::numeric, 0) > 0
     and (a->>'cancel_rate_recent')::numeric > (a->>'cancel_rate_prior')::numeric * 1.5 then
    alerts := alerts || jsonb_build_array(jsonb_build_object(
      'key', 'cancels',
      'title', 'ارتفاع معدل الإلغاء',
      'body', 'معدل الإلغاء ارتفع إلى ' || (a->>'cancel_rate_recent') || '% (كان ' || (a->>'cancel_rate_prior') || '%)',
      'link', '/analytics'));
  end if;
  if coalesce((a->>'target_total')::numeric, 0) > 0 then
    achieved := round(coalesce((a->>'target_actual')::numeric, 0) / (a->>'target_total')::numeric * 100);
    if achieved < coalesce((a->>'target_expected_pct')::numeric, 0) - 10 then
      alerts := alerts || jsonb_build_array(jsonb_build_object(
        'key', 'pace',
        'title', 'التأخر عن التارجت',
        'body', 'تحقق ' || achieved || '% من التارجت والمتوقع ' || (a->>'target_expected_pct') || '% في هذه النقطة من الشهر',
        'link', '/targets'));
    end if;
  end if;

  for elem in select * from jsonb_array_elements(alerts) loop
    if not exists (
      select 1 from public.alert_notified n
      where n.alert_key = elem->>'key' and n.notified_at > now() - interval '3 days'
    ) then
      insert into public.notifications (recipient_id, kind, title, body, link)
      select p.id, 'system', elem->>'title', elem->>'body', elem->>'link'
      from public.profiles p
      where p.role = 'admin' and p.is_active;
      insert into public.alert_notified (alert_key, notified_at)
      values (elem->>'key', now())
      on conflict (alert_key) do update set notified_at = now();
    end if;
  end loop;
end $$;
revoke execute on function public.sync_alert_notifications() from public, anon;

-- ---------- 2. LOGIN TRACKING ----------
create table if not exists public.known_devices (
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_agent text not null,
  first_ip text,
  first_seen timestamptz not null default now(),
  primary key (user_id, user_agent)
);
alter table public.known_devices enable row level security;
-- no policies: written only by register_login()

create or replace function public.register_login()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_headers jsonb;
  v_ua text;
  v_ip text;
  v_device_count int;
begin
  if v_uid is null then
    return;
  end if;
  select email into v_email from public.profiles where id = v_uid;
  v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ua := left(coalesce(v_headers->>'user-agent', 'unknown'), 300);
  v_ip := left(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1), 60);

  insert into public.user_activity (user_id, user_email, kind, page, label, detail)
  values (v_uid, v_email, 'action', null, 'login', jsonb_build_object('ip', v_ip, 'user_agent', v_ua));

  if not exists (select 1 from public.known_devices where user_id = v_uid and user_agent = v_ua) then
    insert into public.known_devices (user_id, user_agent, first_ip)
    values (v_uid, v_ua, v_ip)
    on conflict do nothing;
    select count(*) into v_device_count from public.known_devices where user_id = v_uid;
    -- never alert on an account's very first device
    if v_device_count > 1 then
      insert into public.notifications (recipient_id, kind, title, body, link)
      select p.id, 'system',
             'تسجيل دخول من جهاز جديد',
             coalesce(v_email, 'مستخدم') || ' سجّل الدخول من جهاز جديد — ' || v_ua
               || case when v_ip <> '' then ' (IP: ' || v_ip || ')' else '' end,
             '/control'
      from public.profiles p
      where p.is_owner and p.is_active;
    end if;
  end if;
end $$;
revoke execute on function public.register_login() from public, anon;

create or replace function public.log_failed_login(p_email text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_headers jsonb;
  v_ua text;
  v_ip text;
begin
  v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ua := left(coalesce(v_headers->>'user-agent', 'unknown'), 300);
  v_ip := left(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1), 60);
  -- basic anti-spam: at most 20 failed-login rows per IP per hour
  if (select count(*) from public.user_activity
      where label = 'login_failed'
        and created_at > now() - interval '1 hour'
        and detail->>'ip' = v_ip) >= 20 then
    return;
  end if;
  insert into public.user_activity (user_id, user_email, kind, page, label, detail)
  values (null, left(coalesce(p_email, ''), 120), 'action', null, 'login_failed',
          jsonb_build_object('ip', v_ip, 'user_agent', v_ua));
end $$;
revoke execute on function public.log_failed_login(text) from public;
grant execute on function public.log_failed_login(text) to anon, authenticated;

-- ---------- 3. ACTIVITY INSIGHTS ----------
create or replace function public.fn_activity_insights(p_from timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.i_am_owner() then
    raise exception 'owner only';
  end if;
  return jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(row_to_json(x)) from (
        select user_email,
               count(*) as total,
               count(*) filter (where kind = 'visit') as visits,
               count(*) filter (where kind = 'click') as clicks,
               count(*) filter (where kind = 'action') as actions,
               count(distinct (created_at at time zone 'Africa/Cairo')::date) as active_days,
               max(created_at) as last_seen
        from public.user_activity
        where created_at >= p_from and user_email is not null
        group by user_email
        order by total desc
      ) x), '[]'::jsonb),
    'pages', coalesce((
      select jsonb_agg(row_to_json(x)) from (
        select page, count(*) as visits, count(distinct user_email) as users
        from public.user_activity
        where kind = 'visit' and created_at >= p_from and page is not null
        group by page
        order by visits desc
        limit 30
      ) x), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(row_to_json(x)) from (
        select extract(hour from created_at at time zone 'Africa/Cairo')::int as h, count(*) as c
        from public.user_activity
        where created_at >= p_from
        group by 1 order by 1
      ) x), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(row_to_json(x)) from (
        select ((created_at at time zone 'Africa/Cairo')::date)::text as d, count(*) as c
        from public.user_activity
        where created_at >= p_from
        group by 1 order by 1
      ) x), '[]'::jsonb)
  );
end $$;
revoke execute on function public.fn_activity_insights(timestamptz) from public, anon;

-- ---------- 4. ANNOUNCEMENTS ----------
create table if not exists public.announcements (
  id bigint generated always as identity primary key,
  sender_id uuid references public.profiles(id) on delete set null,
  sender_email text,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_announcements_created on public.announcements (created_at desc);
alter table public.announcements enable row level security;
drop policy if exists ann_select on public.announcements;
create policy ann_select on public.announcements for select using (auth.uid() is not null);
drop policy if exists ann_insert on public.announcements;
create policy ann_insert on public.announcements for insert with check (auth.uid() = sender_id);

create table if not exists public.announcement_reads (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now()
);
alter table public.announcement_reads enable row level security;
drop policy if exists annread_all on public.announcement_reads;
create policy annread_all on public.announcement_reads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$
begin
  alter publication supabase_realtime add table public.announcements;
exception when duplicate_object then null;
end $$;

-- ---------- 5. CHAT ATTACHMENTS ----------
alter table public.messages add column if not exists attachment_path text;
alter table public.messages add column if not exists attachment_name text;
alter table public.messages add column if not exists attachment_type text;
alter table public.messages add column if not exists attachment_size bigint;

-- keep attachments immutable too (recipient may still only flip read_at)
create or replace function public.fn_messages_guard_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.body is distinct from old.body
     or new.sender_id is distinct from old.sender_id
     or new.recipient_id is distinct from old.recipient_id
     or new.created_at is distinct from old.created_at
     or new.attachment_path is distinct from old.attachment_path
     or new.attachment_name is distinct from old.attachment_name
     or new.attachment_type is distinct from old.attachment_type
     or new.attachment_size is distinct from old.attachment_size then
    raise exception 'messages are immutable';
  end if;
  return new;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-uploads', 'chat-uploads', false, 10485760,
        array['image/png','image/jpeg','image/webp','image/gif',
              'application/pdf','text/csv','text/plain',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

drop policy if exists chatup_insert on storage.objects;
create policy chatup_insert on storage.objects for insert
  with check (bucket_id = 'chat-uploads' and auth.uid() is not null);
drop policy if exists chatup_select on storage.objects;
create policy chatup_select on storage.objects for select
  using (bucket_id = 'chat-uploads' and auth.uid() is not null);

-- ---------- 6. WIDER TRASH ----------
-- deleted user accounts are archived into the trash (visible, not restorable)
drop trigger if exists trg_trash_profiles on public.profiles;
create trigger trg_trash_profiles before delete on public.profiles
  for each row execute function public.fn_trash_capture();

-- label prefers human names (covers profiles: full_name/email)
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
    v_row->>'name', v_row->>'full_name', v_row->>'email', v_row->>'title',
    v_row->>'po_number', v_row->>'list_number', v_row->>'path', v_row->>'id');
  if tg_table_name = 'stock_move_lists' then
    select jsonb_agg(to_jsonb(i)) into v_extra
    from public.stock_move_items i where i.list_id = old.id;
  end if;
  insert into public.trash (table_name, label, payload, extra, deleted_by, deleted_by_email)
  values (tg_table_name, v_label, v_row, v_extra, auth.uid(), v_email);
  begin
    insert into public.user_activity (user_id, user_email, kind, page, label, detail)
    values (auth.uid(), v_email, 'action', null, 'delete_' || tg_table_name, jsonb_build_object('item', v_label));
  exception when others then
    null;
  end;
  return old;
end $$;

-- explicit ad-batch clears go to the trash as one entry with all rows
create or replace function public.trash_ad_batch(p_batch_label text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
  v_rows jsonb;
begin
  if public.my_role() not in ('admin', 'manager') then
    raise exception 'not allowed';
  end if;
  select email into v_email from public.profiles where id = auth.uid();
  select jsonb_agg(to_jsonb(a)) into v_rows from public.ad_spend a where a.batch_label = p_batch_label;
  if v_rows is null then
    return;
  end if;
  insert into public.trash (table_name, label, payload, extra, deleted_by, deleted_by_email)
  values ('ad_spend', p_batch_label,
          jsonb_build_object('batch_label', p_batch_label, 'rows', jsonb_array_length(v_rows)),
          v_rows, auth.uid(), v_email);
  begin
    insert into public.user_activity (user_id, user_email, kind, page, label, detail)
    values (auth.uid(), v_email, 'action', null, 'delete_ad_batch', jsonb_build_object('batch', p_batch_label));
  exception when others then
    null;
  end;
  delete from public.ad_spend where batch_label = p_batch_label;
end $$;
revoke execute on function public.trash_ad_batch(text) from public, anon;

-- restore: support ad_spend, refuse user accounts with a clear message
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
  if r.table_name = 'profiles' then
    raise exception 'user accounts cannot be restored — create the user again from the Users page';
  end if;
  if r.table_name = 'ad_spend' then
    insert into public.ad_spend
    select * from jsonb_populate_recordset(null::public.ad_spend, r.extra)
    on conflict do nothing;
    delete from public.trash where id = p_id;
    return;
  end if;
  if r.table_name not in ('campaigns','purchase_orders','team_contacts','stock_move_lists','flipbooks') then
    raise exception 'unsupported table %', r.table_name;
  end if;
  execute format(
    'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1) on conflict do nothing',
    r.table_name, r.table_name
  ) using r.payload;
  if r.table_name = 'stock_move_lists' and r.extra is not null then
    insert into public.stock_move_items (list_id, sku, product_name, qty, shortfall)
    select list_id, sku, product_name, qty, shortfall
    from jsonb_populate_recordset(null::public.stock_move_items, r.extra)
    on conflict do nothing;
  end if;
  delete from public.trash where id = p_id;
end $$;
