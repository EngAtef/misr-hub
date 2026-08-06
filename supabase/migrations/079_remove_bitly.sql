-- 079_remove_bitly.sql — drop the short-lived Bitly integration
--
-- Bitly was added and removed the same day; the store isn't using short links
-- for its ads, so the tables never held anything (0 links, 0 clicks) and the
-- Links tab has been taken out of the Ads Center. Everything is dropped with
-- IF EXISTS so a fresh replay of the migration history is a no-op.
--
-- The stored access token is deleted too — it lived in app_settings under the
-- 'bitly' key and has no remaining reader.

drop function if exists public.fn_bitly_vs_ads(date, date);
drop function if exists public.fn_bitly_overview(date, date);
drop function if exists public.fn_bitly_upsert_metrics(jsonb);
drop function if exists public.fn_bitly_upsert_clicks(jsonb);
drop function if exists public.fn_bitly_upsert_links(jsonb);
drop function if exists public.fn_bitly_config_set(jsonb);
drop function if exists public.fn_bitly_config();

drop table if exists public.bitly_metrics;
drop table if exists public.bitly_clicks_daily;
drop table if exists public.bitly_syncs;
drop table if exists public.bitly_links;

delete from public.app_settings where key = 'bitly';
