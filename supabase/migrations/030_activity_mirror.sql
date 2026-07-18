-- ============================================================
-- Migration 030: mirror meaningful actions into user_activity
-- - every audit_log insert (imports, exports, user management, …)
--   also appears in the owner's activity feed as kind='action'
-- - deletes captured by the trash trigger are logged as actions
-- Run after 029.
-- ============================================================

create or replace function public.fn_mirror_audit_activity()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.user_activity (user_id, user_email, kind, page, label, detail)
  values (new.user_id, new.user_email, 'action', null, new.action, new.details);
  return new;
end $$;
revoke execute on function public.fn_mirror_audit_activity() from public, anon, authenticated;

drop trigger if exists trg_audit_mirror on public.audit_log;
create trigger trg_audit_mirror after insert on public.audit_log
  for each row execute function public.fn_mirror_audit_activity();

-- extend the trash capture so a delete shows up in the activity feed as well
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
  insert into public.user_activity (user_id, user_email, kind, page, label, detail)
  values (auth.uid(), v_email, 'action', null, 'delete_' || tg_table_name, jsonb_build_object('item', v_label));
  return old;
end $$;
