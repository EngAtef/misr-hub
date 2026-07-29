-- Marketing Studio: store the marketing-director plan (persona, ad configs,
-- retargeting, A/B tests) alongside each post draft.

alter table public.marketing_posts
  add column if not exists plan jsonb;
