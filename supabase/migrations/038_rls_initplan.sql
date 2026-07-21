-- ============================================================
-- Migration 038: RLS init-plan fix (performance).
-- Policies called my_role() / auth.uid() bare, so Postgres
-- re-evaluated them for EVERY row - a profiles lookup per row.
-- On product_sales (~86k lines) that meant ~5s per query; three
-- parallel dropdown loads hit the 8s statement timeout and the
-- orders-page category/sub-category/brand filters came back
-- empty. Wrapping the calls in (select ...) turns them into an
-- InitPlan evaluated once per statement (Supabase advisor
-- "auth_rls_initplan"). Rewrites every affected policy in one
-- pass; idempotent - already-wrapped policies are skipped.
-- Run after 037_sales_line_filters.sql
-- ============================================================

do $$
declare
  r record;
  new_qual text;
  new_check text;
  stmt text;
begin
  for r in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') like '%my_role()%'
        or coalesce(qual, '') like '%auth.uid()%'
        or coalesce(with_check, '') like '%my_role()%'
        or coalesce(with_check, '') like '%auth.uid()%')
  loop
    new_qual := r.qual;
    if new_qual is not null and new_qual not like '%SELECT my_role()%' then
      new_qual := replace(new_qual, 'my_role()', '(select my_role())');
    end if;
    if new_qual is not null and new_qual not like '%SELECT auth.uid()%' then
      new_qual := replace(new_qual, 'auth.uid()', '(select auth.uid())');
    end if;

    new_check := r.with_check;
    if new_check is not null and new_check not like '%SELECT my_role()%' then
      new_check := replace(new_check, 'my_role()', '(select my_role())');
    end if;
    if new_check is not null and new_check not like '%SELECT auth.uid()%' then
      new_check := replace(new_check, 'auth.uid()', '(select auth.uid())');
    end if;

    if new_qual is distinct from r.qual or new_check is distinct from r.with_check then
      stmt := format('alter policy %I on public.%I', r.policyname, r.tablename);
      if new_qual is distinct from r.qual then
        stmt := stmt || format(' using (%s)', new_qual);
      end if;
      if new_check is distinct from r.with_check then
        stmt := stmt || format(' with check (%s)', new_check);
      end if;
      execute stmt;
    end if;
  end loop;
end $$;
