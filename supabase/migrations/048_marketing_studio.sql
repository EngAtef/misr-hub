-- Marketing Studio: AI book posts + Meta publishing + tracking + boosted ads.
--
-- marketing_posts holds one row per post project: the source book, the
-- AI-generated copy, the generated design assets (stored in the public
-- flipbooks bucket under marketing/{post id}/), Meta publish ids, synced
-- insights and the boosted-ad object ids.

create table if not exists public.marketing_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  book_ref text,                               -- hosted flipbook id (when sourced from Book Studio)
  book_title text not null default '',
  buy_url text,
  summary text not null default '',
  hook text not null default '',
  post_fb text not null default '',
  post_ig text not null default '',
  hashtags text not null default '',
  research_notes text not null default '',
  status text not null default 'draft' check (status in ('draft','ready','published','failed')),
  assets jsonb not null default '[]'::jsonb,   -- [{fmt:'sq'|'story'|'link', path, url}]
  channels jsonb not null default '[]'::jsonb, -- ['fb','ig'] chosen at publish time
  fb_post_id text,
  ig_media_id text,
  ig_permalink text,
  published_at timestamptz,
  publish_error text,
  insights jsonb,                              -- {fb:{...}, ig:{...}} last synced metrics
  insights_at timestamptz,
  ad jsonb                                     -- {campaign_id, adset_id, creative_id, ad_id, daily_budget, days, status, insights, insights_at}
);

create index if not exists idx_marketing_posts_created on public.marketing_posts (created_at desc);

alter table public.marketing_posts enable row level security;

-- RLS init-plan rule: helper calls always wrapped in (select ...) so they are
-- evaluated once per statement, not once per row.
drop policy if exists mkt_posts_read on public.marketing_posts;
create policy mkt_posts_read on public.marketing_posts
  for select using ((select auth.uid()) is not null);
drop policy if exists mkt_posts_insert on public.marketing_posts;
create policy mkt_posts_insert on public.marketing_posts
  for insert with check ((select public.my_role()) in ('admin','manager'));
drop policy if exists mkt_posts_update on public.marketing_posts;
create policy mkt_posts_update on public.marketing_posts
  for update using ((select public.my_role()) in ('admin','manager'))
  with check ((select public.my_role()) in ('admin','manager'));
drop policy if exists mkt_posts_delete on public.marketing_posts;
create policy mkt_posts_delete on public.marketing_posts
  for delete using ((select public.my_role()) in ('admin','manager'));

-- Server routes need the AI + Meta credentials regardless of whether the
-- caller is an admin (managers can generate/publish too); app_settings RLS is
-- admin-only, so expose exactly these two keys through a role-gated function.
create or replace function public.fn_marketing_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.my_role() in ('admin','manager') then jsonb_build_object(
      'ai',   coalesce((select value from public.app_settings where key = 'ai'),   '{}'::jsonb),
      'meta', coalesce((select value from public.app_settings where key = 'meta'), '{}'::jsonb)
    )
    else '{}'::jsonb
  end;
$$;

revoke all on function public.fn_marketing_config() from public, anon;
grant execute on function public.fn_marketing_config() to authenticated;

-- Nav visibility: admins + managers by default, hidden from viewers (an admin
-- can still grant it per user via the Users checklist).
insert into public.page_permissions (page_key, allow_manager, allow_viewer)
values ('marketing', true, false)
on conflict (page_key) do nothing;
