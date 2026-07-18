-- ============================================================
-- Migration 031: activity mirroring must never break the parent write
-- (wraps the user_activity inserts from 030 in exception guards)
-- Run after 030.
-- ============================================================

create or replace function public.fn_mirror_audit_activity()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  begin
    insert into public.user_activity (user_id, user_email, kind, page, label, detail)
    values (new.user_id, new.user_email, 'action', null, new.action, new.details);
  exception when others then
    null; -- the audit write itself must always succeed
  end;
  return new;
end $$;

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
  begin
    insert into public.user_activity (user_id, user_email, kind, page, label, detail)
    values (auth.uid(), v_email, 'action', null, 'delete_' || tg_table_name, jsonb_build_object('item', v_label));
  exception when others then
    null; -- activity logging must never block a delete
  end;
  return old;
end $$;
