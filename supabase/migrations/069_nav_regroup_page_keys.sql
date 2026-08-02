-- ============================================================
-- Migration 069: page keys follow the regrouped navigation.
--
-- /forecast is now a tab on /stock and /purchase-orders is retired,
-- so their permission rows are dead weight. /dashboard (the unified
-- Overview + Analytics + Insights + Reports preview) gets a row so it
-- appears in the per-user page checklist rather than defaulting to
-- "allowed" silently.
-- ============================================================

insert into public.page_permissions (page_key, allow_manager, allow_viewer)
values ('dashboard', true, true)
on conflict (page_key) do nothing;

delete from public.page_permissions where page_key in ('forecast', 'purchase-orders');
delete from public.user_page_access  where page_key in ('forecast', 'purchase-orders');
