-- Public library page (/library): anyone may read hosted-book titles.
-- Titles are already public inside each hosted reader page, so no new exposure.
create policy flipbooks_meta_read_anon on public.flipbooks
  for select to anon using (true);
