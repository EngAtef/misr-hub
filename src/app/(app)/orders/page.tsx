"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { PageHeader, StatusBadge, Spinner, SortTh, useSort, DeltaBadge } from "@/components/ui";
import { MultiSelect } from "@/components/multi-select";
import { SearchBox } from "@/components/search-box";
import { formatMoney, formatDateTime, formatNumber, sanitizeSearch } from "@/lib/utils";
import { ContactActions } from "@/components/contact-actions";
import type { Order, OrderItem, OrderEvent, CategoryBuyer, PromoCode, SalesLine } from "@/lib/types";

const PAGE_SIZE = 25;

export default function OrdersPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const { preset, setPreset, range, setRange, comparePreset, setComparePreset, customCompare, setCustomCompare, compare } = useDateRange("30d");
  const [compareTotal, setCompareTotal] = useState<number | null>(null);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [payment, setPayment] = useState<string[]>([]);
  const [city, setCity] = useState<string[]>([]);
  const [source, setSource] = useState<string[]>([]);
  const [category, setCategory] = useState<string[]>([]);
  const [subCategory, setSubCategory] = useState<string[]>([]);
  const [brand, setBrand] = useState<string[]>([]);
  const [promo, setPromo] = useState<string[]>([]);
  const [view, setView] = useState<"orders" | "buyers">("orders");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Order | null>(null);
  const { sort, toggle } = useSort<Order>();
  const [buyers, setBuyers] = useState<CategoryBuyer[]>([]);
  const [buyersLoading, setBuyersLoading] = useState(false);
  const [selectedBuyer, setSelectedBuyer] = useState<CategoryBuyer | null>(null);
  const { sort: bSort, toggle: bToggle, apply: bApply } = useSort<CategoryBuyer>();
  const [filterOptions, setFilterOptions] = useState<{
    statuses: string[];
    payments: string[];
    cities: string[];
    sources: string[];
    categories: string[];
    subCategories: string[];
    brands: string[];
    promos: string[];
  }>({
    statuses: [],
    payments: [],
    cities: [],
    sources: [],
    categories: [],
    subCategories: [],
    brands: [],
    promos: [],
  });

  useEffect(() => {
    async function loadOptions() {
      const [s, p, c, src, cat, sub, br, prm] = await Promise.all([
        supabase.rpc("fn_breakdown", { p_dim: "order_status", p_from: null, p_to: null, p_limit: 50 }),
        supabase.rpc("fn_breakdown", { p_dim: "payment_method", p_from: null, p_to: null, p_limit: 20 }),
        supabase.rpc("fn_breakdown", { p_dim: "city", p_from: null, p_to: null, p_limit: 50 }),
        supabase.rpc("fn_breakdown", { p_dim: "source", p_from: null, p_to: null, p_limit: 10 }),
        supabase.rpc("fn_product_sales_breakdown", { p_by: "category", p_from: null, p_to: null }),
        supabase.rpc("fn_product_sales_breakdown", { p_by: "sub_category", p_from: null, p_to: null }),
        supabase.rpc("fn_product_sales_breakdown", { p_by: "brand", p_from: null, p_to: null }),
        supabase.rpc("fn_breakdown", { p_dim: "applied_offer", p_from: null, p_to: null, p_limit: 200 }),
      ]);
      const labels = (d: unknown) =>
        ((d as { label: string }[] | null) ?? []).map((x) => x.label).filter((x) => x !== "(none)");
      const keys = (d: unknown) => ((d as { key: string }[] | null) ?? []).map((x) => x.key).filter((x) => x !== "—");
      setFilterOptions({
        statuses: labels(s.data),
        payments: labels(p.data),
        cities: labels(c.data),
        sources: labels(src.data),
        categories: keys(cat.data),
        subCategories: keys(sub.data),
        brands: keys(br.data),
        promos: labels(prm.data),
      });
    }
    loadOptions();
  }, [supabase]);

  // guarded against overlapping fetches: a slow stale response must never
  // overwrite the rows of a newer filter selection
  useEffect(() => {
    if (view !== "orders") return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      // category lives on order lines (product_sales); the view exposes it
      // as an array per order — only used when the filter is active
      const needsView = category.length > 0 || subCategory.length > 0 || brand.length > 0;
      let query = supabase
        .from(needsView ? "orders_with_categories" : "orders")
        .select("*", { count: "exact" });
      if (range.from) query = query.gte("order_date", `${range.from}T00:00:00Z`);
      if (range.to) query = query.lte("order_date", `${range.to}T23:59:59Z`);
      if (status.length) query = query.in("order_status", status);
      if (payment.length) query = query.in("payment_method", payment);
      if (city.length) query = query.in("city", city);
      if (source.length) query = query.in("source", source);
      if (category.length) query = query.overlaps("categories", category);
      if (subCategory.length) query = query.overlaps("sub_categories", subCategory);
      if (brand.length) query = query.overlaps("brands", brand);
      if (promo.length) query = query.in("applied_offer", promo);
      if (search) {
        const s = sanitizeSearch(search);
        if (s) {
          query = query.or(
            `order_number.ilike.%${s}%,customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%,awb_number.ilike.%${s}%`
          );
        }
      }
      // sorting happens in the database so it covers all pages, not just the visible one
      const { data, count } = await query
        .order(sort?.key ?? "order_date", { ascending: sort?.dir === "asc", nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (cancelled) return;
      setRows((data as Order[]) ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, view, range.from, range.to, status, payment, city, source, category, subCategory, brand, promo, search, page, sort]);

  // same filters, comparison period -> matching order count
  useEffect(() => {
    if (!compare) {
      setCompareTotal(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const needsView = category.length > 0 || subCategory.length > 0 || brand.length > 0;
      let query = supabase
        .from(needsView ? "orders_with_categories" : "orders")
        .select("order_number", { count: "exact", head: true });
      if (compare.from) query = query.gte("order_date", `${compare.from}T00:00:00Z`);
      if (compare.to) query = query.lte("order_date", `${compare.to}T23:59:59Z`);
      if (status.length) query = query.in("order_status", status);
      if (payment.length) query = query.in("payment_method", payment);
      if (city.length) query = query.in("city", city);
      if (source.length) query = query.in("source", source);
      if (category.length) query = query.overlaps("categories", category);
      if (subCategory.length) query = query.overlaps("sub_categories", subCategory);
      if (brand.length) query = query.overlaps("brands", brand);
      if (promo.length) query = query.in("applied_offer", promo);
      if (search) {
        const s = sanitizeSearch(search);
        if (s) {
          query = query.or(
            `order_number.ilike.%${s}%,customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%,awb_number.ilike.%${s}%`
          );
        }
      }
      const { count } = await query;
      if (!cancelled) setCompareTotal(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, compare, status, payment, city, source, category, subCategory, brand, promo, search]);

  // buyers view: per-customer aggregates within the selected categories
  // and period (fn_category_buyers). PostgREST caps RPC results at
  // max-rows, so page until exhausted (10k safety cap), then sort and
  // search client-side so any column can be arranged instantly.
  useEffect(() => {
    if (view !== "buyers") return;
    let cancelled = false;
    setBuyersLoading(true);
    (async () => {
      const pageSize = 1000;
      const all: CategoryBuyer[] = [];
      for (let i = 0; i < 10; i++) {
        const { data } = await supabase
          .rpc("fn_category_buyers", {
            p_categories: category.length ? category : null,
            p_sub_categories: subCategory.length ? subCategory : null,
            p_brands: brand.length ? brand : null,
            p_from: range.from ? `${range.from}T00:00:00Z` : null,
            p_to: range.to ? `${range.to}T23:59:59Z` : null,
          })
          .range(i * pageSize, i * pageSize + pageSize - 1);
        if (cancelled) return;
        const batch = (data as CategoryBuyer[] | null) ?? [];
        all.push(...batch);
        if (batch.length < pageSize) break;
      }
      setBuyers(all);
      setBuyersLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, view, category, subCategory, brand, range.from, range.to]);

  const filteredBuyers = useMemo(() => {
    let list = buyers;
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(
        (b) =>
          (b.customer_name ?? "").toLowerCase().includes(s) ||
          (b.customer_phone ?? "").includes(s)
      );
    }
    return bApply(list, {
      customer_name: (b) => b.customer_name,
      city: (b) => b.city,
      orders_count: (b) => b.orders_count,
      units: (b) => b.units,
      spend: (b) => b.spend,
      first_order: (b) => b.first_order,
      last_order: (b) => b.last_order,
    });
  }, [buyers, search, bApply]);

  // changing the date range must restart pagination
  useEffect(() => {
    setPage(0);
  }, [range.from, range.to]);

  // ?q= deep link from the sidebar quick search
  useEffect(() => {
    const onNav = () => {
      const q = new URLSearchParams(window.location.search).get("q");
      if (q !== null && q !== "") {
        setSearchInput(q);
        setSearch(q.trim());
        setPage(0);
      }
    };
    onNav();
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);

  const totalPages =
    view === "orders"
      ? Math.max(1, Math.ceil(total / PAGE_SIZE))
      : Math.max(1, Math.ceil(filteredBuyers.length / PAGE_SIZE));

  function onSort(key: string) {
    toggle(key);
    setPage(0);
  }

  function onBuyersSort(key: string) {
    bToggle(key);
    setPage(0);
  }

  function exportCsv() {
    const params = new URLSearchParams();
    if (range.from) params.set("from", `${range.from}T00:00:00Z`);
    if (range.to) params.set("to", `${range.to}T23:59:59Z`);
    for (const s of status) params.append("status", s);
    for (const p of payment) params.append("payment", p);
    for (const c of city) params.append("city", c);
    for (const s of source) params.append("source", s);
    for (const c of category) params.append("category", c);
    for (const sc of subCategory) params.append("sub_category", sc);
    for (const b of brand) params.append("brand", b);
    for (const p of promo) params.append("promo", p);
    if (search) params.set("q", search);
    window.open(`/api/export?${params.toString()}`, "_blank");
  }

  function exportBuyersCsv() {
    const params = new URLSearchParams();
    if (range.from) params.set("from", `${range.from}T00:00:00Z`);
    if (range.to) params.set("to", `${range.to}T23:59:59Z`);
    for (const c of category) params.append("category", c);
    for (const sc of subCategory) params.append("sub_category", sc);
    for (const b of brand) params.append("brand", b);
    window.open(`/api/export/buyers?${params.toString()}`, "_blank");
  }

  return (
    <div>
      <PageHeader
        title={t("orders")}
        subtitle={
          view === "orders"
            ? `${formatNumber(total)} ${t("ordersLabel")}`
            : `${formatNumber(filteredBuyers.length)} ${t("buyersLbl")}`
        }
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
              {(["orders", "buyers"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setView(v);
                    setPage(0);
                  }}
                  className={
                    view === v
                      ? "rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white"
                      : "rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-brand-700"
                  }
                >
                  {t(v === "orders" ? "ordersView" : "buyersView")}
                </button>
              ))}
            </div>
            <button onClick={view === "orders" ? exportCsv : exportBuyersCsv} className="btn-secondary">
              <Download size={16} />
              {view === "orders" ? t("exportCsv") : t("exportBuyers")}
            </button>
          </div>
        }
      />

      <div className="card p-4 mb-4 space-y-3">
        <DateRangeFilter
          preset={preset}
          setPreset={setPreset}
          range={range}
          setRange={setRange}
          comparePreset={comparePreset}
          setComparePreset={setComparePreset}
          customCompare={customCompare}
          setCustomCompare={setCustomCompare}
          compare={compare}
        />
        {view === "orders" && compare && compareTotal !== null && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-violet-50 border border-violet-100 px-4 py-2.5 text-sm text-violet-900">
            <span className="font-semibold">{t("results")}:</span>
            <span className="font-bold" dir="ltr">{formatNumber(total)}</span>
            <DeltaBadge current={total} previous={compareTotal} fmtPrev={formatNumber} />
            <span className="text-xs text-violet-500">
              {t("vsLbl")} {formatNumber(compareTotal)} ({compare.from} → {compare.to})
            </span>
          </div>
        )}
        <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-4">
          <SearchBox
            className="md:col-span-3 lg:col-span-2"
            placeholder={view === "orders" ? t("searchOrders") : t("searchBuyers")}
            value={searchInput}
            onChange={setSearchInput}
            onCommit={(v) => {
              setPage(0);
              setSearch(v);
            }}
            active={!!search}
          />
          {view === "orders" && (
            <>
              <MultiSelect
                options={filterOptions.statuses}
                values={status}
                onChange={(v) => { setStatus(v); setPage(0); }}
                placeholder={t("allStatuses")}
              />
              <MultiSelect
                options={filterOptions.payments}
                values={payment}
                onChange={(v) => { setPayment(v); setPage(0); }}
                placeholder={t("allPayments")}
              />
              <MultiSelect
                options={filterOptions.cities}
                values={city}
                onChange={(v) => { setCity(v); setPage(0); }}
                placeholder={t("allCities")}
              />
              <MultiSelect
                options={filterOptions.sources}
                values={source}
                onChange={(v) => { setSource(v); setPage(0); }}
                placeholder={t("allSources")}
              />
            </>
          )}
          <MultiSelect
            options={filterOptions.categories}
            values={category}
            onChange={(v) => { setCategory(v); setPage(0); }}
            placeholder={t("allCategories")}
          />
          <MultiSelect
            options={filterOptions.subCategories}
            values={subCategory}
            onChange={(v) => { setSubCategory(v); setPage(0); }}
            placeholder={t("allSubCategories")}
          />
          <MultiSelect
            options={filterOptions.brands}
            values={brand}
            onChange={(v) => { setBrand(v); setPage(0); }}
            placeholder={t("allVendors")}
          />
          {view === "orders" && (
            <MultiSelect
              options={filterOptions.promos}
              values={promo}
              onChange={(v) => { setPromo(v); setPage(0); }}
              placeholder={t("allPromos")}
            />
          )}
        </div>
        {view === "buyers" && (
          <div className="text-xs text-slate-500">
            {t("buyersHint")} · {t("purchasesHint")}
          </div>
        )}
      </div>

      <div className="card overflow-x-auto">
        {view === "buyers" ? (
          buyersLoading ? (
            <Spinner />
          ) : filteredBuyers.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <div>{t("noResults")}</div>
              <div className="mt-1 text-xs">{t("buyersNeedSales")}</div>
            </div>
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>#</th>
                  <SortTh label={t("customer")} k="customer_name" sort={bSort} onToggle={onBuyersSort} />
                  <SortTh label={t("city")} k="city" sort={bSort} onToggle={onBuyersSort} />
                  <SortTh label={t("orders")} k="orders_count" sort={bSort} onToggle={onBuyersSort} />
                  <SortTh label={t("units")} k="units" sort={bSort} onToggle={onBuyersSort} />
                  <SortTh label={t("spendInCategory")} k="spend" sort={bSort} onToggle={onBuyersSort} />
                  <SortTh label={t("firstOrder")} k="first_order" sort={bSort} onToggle={onBuyersSort} />
                  <SortTh label={t("lastOrder")} k="last_order" sort={bSort} onToggle={onBuyersSort} />
                  <th>{t("categoryCol")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredBuyers.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((b, i) => (
                  <tr key={b.customer_key} onClick={() => setSelectedBuyer(b)} className="cursor-pointer">
                    <td className="text-slate-400">{page * PAGE_SIZE + i + 1}</td>
                    <td>
                      <div className="font-medium">{b.customer_name ?? "—"}</div>
                      <div className="text-xs text-slate-400" dir="ltr">{b.customer_phone ?? ""}</div>
                    </td>
                    <td>{b.city ?? "—"}</td>
                    <td className="text-center font-semibold">{formatNumber(b.orders_count)}</td>
                    <td className="text-center">{formatNumber(b.units ?? 0)}</td>
                    <td className="font-semibold">{formatMoney(b.spend, lang)}</td>
                    <td className="text-xs text-slate-500">{b.first_order ? formatDateTime(b.first_order) : "—"}</td>
                    <td className="text-xs text-slate-500">{b.last_order ? formatDateTime(b.last_order) : "—"}</td>
                    <td
                      className="text-xs text-slate-500 max-w-[220px] truncate"
                      title={(b.categories ?? []).join("، ")}
                    >
                      {(b.categories ?? []).join("، ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-500">{t("noResults")}</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <SortTh label={t("orderNumber")} k="order_number" sort={sort} onToggle={onSort} />
                <SortTh label={t("orderDate")} k="order_date" sort={sort} onToggle={onSort} />
                <SortTh label={t("customer")} k="customer_name" sort={sort} onToggle={onSort} />
                <SortTh label={t("city")} k="city" sort={sort} onToggle={onSort} />
                <SortTh label={t("status")} k="order_status" sort={sort} onToggle={onSort} />
                <SortTh label={t("paymentMethod")} k="payment_method" sort={sort} onToggle={onSort} />
                <SortTh label={t("amount")} k="total_order_amount" sort={sort} onToggle={onSort} />
                <SortTh label={t("promoCode")} k="applied_offer" sort={sort} onToggle={onSort} />
                <SortTh label={t("itemsCount")} k="items_count" sort={sort} onToggle={onSort} />
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.order_number} onClick={() => setSelected(o)} className="cursor-pointer">
                  <td className="font-bold text-brand-700" dir="ltr">#{o.order_number}</td>
                  <td className="text-xs text-slate-500">{formatDateTime(o.order_date)}</td>
                  <td>
                    <div className="font-medium">{o.customer_name ?? "—"}</div>
                    <div className="text-xs text-slate-400" dir="ltr">{o.customer_phone ?? ""}</div>
                  </td>
                  <td>{o.city ?? "—"}</td>
                  <td><StatusBadge status={o.order_status} /></td>
                  <td className="text-xs">{o.payment_method ?? "—"}</td>
                  <td className="font-semibold">{formatMoney(o.total_order_amount, lang)}</td>
                  <td>
                    {o.applied_offer ? (
                      <span className="inline-block rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700" dir="ltr">
                        {o.applied_offer}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="text-center">{o.items_count ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <span>
          {t("page")} {page + 1} {t("of")} {formatNumber(totalPages)}
        </span>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
            {t("previous")}
          </button>
          <button className="btn-secondary" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>
            {t("next")}
          </button>
        </div>
      </div>

      {selected && <OrderDetail order={selected} onClose={() => setSelected(null)} />}
      {selectedBuyer && (
        <BuyerDetail
          buyer={selectedBuyer}
          categories={category}
          subCategories={subCategory}
          brands={brand}
          range={range}
          onClose={() => setSelectedBuyer(null)}
        />
      )}
    </div>
  );
}

// human label for a promo's value: 1 = fixed EGP, 2 = percent,
// 3 = free delivery, 4 = gift
function promoValueLabel(p: PromoCode, lang: "ar" | "en", labels: { freeDelivery: string; gift: string }): string {
  if (p.type === 2 && p.amount != null) return `${p.amount}%`;
  if (p.type === 1 && p.amount != null) return formatMoney(p.amount, lang);
  if (p.type === 3 || p.free_delivery) return labels.freeDelivery;
  if (p.type === 4) return labels.gift;
  return p.amount != null ? String(p.amount) : "—";
}

function OrderDetail({ order, onClose }: { order: Order; onClose: () => void }) {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [salesLines, setSalesLines] = useState<SalesLine[]>([]);
  const [promoInfo, setPromoInfo] = useState<PromoCode | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [i, e, sl, p] = await Promise.all([
        supabase.from("order_items").select("*").eq("order_number", order.order_number).order("position"),
        supabase.from("order_events").select("*").eq("order_number", order.order_number).order("seq"),
        // ProductSalesExport lines carry quantity + discount detail the
        // OrderExport items lack; prefer them when uploaded
        supabase.from("product_sales").select("*").eq("order_id", order.order_number).order("product_name"),
        order.applied_offer
          ? supabase.from("promo_codes").select("*").eq("name", order.applied_offer).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      setItems((i.data as OrderItem[]) ?? []);
      setEvents((e.data as OrderEvent[]) ?? []);
      setSalesLines((sl.data as SalesLine[]) ?? []);
      setPromoInfo((p.data as PromoCode | null) ?? null);
      setLoading(false);
    }
    load();
  }, [supabase, order.order_number, order.applied_offer]);

  const lineTotals = useMemo(
    () => ({
      qty: salesLines.reduce((s, l) => s + (l.quantity ?? 0), 0),
      price: salesLines.reduce((s, l) => s + (l.price ?? 0), 0),
      discounted: salesLines.reduce((s, l) => s + (l.price_after_discount ?? l.price ?? 0), 0),
    }),
    [salesLines]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between bg-white border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold" dir="ltr">
              {t("orderDetails")} #{order.order_number}
            </h2>
            <div className="text-xs text-slate-500">{formatDateTime(order.order_date)}</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={order.order_status} />
            {order.delivery_status && <StatusBadge status={order.delivery_status} />}
            <div className="ms-auto">
              <ContactActions
                phone={order.customer_phone}
                name={order.customer_name}
                waReason="general"
                orderNumber={order.order_number}
                compact={false}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="card p-4">
              <h3 className="text-xs font-bold uppercase text-slate-500 mb-2">{t("customer")}</h3>
              <div className="text-sm space-y-1">
                <div className="font-semibold">{order.customer_name ?? "—"}</div>
                <div dir="ltr" className="text-slate-600">{order.customer_phone ?? "—"}</div>
                <div className="text-slate-600">
                  {[order.city, order.area, order.district].filter(Boolean).join(" — ") || "—"}
                </div>
                {order.full_address && <div className="text-xs text-slate-500">{order.full_address}</div>}
              </div>
            </div>
            <div className="card p-4">
              <h3 className="text-xs font-bold uppercase text-slate-500 mb-2">{t("paymentInfo")}</h3>
              <div className="text-sm space-y-1">
                <div>{order.payment_method ?? "—"}</div>
                <div className="font-bold text-lg">{formatMoney(order.total_order_amount, lang)}</div>
                {order.cod_amount != null && order.cod_amount > 0 && (
                  <div className="text-xs text-amber-700">COD: {formatMoney(order.cod_amount, lang)}</div>
                )}
                {order.applied_offer && (
                  <div className="rounded-lg bg-violet-50 border border-violet-100 px-2.5 py-1.5 text-xs text-violet-900 space-y-0.5">
                    <div>
                      <span className="font-semibold">{t("promoCode")}:</span>{" "}
                      <span className="font-bold" dir="ltr">{order.applied_offer}</span>
                      {promoInfo && <> — {promoValueLabel(promoInfo, lang, { freeDelivery: t("freeDeliveryLbl"), gift: t("giftLbl") })}</>}
                      {promoInfo && (
                        <span
                          className={
                            promoInfo.active
                              ? "ms-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
                              : "ms-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600"
                          }
                        >
                          {promoInfo.active ? t("promoActiveLbl") : t("promoInactiveLbl")}
                        </span>
                      )}
                    </div>
                    {promoInfo?.minimum_order_amount != null && promoInfo.minimum_order_amount > 0 && (
                      <div className="text-violet-600">
                        {t("minOrderLbl")}: {formatMoney(promoInfo.minimum_order_amount, lang)}
                        {promoInfo.expiration_date && <> · {t("validUntil")}: {formatDateTime(promoInfo.expiration_date)}</>}
                      </div>
                    )}
                    {order.promo_amount != null && order.promo_amount > 0 && (
                      <div className="text-violet-600">
                        {t("promoDiscountLbl")}: {formatMoney(order.promo_amount, lang)}
                      </div>
                    )}
                  </div>
                )}
                {order.awb_number && (
                  <div className="text-xs text-slate-500" dir="ltr">
                    {t("awb")}: {order.awb_number}
                  </div>
                )}
              </div>
            </div>
          </div>

          {(order.cancellation_reason || order.customer_notes || order.admin_notes) && (
            <div className="card p-4 space-y-1 text-sm">
              {order.cancellation_reason && (
                <div className="text-red-700">
                  <span className="font-semibold">{t("cancellationReasons")}:</span> {order.cancellation_reason}
                  {order.cancellation_note ? ` — ${order.cancellation_note}` : ""}
                </div>
              )}
              {order.customer_notes && (
                <div><span className="font-semibold">{t("notes")}:</span> {order.customer_notes}</div>
              )}
              {order.admin_notes && (
                <div className="text-slate-600"><span className="font-semibold">Admin:</span> {order.admin_notes}</div>
              )}
            </div>
          )}

          {loading ? (
            <Spinner />
          ) : (
            <>
              <div>
                <h3 className="text-sm font-bold mb-2">
                  {t("orderItems")} ({salesLines.length || items.length})
                </h3>
                <div className="card overflow-x-auto">
                  {salesLines.length > 0 ? (
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>{t("products")}</th>
                          <th>SKU</th>
                          <th>{t("qty")}</th>
                          <th>{t("unitPriceCol")}</th>
                          <th>{t("amount")}</th>
                          <th>{t("afterDiscountCol")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {salesLines.map((l, i) => (
                          <tr key={l.sku ?? i}>
                            <td className="text-slate-400">{i + 1}</td>
                            <td className="!whitespace-normal">
                              {l.product_name ?? "—"}
                              <div className="text-[10px] text-slate-400">
                                {[l.category, l.sub_category, l.brand].filter(Boolean).join(" · ")}
                                {l.promotion ? ` · ${l.promotion}` : ""}
                              </div>
                            </td>
                            <td dir="ltr" className="text-xs text-slate-500">{l.sku ?? "—"}</td>
                            <td className="text-center font-bold">{formatNumber(l.quantity ?? 1)}</td>
                            <td className="text-xs">{formatMoney(l.unit_price, lang)}</td>
                            <td>{formatMoney(l.price, lang)}</td>
                            <td className="font-semibold text-emerald-700">
                              {formatMoney(l.price_after_discount ?? l.price, lang)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="font-bold bg-slate-50">
                          <td colSpan={3}>{t("results")}</td>
                          <td className="text-center">{formatNumber(lineTotals.qty)}</td>
                          <td />
                          <td>{formatMoney(lineTotals.price, lang)}</td>
                          <td className="text-emerald-700">{formatMoney(lineTotals.discounted, lang)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  ) : (
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>{t("products")}</th>
                          <th>SKU</th>
                          <th>{t("amount")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it) => (
                          <tr key={it.position}>
                            <td className="text-slate-400">{it.position}</td>
                            <td className="!whitespace-normal">{it.product_name ?? "—"}</td>
                            <td dir="ltr" className="text-xs text-slate-500">{it.sku ?? "—"}</td>
                            <td>{formatMoney(it.price, lang)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold mb-2">{t("orderTimeline")}</h3>
                <div className="space-y-0">
                  {events.map((ev, i) => (
                    <div key={ev.seq} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="h-3 w-3 rounded-full bg-brand-500 mt-1.5" />
                        {i < events.length - 1 && <div className="w-px flex-1 bg-slate-200" />}
                      </div>
                      <div className="pb-4">
                        <div className="text-sm font-semibold">{ev.state_name}</div>
                        <div className="text-xs text-slate-500">
                          {formatDateTime(ev.state_date)}
                          {ev.admin_name ? ` — ${ev.admin_name}` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Buyer drill-down: every book this customer bought (within the active
// category/sub-category/brand/date filters), grouped per order with
// quantity and discount detail from the ProductSalesExport lines.
function BuyerDetail({
  buyer,
  categories,
  subCategories,
  brands,
  range,
  onClose,
}: {
  buyer: CategoryBuyer;
  categories: string[];
  subCategories: string[];
  brands: string[];
  range: { from: string | null; to: string | null };
  onClose: () => void;
}) {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [lines, setLines] = useState<SalesLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("fn_customer_purchases", {
        p_customer_key: buyer.customer_key,
        p_categories: categories.length ? categories : null,
        p_sub_categories: subCategories.length ? subCategories : null,
        p_brands: brands.length ? brands : null,
        p_from: range.from ? `${range.from}T00:00:00Z` : null,
        p_to: range.to ? `${range.to}T23:59:59Z` : null,
      });
      if (cancelled) return;
      setLines((data as SalesLine[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, buyer.customer_key, categories, subCategories, brands, range.from, range.to]);

  // group lines per order, newest first (RPC is already sorted)
  const orders = useMemo(() => {
    const map = new Map<string, SalesLine[]>();
    for (const l of lines) {
      const list = map.get(l.order_id) ?? [];
      list.push(l);
      map.set(l.order_id, list);
    }
    return Array.from(map.entries());
  }, [lines]);

  const totals = useMemo(
    () => ({
      qty: lines.reduce((s, l) => s + (l.quantity ?? 0), 0),
      spend: lines.reduce((s, l) => s + (l.price_after_discount ?? l.price ?? 0), 0),
    }),
    [lines]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between bg-white border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold">
              {t("buyerPurchases")} — {buyer.customer_name ?? buyer.customer_phone ?? buyer.customer_key}
            </h2>
            <div className="text-xs text-slate-500" dir="ltr">
              {buyer.customer_phone ?? ""}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">
              {formatNumber(orders.length)} {t("ordersLabel")}
            </span>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">
              {t("units")}: {formatNumber(totals.qty)}
            </span>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
              {t("totalSpent")}: {formatMoney(totals.spend, lang)}
            </span>
            <div className="ms-auto">
              <ContactActions
                phone={buyer.customer_phone}
                name={buyer.customer_name}
                waReason="general"
                compact={false}
              />
            </div>
          </div>

          {loading ? (
            <Spinner />
          ) : orders.length === 0 ? (
            <div className="p-8 text-center text-slate-500">{t("noResults")}</div>
          ) : (
            orders.map(([orderId, orderLines]) => (
              <div key={orderId}>
                <div className="mb-1.5 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold text-brand-700" dir="ltr">#{orderId}</span>
                  <span className="text-xs text-slate-500">{formatDateTime(orderLines[0].order_date)}</span>
                  <StatusBadge status={orderLines[0].order_status} />
                </div>
                <div className="card overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>{t("products")}</th>
                        <th>SKU</th>
                        <th>{t("qty")}</th>
                        <th>{t("unitPriceCol")}</th>
                        <th>{t("afterDiscountCol")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderLines.map((l, i) => (
                        <tr key={`${l.sku ?? i}`}>
                          <td className="!whitespace-normal">
                            {l.product_name ?? "—"}
                            <div className="text-[10px] text-slate-400">
                              {[l.category, l.sub_category, l.brand].filter(Boolean).join(" · ")}
                              {l.promotion ? ` · ${l.promotion}` : ""}
                            </div>
                          </td>
                          <td dir="ltr" className="text-xs text-slate-500">{l.sku ?? "—"}</td>
                          <td className="text-center font-bold">{formatNumber(l.quantity ?? 1)}</td>
                          <td className="text-xs">{formatMoney(l.unit_price, lang)}</td>
                          <td className="font-semibold text-emerald-700">
                            {formatMoney(l.price_after_discount ?? l.price, lang)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
