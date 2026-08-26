"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Users, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { SearchBox } from "@/components/search-box";
import { ProductDrawer } from "@/components/product-drawer";
import { rangeParams } from "@/lib/use-analytics";
import { PageHeader, Spinner, EmptyState, SortTh, Pagination, DeltaBadge, type SortState } from "@/components/ui";
import { formatMoney, formatNumber, formatWeight, formatDate, toCsv, downloadCsv, cn } from "@/lib/utils";
import { rpcAll } from "@/lib/rpc-all";

// One row per catalog SKU — sales figures are LEFT-joined, so books with
// no stock and books that never sold are present with zeros.
interface CatalogRow {
  sku: string;
  product_name: string;
  category: string | null;
  vendor: string | null;
  ecom_stock: number | null;
  sap_stock: number | null;
  price: number | null;
  image: string | null;
  author: string | null;
  publisher: string | null;
  language: string | null;
  age: string | null;
  series: string | null;
  barcode: string | null;
  units: number;
  orders: number;
  revenue: number;
  lifetime_units: number;
  lifetime_orders: number;
  lifetime_revenue: number;
  first_order_date: string | null;
  last_order_date: string | null;
  total_count: number;
  // migration 115 — catalog weight per unit, period and lifetime shipped weight
  unit_weight_kg?: number | null;
  weight_kg?: number | null;
  lifetime_weight_kg?: number | null;
  // migration 119 — global storefront USD price (null = not sold globally)
  price_usd?: number | null;
}

interface Totals {
  products: number;
  never_sold: number;
  out_of_stock: number;
  units: number;
  orders: number;
  revenue: number;
  lifetime_units: number;
  lifetime_revenue: number;
  weight_kg?: number;
  lifetime_weight_kg?: number;
}

const PAGE_SIZE = 100;

const SCOPES = [
  { key: "all", label: "scopeAll" },
  { key: "sold", label: "scopeSold" },
  { key: "unsold", label: "scopeUnsold" },
  { key: "never", label: "scopeNever" },
  { key: "ever", label: "scopeEver" },
  { key: "oos", label: "scopeOos" },
  { key: "instock", label: "scopeInstock" },
  { key: "global", label: "scopeGlobal" },
  { key: "not_global", label: "scopeNotGlobal" },
] as const;

export default function ProductsPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const { preset, setPreset, range, setRange, comparePreset, setComparePreset, customCompare, setCustomCompare, compare } = useDateRange("month");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [scope, setScope] = useState<string>("all");
  const [sort, setSort] = useState<SortState>({ key: "units", dir: "desc" });
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [compareBySku, setCompareBySku] = useState<Map<string, { units: number; revenue: number }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [openSku, setOpenSku] = useState<CatalogRow | null>(null);

  const total = totals?.products ?? rows[0]?.total_count ?? 0;
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  // any filter change invalidates the current page number
  useEffect(() => {
    setPage(0);
  }, [search, scope, range.from, range.to, sort?.key, sort?.dir]);

  // ?q= deep link — the SKU links inside an order's line items land here.
  // Scope is forced to the whole catalog so a 0-stock or never-sold book
  // is never filtered out from under the link.
  useEffect(() => {
    const onNav = () => {
      const q = new URLSearchParams(window.location.search).get("q");
      if (q !== null && q !== "") {
        setSearchInput(q);
        setSearch(q.trim());
        setScope("all");
        setPage(0);
      }
    };
    onNav();
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);

  // main table — server-side search/scope/sort/pagination over the whole catalog
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc("fn_catalog_products", {
        ...rangeParams(range),
        p_search: search || null,
        p_scope: scope,
        p_sort: sort?.key ?? "units",
        p_dir: sort?.dir ?? "desc",
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (cancelled) return;
      setLoadError(!!error);
      setRows(error ? [] : ((data as CatalogRow[]) ?? []));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, range.from, range.to, search, scope, sort?.key, sort?.dir, page]);

  // totals strip (whole filtered set, not just this page)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("fn_catalog_products_totals", {
        ...rangeParams(range),
        p_search: search || null,
        p_scope: scope,
      });
      if (!cancelled) setTotals(((data as Totals[]) ?? [])[0] ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, range.from, range.to, search, scope]);

  // comparison period — per-SKU deltas for the visible rows
  useEffect(() => {
    if (!compare) {
      setCompareBySku(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("fn_product_stats", {
        ...rangeParams(compare),
        p_search: search || null,
        p_limit: 20000,
      });
      if (cancelled) return;
      const map = new Map<string, { units: number; revenue: number }>();
      for (const r of (data as { sku: string; units: number; revenue: number }[]) ?? []) {
        map.set(r.sku, { units: Number(r.units), revenue: Number(r.revenue) });
      }
      setCompareBySku(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, compare, search]);

  function toggleSort(key: string) {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  }

  function toggle(sku: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  }

  // Buyer exports are always lifetime: a book can be out of stock with no
  // sales this period and still have a full buyer list worth mailing.
  async function exportBuyers(skus: string[], filename: string) {
    setExporting(true);
    const all: Record<string, unknown>[] = [];
    for (const sku of skus) {
      if (sku === "(no sku)") continue;
      const { data } = await supabase.rpc("fn_sku_purchasers", {
        p_sku: sku,
        p_keyword: null,
        p_from: null,
        p_to: null,
        p_limit: 10000,
      });
      for (const r of (data as Record<string, unknown>[]) ?? []) all.push(r);
    }
    if (all.length) downloadCsv(filename, toCsv(all));
    setExporting(false);
  }

  async function exportView() {
    setExporting(true);
    const data = await rpcAll<CatalogRow>(supabase, "fn_catalog_products", {
      ...rangeParams(range),
      p_search: search || null,
      p_scope: scope,
      p_sort: sort?.key ?? "units",
      p_dir: sort?.dir ?? "desc",
      p_limit: 50000,
      p_offset: 0,
    });
    const list = data.map((r) => ({
      sku: r.sku,
      product_name: r.product_name,
      category: r.category,
      vendor: r.vendor,
      author: r.author,
      publisher: r.publisher,
      language: r.language,
      age: r.age,
      series: r.series,
      barcode: r.barcode,
      price: r.price,
      image: r.image,
      ecom_stock: r.ecom_stock,
      sap_stock: r.sap_stock,
      units_period: r.units,
      orders_period: r.orders,
      revenue_period: r.revenue,
      lifetime_units: r.lifetime_units,
      lifetime_orders: r.lifetime_orders,
      lifetime_revenue: r.lifetime_revenue,
      unit_weight_kg: r.unit_weight_kg ?? null,
      weight_period_kg: r.weight_kg ?? null,
      lifetime_weight_kg: r.lifetime_weight_kg ?? null,
      first_order_date: r.first_order_date,
      last_order_date: r.last_order_date,
    }));
    if (list.length) downloadCsv(`catalog-${scope}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(list));
    setExporting(false);
  }

  return (
    <div>
      <PageHeader
        title={t("productsPage")}
        subtitle={t("productsSubtitle")}
        actions={
          <>
            <button className="btn-secondary" disabled={exporting || !rows.length} onClick={exportView}>
              <Download size={16} />
              {t("exportView")}
            </button>
            {selected.size > 0 && (
              <button
                className="btn-primary"
                disabled={exporting}
                onClick={() => exportBuyers([...selected], `buyers-${selected.size}-books-${new Date().toISOString().slice(0, 10)}.csv`)}
              >
                <Users size={16} />
                {t("exportSelected")} ({selected.size})
              </button>
            )}
          </>
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

        <div className="flex flex-wrap items-center gap-1.5">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              onClick={() => setScope(s.key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                scope === s.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              {t(s.label)}
            </button>
          ))}
        </div>

        <SearchBox
          className="max-w-md"
          placeholder={t("searchProducts")}
          value={searchInput}
          onChange={setSearchInput}
          onCommit={setSearch}
          active={!!search}
        />

        {totals && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-violet-50 border border-violet-100 px-4 py-2.5 text-sm text-violet-900">
            <span className="flex items-center gap-1.5">
              <span className="font-semibold">{formatNumber(totals.products)}</span>
              <span className="text-violet-600">{t("productsCount")}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="font-semibold">{t("units")}:</span>
              <span className="font-bold" dir="ltr">{formatNumber(totals.units)}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="font-semibold">{t("revenue")}:</span>
              <span className="font-bold" dir="ltr">{formatMoney(totals.revenue, lang)}</span>
            </span>
            <span className="flex items-center gap-2" title={`${t("ltWeight")}: ${formatWeight(totals.lifetime_weight_kg, lang)}`}>
              <span className="font-semibold">{t("weightCol")}:</span>
              <span className="font-bold" dir="ltr">{formatWeight(totals.weight_kg, lang)}</span>
            </span>
            <span className="flex items-center gap-2 text-violet-600">
              <span>{t("scopeNever")}:</span>
              <span className="font-bold" dir="ltr">{formatNumber(totals.never_sold)}</span>
            </span>
            <span className="flex items-center gap-2 text-violet-600">
              <span>{t("scopeOos")}:</span>
              <span className="font-bold" dir="ltr">{formatNumber(totals.out_of_stock)}</span>
            </span>
          </div>
        )}

        <p className="flex items-start gap-1.5 text-xs text-slate-500">
          <Info size={13} className="mt-0.5 shrink-0" />
          {t("catalogNote")} {t("buyersScopeNote")}
        </p>
      </div>

      {loading && rows.length === 0 ? (
        <Spinner />
      ) : loadError ? (
        <EmptyState message={t("error")} />
      ) : rows.length === 0 ? (
        <EmptyState message={t("noData")} />
      ) : (
        <>
          <div className={cn("card overflow-x-auto", loading && "opacity-50 pointer-events-none")}>
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-8" title={t("selectForList")} aria-label={t("selectForList")}>
                    S
                  </th>
                  <th className="w-12"></th>
                  <SortTh label={t("products")} k="name" sort={sort} onToggle={toggleSort} />
                  <SortTh label={t("sku")} k="sku" sort={sort} onToggle={toggleSort} />
                  <th>{t("fldAuthor")}</th>
                  <th>{t("categoryCol")}</th>
                  <SortTh label={t("fldPrice")} k="price" sort={sort} onToggle={toggleSort} />
                  <SortTh label={t("stock")} k="stock" sort={sort} onToggle={toggleSort} />
                  <SortTh label={t("units")} k="units" sort={sort} onToggle={toggleSort} />
                  <SortTh label={t("orders")} k="orders" sort={sort} onToggle={toggleSort} />
                  <SortTh label={t("revenue")} k="revenue" sort={sort} onToggle={toggleSort} />
                  <SortTh label={t("weightCol")} k="weight" sort={sort} onToggle={toggleSort} />
                  <SortTh label={t("ltUnits")} k="lifetime_units" sort={sort} onToggle={toggleSort} />
                  <SortTh label={t("ltRevenue")} k="lifetime_revenue" sort={sort} onToggle={toggleSort} />
                  <SortTh label={t("lastSale")} k="last_sale" sort={sort} onToggle={toggleSort} />
                  <th>{t("buyers")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const stock = r.ecom_stock ?? 0;
                  const cmp = compareBySku?.get(r.sku);
                  return (
                    <tr key={r.sku} className={cn(r.lifetime_units === 0 && "bg-slate-50/60")}>
                      <td>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand-600"
                          checked={selected.has(r.sku)}
                          disabled={r.sku === "(no sku)"}
                          onChange={() => toggle(r.sku)}
                        />
                      </td>
                      <td>
                        {r.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.image}
                            alt=""
                            loading="lazy"
                            className="h-11 w-8 rounded object-cover ring-1 ring-slate-200"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                            }}
                          />
                        ) : (
                          <div className="h-11 w-8 rounded bg-slate-100" />
                        )}
                      </td>
                      <td className="!whitespace-normal max-w-md">
                        <button className="text-start font-medium hover:text-brand-700 hover:underline" onClick={() => setOpenSku(r)}>
                          {r.product_name}
                        </button>
                        {r.series && <div className="text-[11px] text-slate-400">{r.series}</div>}
                      </td>
                      <td dir="ltr" className="font-mono text-xs text-slate-500">{r.sku}</td>
                      <td className="!whitespace-normal max-w-[10rem] text-xs text-slate-600">{r.author ?? r.publisher ?? "—"}</td>
                      <td className="text-xs text-slate-500">{r.category ?? "—"}</td>
                      <td className="whitespace-nowrap text-sm">
                        {r.price === null ? "—" : formatMoney(Number(r.price), lang)}
                        {r.price_usd != null && (
                          <div className="text-[11px] text-emerald-700" dir="ltr" title={t("usdPriceCol")}>
                            🌍 ${Number(r.price_usd).toFixed(2)}
                          </div>
                        )}
                      </td>
                      <td>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-semibold",
                            r.ecom_stock === null ? "bg-slate-100 text-slate-400" : stock > 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
                          )}
                          dir="ltr"
                        >
                          {r.ecom_stock === null ? "—" : formatNumber(stock)}
                        </span>
                      </td>
                      <td className="font-semibold">
                        <span className="inline-flex items-center gap-1.5">
                          {formatNumber(Number(r.units))}
                          {compareBySku && <DeltaBadge current={Number(r.units)} previous={Number(cmp?.units ?? 0)} fmtPrev={formatNumber} />}
                        </span>
                      </td>
                      <td>{formatNumber(Number(r.orders))}</td>
                      <td>
                        <span className="inline-flex items-center gap-1.5">
                          {formatMoney(Number(r.revenue), lang)}
                          {compareBySku && (
                            <DeltaBadge current={Number(r.revenue)} previous={Number(cmp?.revenue ?? 0)} fmtPrev={(n) => formatMoney(n, lang)} />
                          )}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-xs" dir="ltr">
                        <div>{formatWeight(r.weight_kg, lang)}</div>
                        {r.unit_weight_kg != null && (
                          <div className="text-[10px] text-slate-400" title={t("ltWeight")}>
                            {formatWeight(r.unit_weight_kg, lang)}/{t("unitLbl")} · {formatWeight(r.lifetime_weight_kg, lang)}
                          </div>
                        )}
                      </td>
                      <td className="font-semibold text-slate-700">{formatNumber(Number(r.lifetime_units))}</td>
                      <td className="text-slate-700">{formatMoney(Number(r.lifetime_revenue), lang)}</td>
                      <td className="whitespace-nowrap text-xs text-slate-500">
                        {r.last_order_date ? formatDate(r.last_order_date) : <span className="text-slate-400">{t("neverSoldLbl")}</span>}
                      </td>
                      <td>
                        <button
                          className={cn(
                            "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold",
                            r.sku === "(no sku)" ? "text-slate-300" : "bg-brand-50 text-brand-700 hover:bg-brand-100"
                          )}
                          disabled={r.sku === "(no sku)"}
                          onClick={() => setOpenSku(r)}
                        >
                          <Users size={14} />
                          {formatNumber(Number(r.lifetime_orders))}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-3 flex justify-center">
              <Pagination page={page} totalPages={totalPages} onPage={setPage} />
            </div>
          )}
        </>
      )}

      <ProductDrawer
        sku={openSku?.sku ?? null}
        name={openSku?.product_name}
        stock={openSku?.ecom_stock ?? null}
        onClose={() => setOpenSku(null)}
      />
    </div>
  );
}
