-- Per-day view counters for hosted flipbooks.
-- Written anonymously via fn_flipbook_view (the reader beacon), readable by
-- any signed-in user for the Studio report.

create table if not exists public.flipbook_views (
  path  text   not null,
  day   date   not null default (now() at time zone 'utc')::date,
  views bigint not null default 0,
  primary key (path, day)
);

alter table public.flipbook_views enable row level security;

drop policy if exists "flipbook_views readable by authenticated" on public.flipbook_views;
create policy "flipbook_views readable by authenticated"
  on public.flipbook_views for select to authenticated using (true);

-- No insert/update policies on purpose: the only write path is the
-- SECURITY DEFINER counter below, so anonymous visitors can bump a counter
-- but never read or tamper with the table.
create or replace function public.fn_flipbook_view(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_id is null or p_id !~ '^[a-zA-Z0-9_-]{1,120}$' then
    return;
  end if;
  insert into public.flipbook_views (path, day, views)
  values (p_id || '.html', (now() at time zone 'utc')::date, 1)
  on conflict (path, day) do update set views = flipbook_views.views + 1;
end;
$$;

revoke all on function public.fn_flipbook_view(text) from public;
grant execute on function public.fn_flipbook_view(text) to anon, authenticated;
