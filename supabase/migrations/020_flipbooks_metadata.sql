-- Hosted flipbook metadata: real (Arabic) titles + ownership for the Studio
-- "hosted books" manager. The storage key is ASCII-only, so titles live here.
create table if not exists public.flipbooks (
  path text primary key,
  title text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.flipbooks enable row level security;

create policy flipbooks_meta_read on public.flipbooks
  for select using (auth.uid() is not null);
create policy flipbooks_meta_insert on public.flipbooks
  for insert with check (auth.uid() is not null and created_by = auth.uid());
create policy flipbooks_meta_delete on public.flipbooks
  for delete using (auth.uid() is not null);
