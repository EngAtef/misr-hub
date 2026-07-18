-- Flipbooks v2: instead of one giant self-contained HTML per book (base64
-- JPEG pages + a duplicated viewer), pages are stored as individual binary
-- WebP files under {id}/ with a small {id}.json manifest at the bucket root.
-- Roughly halves storage per book and lets the reader lazy-load pages.

-- The bucket now also stores page images, cover thumbnails and manifests.
update storage.buckets
  set allowed_mime_types = array['text/html','application/json','image/webp','image/jpeg','image/png']
  where id = 'flipbooks';

-- Per-book metadata the storage listing can't provide for v2 books: the real
-- size across all page objects, the page count, format, direction and cover.
alter table public.flipbooks
  add column if not exists fmt        text    not null default 'html',
  add column if not exists size_bytes bigint  not null default 0,
  add column if not exists page_count int     not null default 0,
  add column if not exists rtl        boolean not null default true,
  add column if not exists cover      text;

-- Rename support: no UPDATE policy existed (paths carry a random suffix, so
-- inserts never conflicted and nothing ever updated a row until now).
drop policy if exists flipbooks_meta_update on public.flipbooks;
create policy flipbooks_meta_update on public.flipbooks
  for update to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
