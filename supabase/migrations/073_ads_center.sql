-- 073_ads_center.sql — Ads Center
--
-- Replaces the flat single-batch `ad_spend` table with a period-aware model:
--
--   ad_imports   one uploaded Meta report = one account × one date range
--   ad_insights  every row of that report, at all three delivery levels
--                (campaign / adset / ad) — Meta repeats the same spend at
--                each level, so ONLY level='ad' rows may ever be summed
--   ad_book_map  ad name (or campaign name) -> the book(s) it promotes,
--                which is what connects ad spend to real orders
--
-- Re-uploading the same account + date range refreshes that period in place;
-- a different date range is always a NEW period, so history accumulates.

-- ------------------------------------------------------------ normaliser

-- norm_ar() already folds Arabic spelling variants and strips diacritics, but
-- Meta exports are riddled with invisible bidi marks (U+200E/200F, U+202A-E,
-- U+2066-69) that make otherwise identical ad names compare unequal.
create or replace function public.norm_ad(t text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select nullif(
    btrim(regexp_replace(
      public.norm_ar(
        -- delete zero-width + bidi format characters (translate drops any
        -- char in `from` that has no counterpart in `to`)
        translate(coalesce(t, ''),
          chr(8203) || chr(8204) || chr(8205) || chr(8206) || chr(8207) ||
          chr(8234) || chr(8235) || chr(8236) || chr(8237) || chr(8238) ||
          chr(8288) || chr(8294) || chr(8295) || chr(8296) || chr(8297) || chr(65279),
          '')),
      '\s+', ' ', 'g')),
    '');
$$;

-- ---------------------------------------------------------------- tables

create table if not exists public.ad_imports (
  id uuid primary key default gen_random_uuid(),
  account_label text not null,              -- "kids" / "culture" / "disney"
  source text not null default 'meta',
  period_start date not null,
  period_end date not null,
  file_name text,
  row_count integer not null default 0,
  spend_total numeric not null default 0,
  note text,
  imported_by uuid references public.profiles (id),
  imported_at timestamptz not null default now(),
  unique (account_label, period_start, period_end)
);

create table if not exists public.ad_insights (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.ad_imports (id) on delete cascade,
  account_label text not null,
  source text not null default 'meta',
  level text not null check (level in ('campaign', 'adset', 'ad')),
  campaign_name text,
  adset_name text,
  ad_name text,
  period_start date not null,
  period_end date not null,
  -- delivery
  reach numeric,
  impressions numeric,
  frequency numeric,
  spend numeric,
  cpm numeric,
  -- traffic
  link_clicks numeric,
  ctr_all numeric,
  landing_page_views numeric,
  -- funnel
  adds_to_cart numeric,
  checkouts_initiated numeric,
  purchases numeric,
  conversion_value numeric,
  cost_per_purchase numeric,
  results_roas numeric,
  delivery_status text,
  created_at timestamptz not null default now()
);

-- one row per (import, level, campaign, adset, ad); coalesce() because the
-- campaign-level rows carry NULL adset/ad and NULL never equals NULL
create unique index if not exists uq_ad_insights_row
  on public.ad_insights (import_id, level, coalesce(campaign_name, ''), coalesce(adset_name, ''), coalesce(ad_name, ''));
create index if not exists idx_ad_insights_period on public.ad_insights (period_start, period_end);
create index if not exists idx_ad_insights_level on public.ad_insights (level);
create index if not exists idx_ad_insights_campaign on public.ad_insights (campaign_name);
create index if not exists idx_ad_insights_ad on public.ad_insights (ad_name);

-- ad name -> book. `pattern` is norm_ar()-normalised so Arabic spelling
-- variants and stray bidi marks in Meta exports still match.
create table if not exists public.ad_book_map (
  id uuid primary key default gen_random_uuid(),
  match_level text not null default 'ad' check (match_level in ('ad', 'campaign')),
  pattern text not null,
  raw_name text,                            -- what the ad was actually called
  book_label text not null,
  skus text[],                              -- exact SKUs this ad promotes
  keyword text,                             -- fallback: product_name ILIKE
  is_auto boolean not null default false,   -- set by the auto-mapper
  active boolean not null default true,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  unique (match_level, pattern)
);

-- ------------------------------------------------------------------ RLS

alter table public.ad_imports enable row level security;
alter table public.ad_insights enable row level security;
alter table public.ad_book_map enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['ad_imports', 'ad_insights', 'ad_book_map'] loop
    execute format('drop policy if exists %I on public.%I', tbl || '_read', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_write', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_update', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_delete', tbl);
    execute format('drop policy if exists backup_reader_read on public.%I', tbl);
    -- (select my_role()) is the init-plan form: evaluated once, not per row
    execute format(
      'create policy %I on public.%I for select using ((select public.my_role()) in (''admin'',''manager'',''viewer''))',
      tbl || '_read', tbl);
    execute format(
      'create policy %I on public.%I for insert with check ((select public.my_role()) in (''admin'',''manager''))',
      tbl || '_write', tbl);
    execute format(
      'create policy %I on public.%I for update using ((select public.my_role()) in (''admin'',''manager'')) with check ((select public.my_role()) in (''admin'',''manager''))',
      tbl || '_update', tbl);
    execute format(
      'create policy %I on public.%I for delete using ((select public.my_role()) in (''admin'',''manager''))',
      tbl || '_delete', tbl);
  end loop;
end $$;

-- the read-only backup role keeps working (see misr-hub-backups)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'backup_reader') then
    execute 'create policy backup_reader_read on public.ad_imports for select to backup_reader using (true)';
    execute 'create policy backup_reader_read on public.ad_insights for select to backup_reader using (true)';
    execute 'create policy backup_reader_read on public.ad_book_map for select to backup_reader using (true)';
    execute 'grant select on public.ad_imports, public.ad_insights, public.ad_book_map to backup_reader';
  end if;
end $$;

-- --------------------------------------------------- migrate legacy rows

-- The old ad_spend table held one hand-made June batch. Fold it into the new
-- model so the history survives, then keep `ad_spend` alive as a view — fn_pnl,
-- fn_pnl_by_month, fn_channel_summary and fn_traffic_alarms all read it.
do $$
declare
  v_import uuid;
  r record;
begin
  if to_regclass('public.ad_spend') is null
     or (select relkind from pg_class where oid = 'public.ad_spend'::regclass) <> 'r' then
    return;                                        -- already migrated
  end if;

  for r in
    select coalesce(batch_label, 'Legacy') as batch,
           coalesce(min(report_start), current_date) as p_start,
           coalesce(max(report_end), max(report_start), current_date) as p_end,
           count(*) as n, coalesce(sum(amount_spent), 0) as spend
    from public.ad_spend
    group by 1
  loop
    insert into public.ad_imports (account_label, source, period_start, period_end, file_name, row_count, spend_total, note)
    values (r.batch, 'meta', r.p_start, r.p_end, null, r.n, r.spend, 'migrated from ad_spend')
    on conflict (account_label, period_start, period_end) do update set row_count = excluded.row_count
    returning id into v_import;

    insert into public.ad_insights (
      import_id, account_label, source, level, campaign_name, adset_name, ad_name,
      period_start, period_end, reach, impressions, frequency, spend, link_clicks,
      purchases, conversion_value, cost_per_purchase)
    select v_import, r.batch, coalesce(a.source, 'meta'), 'ad',
           a.campaign_name, a.ad_group, a.ad_name,
           coalesce(a.report_start, r.p_start), coalesce(a.report_end, r.p_end),
           a.reach, a.impressions, a.frequency, a.amount_spent, a.link_clicks,
           a.reported_purchases, a.reported_conversion_value, a.cost_per_purchase
    from public.ad_spend a
    where coalesce(a.batch_label, 'Legacy') = r.batch
    on conflict do nothing;

    -- carry the old per-row keyword/SKU mapping into ad_book_map
    insert into public.ad_book_map (match_level, pattern, raw_name, book_label, skus, keyword, is_auto)
    select distinct on (public.norm_ad(a.ad_name))
           'ad', public.norm_ad(a.ad_name), a.ad_name,
           coalesce(nullif(a.match_keyword, ''), a.ad_name),
           case when coalesce(a.mapped_sku, '') <> '' then array[a.mapped_sku] end,
           nullif(a.match_keyword, ''), true
    from public.ad_spend a
    where coalesce(a.ad_name, '') <> ''
      and (coalesce(a.match_keyword, '') <> '' or coalesce(a.mapped_sku, '') <> '')
    order by public.norm_ad(a.ad_name), a.amount_spent desc nulls last
    on conflict (match_level, pattern) do nothing;
  end loop;

  execute 'alter table public.ad_spend rename to ad_spend_legacy';
end $$;

-- backwards-compatible shape for everything that still selects ad_spend
drop view if exists public.ad_spend;
create view public.ad_spend
with (security_invoker = true) as
  select i.id,
         i.source,
         i.account_label as batch_label,
         i.campaign_name,
         i.adset_name as ad_group,
         i.ad_name,
         i.reach,
         i.impressions,
         i.spend as amount_spent,
         i.purchases as reported_purchases,
         i.cost_per_purchase,
         i.conversion_value as reported_conversion_value,
         i.frequency,
         i.link_clicks as clicks_all,
         i.link_clicks,
         i.period_start as report_start,
         i.period_end as report_end,
         m.keyword as match_keyword,
         case when array_length(m.skus, 1) > 0 then m.skus[1] end as mapped_sku,
         i.created_at as imported_at
  from public.ad_insights i
  left join public.ad_book_map m
    on m.match_level = 'ad' and m.active and m.pattern = public.norm_ad(i.ad_name)
  where i.level = 'ad';

grant select on public.ad_spend to authenticated;

-- ------------------------------------------------------- trash / restore

-- the old helper trashed a batch_label; an import is the unit now
drop function if exists public.trash_ad_batch(text);

create or replace function public.trash_ad_import(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_rows jsonb;
  v_label text;
begin
  if (select public.my_role()) not in ('admin', 'manager') then
    raise exception 'not allowed';
  end if;
  select email into v_email from public.profiles where id = auth.uid();
  select account_label || ' ' || period_start || '→' || period_end into v_label
    from public.ad_imports where id = p_import_id;
  if v_label is null then
    return;
  end if;
  select jsonb_agg(to_jsonb(x)) into v_rows from public.ad_insights x where x.import_id = p_import_id;

  insert into public.trash (table_name, label, payload, extra, deleted_by, deleted_by_email)
  values ('ad_insights', v_label,
          jsonb_build_object('import', (select to_jsonb(a) from public.ad_imports a where a.id = p_import_id),
                             'rows', coalesce(jsonb_array_length(v_rows), 0)),
          coalesce(v_rows, '[]'::jsonb), auth.uid(), v_email);

  begin
    insert into public.user_activity (user_id, user_email, kind, page, label, detail)
    values (auth.uid(), v_email, 'action', 'ads', 'delete_ad_import', jsonb_build_object('label', v_label));
  exception when others then
    null;
  end;

  delete from public.ad_imports where id = p_import_id;   -- cascades to ad_insights
end $$;

revoke all on function public.trash_ad_import(uuid) from public, anon;
grant execute on function public.trash_ad_import(uuid) to authenticated;

-- ------------------------------------------------------------- import RPC

-- Upserts a whole report in one round trip. p_rows is the parsed JSON array;
-- re-importing the same account + period replaces that period's rows only.
create or replace function public.fn_ads_import(
  p_account text,
  p_start date,
  p_end date,
  p_file text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_import uuid;
  v_n integer;
  v_spend numeric;
begin
  if coalesce(trim(p_account), '') = '' or p_start is null or p_end is null then
    raise exception 'account and period are required';
  end if;

  insert into public.ad_imports (account_label, source, period_start, period_end, file_name, imported_by)
  values (trim(p_account), 'meta', p_start, p_end, p_file, auth.uid())
  on conflict (account_label, period_start, period_end)
    do update set file_name = excluded.file_name,
                  imported_by = excluded.imported_by,
                  imported_at = now()
  returning id into v_import;

  -- a re-upload is a full refresh of that period
  delete from public.ad_insights where import_id = v_import;

  insert into public.ad_insights (
    import_id, account_label, source, level, campaign_name, adset_name, ad_name,
    period_start, period_end, reach, impressions, frequency, spend, cpm,
    link_clicks, ctr_all, landing_page_views, adds_to_cart, checkouts_initiated,
    purchases, conversion_value, cost_per_purchase, results_roas, delivery_status)
  select v_import, trim(p_account), 'meta',
         r.level, nullif(r.campaign_name, ''), nullif(r.adset_name, ''), nullif(r.ad_name, ''),
         p_start, p_end,
         r.reach, r.impressions, r.frequency, r.spend, r.cpm,
         r.link_clicks, r.ctr_all, r.landing_page_views, r.adds_to_cart, r.checkouts_initiated,
         r.purchases, r.conversion_value, r.cost_per_purchase, r.results_roas, r.delivery_status
  from jsonb_to_recordset(p_rows) as r (
    level text, campaign_name text, adset_name text, ad_name text,
    reach numeric, impressions numeric, frequency numeric, spend numeric, cpm numeric,
    link_clicks numeric, ctr_all numeric, landing_page_views numeric,
    adds_to_cart numeric, checkouts_initiated numeric, purchases numeric,
    conversion_value numeric, cost_per_purchase numeric, results_roas numeric,
    delivery_status text)
  where r.level in ('campaign', 'adset', 'ad')
  on conflict do nothing;

  select count(*), coalesce(sum(spend) filter (where level = 'ad'), 0)
    into v_n, v_spend
  from public.ad_insights where import_id = v_import;

  update public.ad_imports set row_count = v_n, spend_total = v_spend where id = v_import;

  return jsonb_build_object('import_id', v_import, 'rows', v_n, 'spend', v_spend);
end $$;

revoke all on function public.fn_ads_import(text, date, date, text, jsonb) from public, anon;
grant execute on function public.fn_ads_import(text, date, date, text, jsonb) to authenticated;
