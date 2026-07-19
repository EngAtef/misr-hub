-- ============================================================
-- Migration 033: owner can clear activity history on demand,
-- scoped by date range and the same filters as the Activity tab
-- (user, kind, text search). Returns the number of rows removed.
-- Run after 032.
-- ============================================================

create or replace function public.purge_activity(
  p_from timestamptz,
  p_to timestamptz,
  p_user_id uuid default null,
  p_kind text default null,
  p_search text default null
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.i_am_owner() then
    raise exception 'owner only';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid range';
  end if;
  delete from public.user_activity
  where created_at >= p_from
    and created_at <= p_to
    and (p_user_id is null or user_id = p_user_id)
    and (p_kind is null or kind = p_kind)
    and (p_search is null or p_search = '' or
         page ilike '%' || p_search || '%'
         or label ilike '%' || p_search || '%'
         or user_email ilike '%' || p_search || '%');
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke execute on function public.purge_activity(timestamptz, timestamptz, uuid, text, text) from public, anon;
