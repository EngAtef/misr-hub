-- 139: custom list imports repair the SKUs the store's list editor mistyped.
--
-- Custom lists are edited by hand on the storefront, and two kinds of typo
-- reached the export of list 194 (موسوعة الفروق اللغويه):
--
--   mian_C010525111197P   the product-type prefix misspelt
--   main_CP010525111181P  a stray letter inside the SKU itself
--
-- Both books exist (ج7 / ج8, 200+ order lines each) but neither string is a
-- real SKU, so the list silently lost their sales in every ad attribution.
-- The client parser now strips misspelt prefixes; this migration handles the
-- other kind server-side: an imported SKU that matches nothing is resolved by
-- its exact product name when exactly one known product carries that name.
-- `raw_sku` keeps what the export said, so the repair is always auditable.

create or replace function public.fn_resolve_list_sku(p_sku text, p_name text)
returns text
language sql
stable
set search_path to 'public'
as $$
  select case
    when p_sku is null or btrim(p_sku) = '' then null
    when exists (select 1 from public.products p where p.sku = btrim(p_sku))
      or exists (select 1 from public.stock_items s where s.sku = btrim(p_sku))
      or exists (select 1 from public.order_items o where o.sku = btrim(p_sku))
      then btrim(p_sku)
    else coalesce(
      (select min(sku) from (
         select p.sku from public.products p where p.name = btrim(p_name)
         union
         select s.sku from public.stock_items s where s.product_name = btrim(p_name)
       ) k
       having count(*) = 1),
      btrim(p_sku))
  end
$$;

revoke all on function public.fn_resolve_list_sku(text, text) from public, anon;
grant execute on function public.fn_resolve_list_sku(text, text) to authenticated;

create or replace function public.fn_custom_lists_import(p_file text, p_lists jsonb)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  r record;
  v_key uuid;
  v_lists integer := 0;
  v_items integer := 0;
  v_repaired integer := 0;
  v_n integer;
begin
  if p_lists is null or jsonb_typeof(p_lists) <> 'array' or jsonb_array_length(p_lists) = 0 then
    raise exception 'no lists in payload';
  end if;

  for r in
    select (l ->> 'list_id')::integer as list_id,
           nullif(btrim(l ->> 'name'), '') as name,
           nullif(btrim(l ->> 'slug'), '') as slug,
           coalesce(nullif(btrim(l ->> 'product_type'), ''), 'main') as product_type,
           l -> 'items' as items
    from jsonb_array_elements(coalesce(p_lists, '[]'::jsonb)) as l
  loop
    select id into v_key from public.custom_lists
     where r.list_id is not null and list_id = r.list_id;
    if v_key is null and r.slug is not null then
      select id into v_key from public.custom_lists where lower(slug) = lower(r.slug);
    end if;

    if v_key is null then
      insert into public.custom_lists (list_id, slug, name, product_type, file_name, updated_by)
      values (r.list_id, r.slug,
              coalesce(r.name, 'List ' || coalesce(r.list_id::text, '?')),
              r.product_type, p_file, auth.uid())
      returning id into v_key;
    else
      update public.custom_lists
         set list_id = coalesce(r.list_id, list_id),
             slug = coalesce(r.slug, slug),
             -- a placeholder name ("List #194") never overwrites a real one
             name = case when r.name is null or r.name ~ '^List #?\d*\??$' then name else r.name end,
             product_type = r.product_type,
             file_name = p_file,
             updated_by = auth.uid(),
             updated_at = now()
       where id = v_key;
    end if;

    delete from public.custom_list_items where list_key = v_key;

    insert into public.custom_list_items (list_key, sku, raw_sku, product_name, sort_order)
    select distinct on (x.sku) v_key, x.sku, x.raw_sku, x.product_name, x.sort_order
    from (
      select public.fn_resolve_list_sku(i.sku, i.product_name) as sku,
             i.raw_sku, i.product_name, i.sort_order
      from jsonb_to_recordset(coalesce(r.items, '[]'::jsonb))
        as i (sku text, raw_sku text, product_name text, sort_order integer)
      where coalesce(btrim(i.sku), '') <> ''
    ) x
    order by x.sku, x.sort_order nulls last
    on conflict (list_key, sku) do nothing;

    select count(*) into v_n from public.custom_list_items where list_key = v_key;
    update public.custom_lists set item_count = v_n where id = v_key;

    select v_repaired + count(*) into v_repaired
      from public.custom_list_items i
     where i.list_key = v_key
       and i.raw_sku is not null
       and i.sku <> regexp_replace(i.raw_sku, '^[a-z]+_', '');

    v_lists := v_lists + 1;
    v_items := v_items + v_n;
  end loop;

  return jsonb_build_object('lists', v_lists, 'items', v_items, 'repaired', v_repaired);
end $$;

revoke all on function public.fn_custom_lists_import(text, jsonb) from public, anon;
grant execute on function public.fn_custom_lists_import(text, jsonb) to authenticated;

-- ---------------------------------------------------------------- data fix
-- Repair the rows already on record (lists 125 and 194 both carry the ج7
-- typo; 194 also carries the mian_ prefix) and give list 194 its store name.
with fixed as (
  select i.list_key, i.sku as old_sku,
         public.fn_resolve_list_sku(regexp_replace(i.sku, '^[a-z]{3,8}_(?=[A-Z]{1,4}\d{5,})', ''), i.product_name) as new_sku
  from public.custom_list_items i
)
update public.custom_list_items i
   set sku = f.new_sku
  from fixed f
 where i.list_key = f.list_key and i.sku = f.old_sku
   and f.new_sku <> f.old_sku
   and not exists (select 1 from public.custom_list_items d where d.list_key = f.list_key and d.sku = f.new_sku);

update public.custom_lists
   set name = 'موسوعة الفروق اللغويه', updated_at = now()
 where list_id = 194 and name like 'CustomListExport%';

update public.custom_lists c
   set item_count = (select count(*) from public.custom_list_items i where i.list_key = c.id);
