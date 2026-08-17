-- ============================================================
-- Migration 109: where did the customer come from — on the order itself.
--
-- GA4 knows the session source/medium/campaign of 93% of orders (join
-- ga4_transactions.transaction_id = orders.order_number). Reading that
-- through a join on every list page is slow and unfilterable, so it is
-- written onto the order: attr_bucket (the same buckets GAPS uses),
-- attr_source / attr_medium / attr_campaign (raw GA4 values).
-- fn_refresh_order_attribution() is called by the GA4 sync after each
-- month it writes; NULL bucket = no GA4 transaction (untracked).
-- ============================================================

alter table public.orders
  add column if not exists attr_bucket   text,
  add column if not exists attr_source   text,
  add column if not exists attr_medium   text,
  add column if not exists attr_campaign text;

create index if not exists orders_attr_bucket_idx on public.orders (attr_bucket);

-- One definition of the buckets, shared with fn_gaps_source_report's CASE.
create or replace function public.ga4_source_bucket(p_source text, p_medium text)
returns text
language sql
immutable
as $$
  select case
    when p_source ~* 'bit\.ly' then 'bitly'
    when (p_source ~* 'facebook|instagram|meta' or p_source ~* '^(fb|ig|adv)$'
          or p_medium ~* '^(paid|adv|static|post|parent)')
      and coalesce(p_medium, '') <> 'referral' then 'meta_tagged'
    when (p_source ~* 'facebook|instagram|meta' or p_source ~* '^(fb|ig)$')
      and p_medium = 'referral' then 'meta_untagged'
    when p_source = 'google' and p_medium = 'cpc' then 'google_ads'
    when p_source in ('(direct)', '(not set)') or p_source is null then 'direct'
    when p_medium = 'organic' and p_source <> 'google-play' then 'seo'
    when p_source = 'google-play' then 'appstore'
    when p_medium = 'referral' then 'referral'
    else 'other'
  end
$$;

create or replace function public.fn_refresh_order_attribution(p_from date default null, p_to date default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  if (select public.my_role()) not in ('admin', 'manager') and not public.is_service_role() then
    raise exception 'not allowed';
  end if;
  update public.orders o
     set attr_bucket   = public.ga4_source_bucket(t.source, t.medium),
         attr_source   = t.source,
         attr_medium   = t.medium,
         attr_campaign = nullif(t.campaign, '(not set)')
    from public.ga4_transactions t
   where t.transaction_id = o.order_number
     and (p_from is null or o.order_date >= p_from)
     and (p_to   is null or o.order_date <  p_to)
     and (o.attr_bucket is distinct from public.ga4_source_bucket(t.source, t.medium)
          or o.attr_source is distinct from t.source
          or o.attr_medium is distinct from t.medium
          or o.attr_campaign is distinct from nullif(t.campaign, '(not set)'));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.fn_refresh_order_attribution(date, date) from public, anon;
grant execute on function public.fn_refresh_order_attribution(date, date) to authenticated, service_role;

-- backfill everything once
select public.fn_refresh_order_attribution(null, null);
