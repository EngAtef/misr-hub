-- Flipbooks: categories, buy links, library visibility, and in-book search.

alter table public.flipbooks
  add column if not exists category  text,
  add column if not exists buy_url   text,
  add column if not exists is_public boolean not null default true;

-- Extracted book text powering "search inside books". Kept in its own table
-- (not on public.flipbooks) so anonymous visitors can only search it through
-- fn_library_search below — never read the text itself.
create table if not exists public.flipbook_texts (
  path text primary key,
  txt  text not null default ''
);
alter table public.flipbook_texts enable row level security;

create policy flipbook_texts_read on public.flipbook_texts
  for select to authenticated using (true);
create policy flipbook_texts_insert on public.flipbook_texts
  for insert to authenticated with check (auth.uid() is not null);
create policy flipbook_texts_update on public.flipbook_texts
  for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy flipbook_texts_delete on public.flipbook_texts
  for delete to authenticated using (auth.uid() is not null);

-- Public library search: matches titles and inside-text of public books and
-- returns only book ids + where the hit was, so the stored text stays private.
create or replace function public.fn_library_search(q text)
returns table(book_id text, hit_text boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  esc text;
begin
  if q is null or length(trim(q)) < 2 or length(q) > 100 then
    return;
  end if;
  esc := '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select m.base, bool_or(m.src = 'text')
    from (
      select regexp_replace(f.path, '\.(json|html)$', '') as base, 'title'::text as src
      from public.flipbooks f
      where f.is_public and f.title ilike esc
      union all
      select regexp_replace(t.path, '\.(json|html)$', ''), 'text'::text
      from public.flipbook_texts t
      join public.flipbooks f on f.path = t.path
      where f.is_public and t.txt ilike esc
    ) m
    group by m.base
    limit 60;
end;
$$;

revoke all on function public.fn_library_search(text) from public;
grant execute on function public.fn_library_search(text) to anon, authenticated;
