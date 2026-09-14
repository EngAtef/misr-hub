-- 148: WhatsApp marketing — Cloud API campaigns from the Segments engine.
--
-- Meta bills every delivered marketing template (~3.18 EGP in Egypt) and
-- pauses templates that get blocked, so a campaign here is never "the whole
-- segment": it is the segment, minus opt-outs, minus anyone messaged in the
-- cap window, and by default only people who opted in. All keyed on the
-- phone (last 10 digits, like sms_opt_outs) so identity rebuilds cannot
-- lose consent.
--
--   wa_opt_ins / wa_opt_outs   consent, by phone
--   wa_campaigns               one template + one audience definition
--   wa_sends                   one row per recipient; status follows Meta's
--                              webhook (sent → delivered → read | failed)
--   wa_inbound                 replies (opt-out keywords are handled by the
--                              webhook route, the text is kept for the inbox)
--   fn_wa_audience_count       what the New-campaign dialog shows
--   fn_wa_queue_campaign       creates the campaign + its send rows
--   fn_wa_campaigns            list with live counters
--   fn_wa_send_kick            pg_cron → Vercel worker, every minute while
--                              anything is queued

-- ------------------------------------------------------------ consent

create table if not exists public.wa_opt_ins (
  phone_norm text primary key,
  source     text not null default 'manual',
  name       text,
  note       text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.wa_opt_outs (
  phone_norm text primary key,
  source     text not null default 'manual',
  note       text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ campaigns

create table if not exists public.wa_campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  template_name text not null,
  template_lang text not null default 'ar',
  -- Meta "components" payload; parameter texts may contain {{name}} which
  -- the worker replaces per recipient
  components    jsonb not null default '[]'::jsonb,
  definition    jsonb not null default '{}'::jsonb,
  segment_id    uuid references public.saved_segments (id) on delete set null,
  audience      text not null default 'opted_in'
                check (audience in ('opted_in', 'all_reachable')),
  cap_days      integer not null default 14,
  status        text not null default 'queued'
                check (status in ('queued', 'sending', 'paused', 'done', 'canceled')),
  recipients    integer not null default 0,
  last_error    text,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);

create table if not exists public.wa_sends (
  id          bigserial primary key,
  campaign_id uuid references public.wa_campaigns (id) on delete cascade,
  phone_norm  text not null,
  wa_to       text not null,
  name        text,
  status      text not null default 'queued'
              check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  wamid       text,
  error       text,
  queued_at   timestamptz not null default now(),
  sent_at     timestamptz,
  updated_at  timestamptz not null default now()
);

create unique index if not exists uq_wa_sends_campaign_phone
  on public.wa_sends (campaign_id, phone_norm) where campaign_id is not null;
create index if not exists idx_wa_sends_queued on public.wa_sends (campaign_id) where status = 'queued';
create index if not exists idx_wa_sends_wamid on public.wa_sends (wamid);
create index if not exists idx_wa_sends_phone_at on public.wa_sends (phone_norm, sent_at desc);

create table if not exists public.wa_inbound (
  id          bigserial primary key,
  wamid       text unique,
  phone_norm  text not null,
  wa_from     text not null,
  name        text,
  kind        text,
  body        text,
  context_wamid text,
  campaign_id uuid references public.wa_campaigns (id) on delete set null,
  received_at timestamptz not null default now()
);
create index if not exists idx_wa_inbound_at on public.wa_inbound (received_at desc);

-- ------------------------------------------------------------ RLS

alter table public.wa_opt_ins   enable row level security;
alter table public.wa_opt_outs  enable row level security;
alter table public.wa_campaigns enable row level security;
alter table public.wa_sends     enable row level security;
alter table public.wa_inbound   enable row level security;

do $$
declare tbl text;
begin
  foreach tbl in array array['wa_opt_ins', 'wa_opt_outs', 'wa_campaigns', 'wa_sends'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', tbl);
    execute format('drop policy if exists %1$s_insert on public.%1$s', tbl);
    execute format('drop policy if exists %1$s_update on public.%1$s', tbl);
    execute format('drop policy if exists %1$s_delete on public.%1$s', tbl);
    execute format($p$create policy %1$s_read on public.%1$s for select
      using ((select public.my_role()) in ('admin', 'manager', 'viewer'))$p$, tbl);
    execute format($p$create policy %1$s_insert on public.%1$s for insert
      with check ((select public.my_role()) in ('admin', 'manager'))$p$, tbl);
    execute format($p$create policy %1$s_update on public.%1$s for update
      using ((select public.my_role()) in ('admin', 'manager'))$p$, tbl);
    execute format($p$create policy %1$s_delete on public.%1$s for delete
      using ((select public.my_role()) in ('admin', 'manager'))$p$, tbl);
  end loop;
end $$;

-- replies carry message text: admin/manager only
drop policy if exists wa_inbound_read on public.wa_inbound;
create policy wa_inbound_read on public.wa_inbound for select
  using ((select public.my_role()) in ('admin', 'manager'));
drop policy if exists wa_inbound_delete on public.wa_inbound;
create policy wa_inbound_delete on public.wa_inbound for delete
  using ((select public.my_role()) in ('admin', 'manager'));

-- ------------------------------------------------------------ audience

-- The numbers the New-campaign dialog shows before anything is queued.
-- `reachable` is the segment's exportable list (valid EG mobile, not on the
-- SMS opt-out list); everything else narrows it.
create or replace function public.fn_wa_audience_count(p_def jsonb, p_cap_days integer default 14)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with base as (
    select public.fn_phone_norm(x.phone) as phone_norm
    from public.fn_segment_export(p_def, true, true, 200000) x
  ),
  recent as (
    select distinct s.phone_norm
    from public.wa_sends s
    where p_cap_days > 0
      and s.status in ('sent', 'delivered', 'read')
      and s.sent_at >= now() - (p_cap_days || ' days')::interval
  ),
  flagged as (
    select b.phone_norm,
           (oi.phone_norm is not null) as opted_in,
           (oo.phone_norm is not null) as opted_out,
           (r.phone_norm is not null)  as recent
    from base b
    left join public.wa_opt_ins  oi on oi.phone_norm = b.phone_norm
    left join public.wa_opt_outs oo on oo.phone_norm = b.phone_norm
    left join recent r on r.phone_norm = b.phone_norm
  )
  select jsonb_build_object(
    'reachable',         count(*),
    'opted_in',          count(*) filter (where opted_in),
    'opted_out',         count(*) filter (where opted_out),
    'recently_sent',     count(*) filter (where recent),
    'sendable_opted_in', count(*) filter (where opted_in and not opted_out and not recent),
    'sendable_all',      count(*) filter (where not opted_out and not recent)
  )
  from flagged;
$$;
grant execute on function public.fn_wa_audience_count(jsonb, integer) to authenticated;

-- ------------------------------------------------------------ queue

create or replace function public.fn_wa_queue_campaign(
  p_def        jsonb,
  p_name       text,
  p_template   text,
  p_lang       text default 'ar',
  p_components jsonb default '[]'::jsonb,
  p_segment_id uuid default null,
  p_audience   text default 'opted_in',
  p_cap_days   integer default 14
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_n  integer;
begin
  if (select public.my_role()) not in ('admin', 'manager') then
    raise exception 'not allowed';
  end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_template), '') = '' then
    raise exception 'name and template are required';
  end if;

  insert into public.wa_campaigns
    (name, template_name, template_lang, components, definition, segment_id, audience, cap_days, created_by)
  values
    (trim(p_name), trim(p_template), coalesce(nullif(p_lang, ''), 'ar'), coalesce(p_components, '[]'::jsonb),
     coalesce(p_def, '{}'::jsonb), p_segment_id,
     case when p_audience = 'all_reachable' then 'all_reachable' else 'opted_in' end,
     greatest(coalesce(p_cap_days, 0), 0), auth.uid())
  returning id into v_id;

  insert into public.wa_sends (campaign_id, phone_norm, wa_to, name)
  select distinct on (e.phone_norm)
         v_id, e.phone_norm, '20' || e.phone_norm, e.name
  from (
    select public.fn_phone_norm(x.phone) as phone_norm, x.name
    from public.fn_segment_export(p_def, true, true, 200000) x
  ) e
  left join public.wa_opt_outs oo on oo.phone_norm = e.phone_norm
  left join public.wa_opt_ins  oi on oi.phone_norm = e.phone_norm
  where length(e.phone_norm) = 10
    and oo.phone_norm is null
    and (p_audience = 'all_reachable' or oi.phone_norm is not null)
    and not exists (
      select 1 from public.wa_sends s
      where s.phone_norm = e.phone_norm
        and s.status in ('sent', 'delivered', 'read')
        and p_cap_days > 0
        and s.sent_at >= now() - (p_cap_days || ' days')::interval
    );

  get diagnostics v_n = row_count;
  update public.wa_campaigns
     set recipients = v_n,
         status = case when v_n = 0 then 'done' else 'queued' end,
         finished_at = case when v_n = 0 then now() else null end
   where id = v_id;

  return jsonb_build_object('campaign_id', v_id, 'recipients', v_n);
end $$;
grant execute on function public.fn_wa_queue_campaign(jsonb, text, text, text, jsonb, uuid, text, integer) to authenticated;

-- pause / resume / cancel from the page
create or replace function public.fn_wa_campaign_set_status(p_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (select public.my_role()) not in ('admin', 'manager') then
    raise exception 'not allowed';
  end if;
  if p_status = 'canceled' then
    update public.wa_sends set status = 'skipped', updated_at = now()
     where campaign_id = p_id and status = 'queued';
    update public.wa_campaigns set status = 'canceled', finished_at = now() where id = p_id;
  elsif p_status = 'paused' then
    update public.wa_campaigns set status = 'paused' where id = p_id and status in ('queued', 'sending');
  elsif p_status = 'queued' then
    update public.wa_campaigns set status = 'queued', finished_at = null where id = p_id and status = 'paused';
  else
    raise exception 'unknown status %', p_status;
  end if;
  return p_status;
end $$;
grant execute on function public.fn_wa_campaign_set_status(uuid, text) to authenticated;

-- ------------------------------------------------------------ list

create or replace function public.fn_wa_campaigns(p_limit integer default 50)
returns table (
  id uuid,
  name text,
  template_name text,
  template_lang text,
  audience text,
  status text,
  recipients integer,
  n_queued bigint,
  n_sent bigint,
  n_delivered bigint,
  n_read bigint,
  n_failed bigint,
  n_replies bigint,
  last_error text,
  created_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.id, c.name, c.template_name, c.template_lang, c.audience, c.status, c.recipients,
         count(s.id) filter (where s.status = 'queued'),
         count(s.id) filter (where s.status in ('sent', 'delivered', 'read')),
         count(s.id) filter (where s.status in ('delivered', 'read')),
         count(s.id) filter (where s.status = 'read'),
         count(s.id) filter (where s.status = 'failed'),
         (select count(*) from public.wa_inbound i where i.campaign_id = c.id),
         c.last_error, c.created_at, c.started_at, c.finished_at
  from public.wa_campaigns c
  left join public.wa_sends s on s.campaign_id = c.id
  where (select public.my_role()) in ('admin', 'manager', 'viewer')
  group by c.id
  order by c.created_at desc
  limit p_limit;
$$;
grant execute on function public.fn_wa_campaigns(integer) to authenticated;

-- ------------------------------------------------------------ cron kick

-- Every minute: if anything is queued in a live campaign, ask the Vercel
-- worker to drain a batch. The page also drives the worker while it is
-- open; this is the safety net for closed tabs. Same Vault secrets as the
-- ads sync (migration 083).
create or replace function public.fn_wa_send_kick()
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_url    text;
  v_secret text;
  v_id     bigint;
begin
  if not exists (
    select 1 from public.wa_sends s
    join public.wa_campaigns c on c.id = s.campaign_id
    where s.status = 'queued' and c.status in ('queued', 'sending')
  ) then
    return null;
  end if;

  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    raise exception 'fn_wa_send_kick: app_base_url and cron_secret must be stored in Vault first';
  end if;

  select net.http_post(
    url     => v_url || '/api/whatsapp/send',
    headers => jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body    => jsonb_build_object('batch', 150),
    timeout_milliseconds => 60000
  ) into v_id;
  return v_id;
end $$;
revoke all on function public.fn_wa_send_kick() from public;

do $$
begin
  perform cron.unschedule('whatsapp-send')
  where exists (select 1 from cron.job where jobname = 'whatsapp-send');
  perform cron.schedule('whatsapp-send', '* * * * *', $sql$select public.fn_wa_send_kick()$sql$);
end $$;

-- ------------------------------------------------------------ page access

-- New section: owner only until access is granted (see nav.ts)
insert into public.page_permissions (page_key, allow_admin, allow_manager, allow_viewer)
values ('whatsapp', true, false, false)
on conflict (page_key) do nothing;
