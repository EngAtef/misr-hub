-- ============================================================
-- Migration 060: stockout notifications name the products
-- sync_alert_notifications() lists the actual stocked-out books
-- (top 8 by historical sales, "و N أخرى" for the rest) instead of
-- a bare count the admin has to go look up. Run after 059.
-- ============================================================

create or replace function public.sync_alert_notifications()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a jsonb;
  alerts jsonb := '[]'::jsonb;
  elem jsonb;
  achieved numeric;
  v_stock_count int;
  v_stock_names text[];
  v_stock_body text;
begin
  a := public.fn_alerts();
  if a is null then
    return;
  end if;

  -- mirror the thresholds of the in-app alerts bar (red/amber alerts only)
  if (a->>'tracking_rate') is not null and (a->>'tracking_rate')::numeric < 95 then
    alerts := alerts || jsonb_build_array(jsonb_build_object(
      'key', 'tracking',
      'title', 'انخفاض معدل التتبع',
      'body', 'معدل تتبع الطلبات ' || (a->>'tracking_rate') || '% — ' || coalesce(a->>'untracked', '0') || ' طلب غير متتبع',
      'link', '/traffic'));
  end if;

  v_stock_count := coalesce((a->>'stockouts')::int, 0);
  if v_stock_count > 0 then
    -- same definition as fn_alerts: sold >=10 times in days 30-120, zero in the last 30
    select array_agg('«' || s.name || '»' order by s.hist desc)
    into v_stock_names
    from (
      select max(coalesce(nullif(i.product_name, ''), i.sku)) as name,
        count(*) filter (where o.order_date >= now() - interval '30 days') as recent,
        count(*) filter (where o.order_date >= now() - interval '120 days' and o.order_date < now() - interval '30 days') as hist
      from public.order_items i
      join public.orders o on o.order_number = i.order_number
      where o.order_status not in ('Cancelled') and o.order_date >= now() - interval '120 days'
      group by coalesce(nullif(i.sku, ''), 'x')
    ) s
    where s.recent = 0 and s.hist >= 10 and s.name is not null;

    v_stock_body := v_stock_count || ' منتج نفد من المخزون';
    if v_stock_names is not null then
      v_stock_body := v_stock_body || ': ' || array_to_string(v_stock_names[1:8], '، ');
      if array_length(v_stock_names, 1) > 8 then
        v_stock_body := v_stock_body || ' و' || (array_length(v_stock_names, 1) - 8) || ' أخرى';
      end if;
    end if;
    v_stock_body := v_stock_body || ' — راجع صفحة المخزون';

    alerts := alerts || jsonb_build_array(jsonb_build_object(
      'key', 'stockouts',
      'title', 'منتجات نفدت من المخزون',
      'body', v_stock_body,
      'link', '/stock'));
  end if;

  if coalesce((a->>'cancel_rate_recent')::numeric, 0) > 5
     and coalesce((a->>'cancel_rate_prior')::numeric, 0) > 0
     and (a->>'cancel_rate_recent')::numeric > (a->>'cancel_rate_prior')::numeric * 1.5 then
    alerts := alerts || jsonb_build_array(jsonb_build_object(
      'key', 'cancels',
      'title', 'ارتفاع معدل الإلغاء',
      'body', 'معدل الإلغاء ارتفع إلى ' || (a->>'cancel_rate_recent') || '% (كان ' || (a->>'cancel_rate_prior') || '%)',
      'link', '/analytics'));
  end if;
  if coalesce((a->>'target_total')::numeric, 0) > 0 then
    achieved := round(coalesce((a->>'target_actual')::numeric, 0) / (a->>'target_total')::numeric * 100);
    if achieved < coalesce((a->>'target_expected_pct')::numeric, 0) - 10 then
      alerts := alerts || jsonb_build_array(jsonb_build_object(
        'key', 'pace',
        'title', 'التأخر عن التارجت',
        'body', 'تحقق ' || achieved || '% من التارجت والمتوقع ' || (a->>'target_expected_pct') || '% في هذه النقطة من الشهر',
        'link', '/targets'));
    end if;
  end if;

  for elem in select * from jsonb_array_elements(alerts) loop
    if not exists (
      select 1 from public.alert_notified n
      where n.alert_key = elem->>'key' and n.notified_at > now() - interval '3 days'
    ) then
      insert into public.notifications (recipient_id, kind, title, body, link)
      select p.id, 'system', elem->>'title', elem->>'body', elem->>'link'
      from public.profiles p
      where p.role = 'admin' and p.is_active;
      insert into public.alert_notified (alert_key, notified_at)
      values (elem->>'key', now())
      on conflict (alert_key) do update set notified_at = now();
    end if;
  end loop;
end $$;
revoke execute on function public.sync_alert_notifications() from public, anon;
