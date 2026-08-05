-- 075_fix_norm_ar.sql — the Arabic normaliser was silently mangling words
--
-- translate(text, from, to) DELETES any character in `from` that has no
-- counterpart in `to`. norm_ar passed six source characters ('أإآءةى') but
-- only five targets ('اااهي'), so the mapping slipped by one:
--
--   ة  ->  ي   (should be ه)   "مكتبة"        became "مكتبي"
--   ى  ->  deleted             "حكاياتي الأولى" became "حكاياتي الاول"
--
-- Everything that compares two norm_ar() outputs at runtime still lined up
-- (both sides were mangled the same way), which is why this went unnoticed —
-- but matching a normalised title against a hand-typed keyword did not.
-- ad_book_map.pattern is the one place a norm_ar-derived value is STORED, so
-- it is re-normalised here in the same transaction.

create or replace function public.norm_ar(t text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select regexp_replace(
    translate(lower(coalesce(t, '')), 'أإآءةى', 'اااهيي'),
    '[ً-ٟـ،؛:.!؟?"''«»()\[\]—_*-]', '', 'g'
  );
$$;

update public.ad_book_map
set pattern = public.norm_ad(coalesce(raw_name, pattern))
where raw_name is not null
  and public.norm_ad(raw_name) is distinct from pattern
  -- skip rows whose re-normalised pattern would collide with an existing one
  and not exists (
    select 1 from public.ad_book_map o
    where o.match_level = ad_book_map.match_level
      and o.pattern = public.norm_ad(ad_book_map.raw_name)
      and o.id <> ad_book_map.id
  );
