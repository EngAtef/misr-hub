-- ============================================================
-- Migration 121: the Traffic page's month list stops scanning ga4_pages.
--
-- Symptom: /traffic showed "No traffic data — upload a GA4 report" while
-- all the GA4 tables were fully populated; a re-sync "brought it back".
-- Nothing was ever lost: fn_ga4_months aggregated ALL of ga4_pages
-- (145k rows, ~1.5s alone) on every page load, racing the page's other
-- requests on the free-tier instance; past the 8s statement_timeout the
-- page swallowed the error (`?? []`) and rendered the empty state. The
-- re-sync simply re-ran the query at a quieter moment.
--
-- Fix: the client only uses period_month, so walk the distinct months
-- via a loose scan over the (period_month, page_path) unique index —
-- 13 iterations instead of a 145k-row aggregate. The stat columns stay
-- in the signature (zeroed) so the return shape does not change.
-- The page now also shows a retry state on error instead of "no data".
-- Run after 120.
-- ============================================================

create or replace function public.fn_ga4_months()
returns table(period_month date, pages bigint, views numeric, users numeric, add_to_carts numeric)
language sql
stable
set search_path to 'public'
as $function$
  with recursive m(pm) as (
    select min(p.period_month) from public.ga4_pages p
    union all
    select (select min(p.period_month) from public.ga4_pages p where p.period_month > m.pm)
    from m where m.pm is not null
  )
  select pm, 0::bigint, 0::numeric, 0::numeric, 0::numeric
  from m
  where pm is not null
  order by pm desc;
$function$;
