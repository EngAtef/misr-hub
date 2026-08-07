-- 081 — Meta Ads history backfill queue, overlap guard, manual-upload purge
--
-- Three things, all needed to make the Ads Center run on live Meta data alone:
--
-- 1. A queue. Pulling ~3 years is 90+ account-months and one serverless
--    invocation can't hold that, so the work is planned once and drained a few
--    months at a time by whoever asks (the button, the cron). Closing the tab
--    pauses a backfill, it never loses it.
-- 2. An overlap guard. The open month was being re-imported every day under a
--    moving period_end (…08-01→08-06, then …08-01→08-07), and since
--    fn_ads_insights matches on period OVERLAP both copies were counted —
--    August spend read roughly double. Superseding overlapping imports fixes
--    it at the source instead of in every reader.
-- 3. The purge, so hand-uploaded spreadsheets can be dropped once the same
--    months exist from the API.

create table if not exists public.ad_sync_jobs (
  id            uuid primary key default gen_random_uuid(),
  account_id    text not null,                  -- act_1234567890
  account_label text not null,                  -- must match ad_imports.account_label
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'pending'
                check (status in ('pending', 'running', 'done', 'error', 'skipped')),
  attempts      integer not null default 0,
  row_count     integer,
  spend_total   numeric,
  last_error    text,
  claimed_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (account_id, period_start)
);

-- the drain path always asks "what's claimable, newest month first"
create index if not exists ad_sync_jobs_pending_idx
  on public.ad_sync_jobs (status, period_start desc);

alter table public.ad_sync_jobs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ad_sync_jobs' and policyname = 'ad_sync_jobs_read') then
    -- (select my_role()) is the init-plan form: evaluated once, not per row
    execute 'create policy ad_sync_jobs_read on public.ad_sync_jobs for select using ((select public.my_role()) in (''admin'',''manager'',''viewer''))';
  end if;
end $$;

-- ---------------------------------------------------------------- helpers

-- The cron runs as service_role, which has no row in the users table, so
-- my_role() is null for it. Every gate below has to admit both callers.
create or replace function public.is_service_role()
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'role',
    ''
  ) = 'service_role';
$$;

create or replace function public.fn_ads_sync_allowed()
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select (select public.my_role()) in ('admin', 'manager') or public.is_service_role();
$$;

-- -------------------------------------------------------- overlap guard

/**
 * Drops any OTHER import for the same account whose period overlaps this one.
 *
 * fn_ads_import upserts on the exact (account, start, end) triple, so a
 * re-sync of the open month under a later end date lands beside the earlier
 * copy rather than replacing it — and fn_ads_insights, which selects on
 * overlap, then returns both. One month must be represented by exactly one
 * import; this is what enforces that.
 *
 * Called by the sync path only. The spreadsheet importer keeps its old
 * behaviour so someone can still upload two halves of a month deliberately.
 */
create or replace function public.fn_ads_import_supersede(
  p_account text,
  p_start   date,
  p_end     date
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_gone integer := 0;
begin
  if not public.fn_ads_sync_allowed() then
    raise exception 'not allowed';
  end if;

  with gone as (
    delete from public.ad_imports i
    where i.account_label = trim(p_account)
      and i.period_start <= p_end
      and i.period_end   >= p_start
      and not (i.period_start = p_start and i.period_end = p_end)
    returning 1
  )
  select count(*) into v_gone from gone;

  return v_gone;
end $$;

-- ------------------------------------------------------------------- plan

/**
 * Enqueues one job per account × chunk of `p_months` months across
 * [p_from, p_to].
 *
 * Chunks rather than single months because Meta charges a three-month query at
 * time_increment=monthly virtually the same as a one-month query — measured,
 * not assumed — so a quarterly chunk cuts the number of requests threefold for
 * the same data. The sync still writes one import per calendar month.
 *
 * Existing jobs are left alone unless p_redo — so pressing "backfill" again
 * resumes where it stopped instead of re-pulling months Meta already finalised
 * and burning rate-limit budget on them. Errored and abandoned jobs always
 * become pending again.
 */
create or replace function public.fn_ads_backfill_plan(
  p_accounts jsonb,   -- [{ "id": "act_…", "label": "Kids" }, …]
  p_from     date,
  p_to       date,
  p_redo     boolean default false,
  p_months   integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_added integer := 0;
  v_pending integer;
  v_step integer := greatest(1, least(coalesce(p_months, 3), 12));
begin
  if not public.fn_ads_sync_allowed() then
    raise exception 'not allowed';
  end if;
  if p_accounts is null or jsonb_array_length(p_accounts) = 0 then
    raise exception 'no accounts given';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'bad period';
  end if;

  with months as (
    select generate_series(
             date_trunc('month', p_from),
             date_trunc('month', p_to),
             (v_step || ' months')::interval
           )::date as m
  ),
  accounts as (
    select a->>'id' as id, a->>'label' as label
    from jsonb_array_elements(p_accounts) a
    where coalesce(a->>'id', '') <> '' and coalesce(a->>'label', '') <> ''
  ),
  ins as (
    insert into public.ad_sync_jobs as j (account_id, account_label, period_start, period_end)
    select accounts.id,
           accounts.label,
           greatest(months.m, p_from),
           -- clipped to p_to so the open month never asks Meta for future days
           least((months.m + (v_step || ' months')::interval - interval '1 day')::date, p_to)
    from accounts cross join months
    on conflict (account_id, period_start) do update
      set account_label = excluded.account_label,
          period_end    = excluded.period_end,
          status        = 'pending',
          attempts      = 0,
          last_error    = null,
          updated_at    = now()
      where p_redo or j.status in ('error', 'running')
    returning 1
  )
  select count(*) into v_added from ins;

  select count(*) into v_pending from public.ad_sync_jobs where status = 'pending';
  return jsonb_build_object('queued', v_added, 'pending', v_pending);
end $$;

-- ------------------------------------------------------------------ claim

/**
 * Hands out the next job to run.
 *
 * Ordering is round-robin across ad accounts, then newest period first. The
 * account rotation is not cosmetic: Meta's rolling-hour budget is PER ad
 * account, so draining strictly newest-first ran several quarters of one
 * account back to back, exhausted that account's budget, and then hit the
 * same wall on every following claim while three other accounts sat idle.
 * Preferring the account touched longest ago lets a throttled one rest while
 * the others work. Within an account, recent history is what anyone actually
 * looks at, so an interrupted backfill still leaves the useful end finished.
 *
 * Note the rotation only works when jobs are claimed ONE at a time — a single
 * claim of N evaluates the ordering once and returns N jobs from the same
 * account. runBackfillStep claims singly for exactly this reason.
 *
 * A 'running' job older than 15 minutes is treated as abandoned (browser
 * closed mid-step, or the function timed out) and becomes claimable again.
 * Three failed attempts retires a job, so one permanently broken quarter
 * can't stall the whole queue.
 */
create or replace function public.fn_ads_backfill_claim(p_limit integer default 1)
returns table (
  job_id uuid, job_account_id text, job_account_label text,
  job_start date, job_end date, job_attempts integer
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.fn_ads_sync_allowed() then
    raise exception 'not allowed';
  end if;

  return query
  with last_touch as (
    select account_id, max(claimed_at) as at
    from public.ad_sync_jobs
    group by account_id
  ),
  pick as (
    select j.id
    from public.ad_sync_jobs j
    left join last_touch lt on lt.account_id = j.account_id
    where j.attempts < 3
      and (j.status = 'pending'
           or (j.status = 'running' and j.claimed_at < now() - interval '15 minutes'))
    order by lt.at asc nulls first, j.period_start desc
    limit greatest(1, least(coalesce(p_limit, 1), 12))
    for update of j skip locked
  )
  update public.ad_sync_jobs j
     set status = 'running', attempts = j.attempts + 1, claimed_at = now(), updated_at = now()
    from pick
   where j.id = pick.id
  returning j.id, j.account_id, j.account_label, j.period_start, j.period_end, j.attempts;
end $$;

create or replace function public.fn_ads_backfill_finish(
  p_id     uuid,
  p_status text,
  p_rows   integer default null,
  p_spend  numeric default null,
  p_error  text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.fn_ads_sync_allowed() then
    raise exception 'not allowed';
  end if;
  if p_status not in ('done', 'error', 'skipped', 'pending') then
    raise exception 'bad status %', p_status;
  end if;

  update public.ad_sync_jobs
     set status      = p_status,
         -- Being throttled is not the month's fault. Putting a job back as
         -- 'pending' undoes the claim's attempt increment, so a run that
         -- pauses three times doesn't retire a perfectly good job.
         attempts    = case when p_status = 'pending' then greatest(0, attempts - 1) else attempts end,
         row_count   = coalesce(p_rows, row_count),
         spend_total = coalesce(p_spend, spend_total),
         last_error  = case when p_status = 'error' then left(coalesce(p_error, 'failed'), 400) else null end,
         finished_at = case when p_status in ('done', 'skipped') then now() else finished_at end,
         updated_at  = now()
   where id = p_id;
end $$;

-- --------------------------------------------------------------- progress

create or replace function public.fn_ads_backfill_progress()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if (select public.my_role()) not in ('admin', 'manager', 'viewer') and not public.is_service_role() then
    raise exception 'not allowed';
  end if;

  select jsonb_build_object(
    'total',   count(*),
    'done',    count(*) filter (where status = 'done'),
    'pending', count(*) filter (where status = 'pending'),
    'running', count(*) filter (where status = 'running'),
    'error',   count(*) filter (where status = 'error'),
    'skipped', count(*) filter (where status = 'skipped'),
    -- a job that burned its three attempts is stuck, not merely failed
    'stalled', count(*) filter (where status = 'error' and attempts >= 3),
    'spend',   coalesce(sum(spend_total) filter (where status = 'done'), 0),
    'oldest',  min(period_start),
    'newest',  max(period_end),
    'errors',  coalesce(
                 (select jsonb_agg(jsonb_build_object(
                    'account', e.account_label, 'period', e.period_start, 'error', e.last_error))
                  from (select account_label, period_start, last_error
                        from public.ad_sync_jobs
                        where status = 'error'
                        order by updated_at desc limit 8) e),
                 '[]'::jsonb)
  ) into v
  from public.ad_sync_jobs;

  return coalesce(v, '{}'::jsonb);
end $$;

-- --------------------------------------------------- purge manual uploads

/**
 * Drops every import that came from a hand-uploaded spreadsheet, keeping only
 * what the Marketing API pulled. `file_name` is the only thing that tells them
 * apart — `source` is 'meta' for both, because both describe Meta data.
 *
 * ad_insights cascades with the import. ad_book_map is keyed on ad and
 * campaign NAMES, so every book mapping survives and re-attaches itself to the
 * API rows the moment they land.
 */
create or replace function public.fn_ads_purge_manual_imports(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_targets jsonb;
  v_deleted integer := 0;
begin
  if (select public.my_role()) <> 'admin' and not public.is_service_role() then
    raise exception 'only an admin can purge imports';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'account', account_label, 'from', period_start, 'to', period_end,
           'file', file_name, 'rows', row_count, 'spend', spend_total)
         order by period_start), '[]'::jsonb)
    into v_targets
  from public.ad_imports
  where file_name is null or file_name not like 'Meta API%';

  if p_dry_run then
    return jsonb_build_object('dry_run', true, 'imports', v_targets);
  end if;

  with gone as (
    delete from public.ad_imports
    where file_name is null or file_name not like 'Meta API%'
    returning 1
  )
  select count(*) into v_deleted from gone;

  return jsonb_build_object('deleted', v_deleted, 'imports', v_targets);
end $$;

-- ------------------------------------------------------------------ grants

revoke all on function public.fn_ads_import_supersede(text, date, date) from public;
drop function if exists public.fn_ads_backfill_plan(jsonb, date, date, boolean);
revoke all on function public.fn_ads_backfill_plan(jsonb, date, date, boolean, integer) from public;
revoke all on function public.fn_ads_backfill_claim(integer) from public;
revoke all on function public.fn_ads_backfill_finish(uuid, text, integer, numeric, text) from public;
revoke all on function public.fn_ads_backfill_progress() from public;
revoke all on function public.fn_ads_purge_manual_imports(boolean) from public;

grant execute on function public.is_service_role()                                       to authenticated, service_role;
grant execute on function public.fn_ads_sync_allowed()                                   to authenticated, service_role;
grant execute on function public.fn_ads_import_supersede(text, date, date)               to authenticated, service_role;
grant execute on function public.fn_ads_backfill_plan(jsonb, date, date, boolean, integer) to authenticated, service_role;
grant execute on function public.fn_ads_backfill_claim(integer)                          to authenticated, service_role;
grant execute on function public.fn_ads_backfill_finish(uuid, text, integer, numeric, text) to authenticated, service_role;
grant execute on function public.fn_ads_backfill_progress()                              to authenticated, service_role;
grant execute on function public.fn_ads_purge_manual_imports(boolean)                    to authenticated, service_role;
