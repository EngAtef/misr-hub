-- Public storage bucket that hosts Book Studio flipbooks so embeds need no external hosting.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flipbooks', 'flipbooks', true, 52428800, array['text/html'])
on conflict (id) do update
  set public = true, file_size_limit = 52428800, allowed_mime_types = array['text/html'];

-- Signed-in team members can upload flipbooks.
create policy "flipbooks_insert_authenticated" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'flipbooks');

-- Signed-in team members can replace or delete hosted flipbooks.
create policy "flipbooks_update_authenticated" on storage.objects
  for update to authenticated
  using (bucket_id = 'flipbooks')
  with check (bucket_id = 'flipbooks');

create policy "flipbooks_delete_authenticated" on storage.objects
  for delete to authenticated
  using (bucket_id = 'flipbooks');

-- Anyone can read flipbook objects (the bucket is public; embeds are meant for the storefront).
create policy "flipbooks_select_all" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'flipbooks');
