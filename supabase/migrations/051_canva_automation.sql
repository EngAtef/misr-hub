-- Canva automation queue: the app requests a design, a scheduled Claude agent
-- generates+repairs it in Canva and writes the finished JPEG back as a data
-- URL; the app ingests it into storage on next visit (no service key needed).
alter table public.marketing_posts
  add column if not exists canva_status text check (canva_status in ('requested','ready','done','failed')),
  add column if not exists canva_asset text,
  add column if not exists canva_error text;
