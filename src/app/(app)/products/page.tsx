"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { SearchBox } from "@/components/search-box";
import { rangeParams } from "@/lib/use-analytics";
import { PageHeader, Spinner, EmptyState, SortTh, useSort, DeltaBadge } from "@/components/ui";
import { formatMoney, formatNumber, toCsv, downloadCsv, cn } from "@/lib/utils";

interface ProductRow {
  sku: string;
  product_name: string;
  units: number;
  orders: number;
  revenue: number;
}

export default function ProductsPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const { preset, setPreset, range, setRange, comparePreset, setComparePreset, customCompare, setCustomCompare, compare } = useDateRange("30d");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [compareRows, setCompareRows] = useState<ProductRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const { sort, toggle: toggleSort, apply } = useSort<ProductRow>();

  const sortedRows = useMemo(
    () =>
      apply(rows, {
        name: (r) => r.product_name,
        sku: (r) => r.sku,
        units: (r) => r.units,
        orders: (r) => r.orders,
        revenue: (r) => r.revenue,
      }),
    [rows, apply]
  );

  // guarded against overlapping fetches: a slow stale response must never
  // overwrite the rows of a newer filter selection
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc("fn_product_stats", {
        ...rangeParams(range),
        p_search: search || null,
        p_limit: 500,
      });
      if (cancelled) return;
      setLoadError(!!error);
      setRows(error ? [] : ((data as ProductRow[]) ?? []));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, range.from, range.to, search]);

  // same search, comparison period -> per-SKU units/revenue to diff against
  useEffect(() => {
    if (!compare) {
      setCompareRows(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("fn_product_stats", {
        ...rangeParams(compare),
        p_search: search || null,
        p_limit: 500,
      });
      if (!cancelled) setCompareRows((data as ProductRow[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, compare, search]);

  const cmpBySku = useMemo(() => {
    if (!compare || !compareRows) return null;
    return new Map(compareRows.map((r) => [r.sku, r]));
  }, [compare, compareRows]);

  const totals = useMemo(() => {
    const sum = (list: ProductRow[]) => ({
      units: list.reduce((s, r) => s + Number(r.units || 0), 0),
      revenue: list.reduce((s, r) => s + Number(r.revenue || 0), 0),
    });
    return { cur: sum(rows), prev: compareRows ? sum(compareRows) : null };
  }, [rows, compareRows]);

  function toggle(sku: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  }

  async function exportBuyers(skus: string[], filename: string) {
    setExporting(true);
    const all: Record<string, unknown>[] = [];
    for (const sku of skus) {
      if (sku === "(no sku)") continue;
      const { data } = await supabase.rpc("fn_sku_purchasers", {
        p_sku: sku,
        p_keyword: null,
        ...rangeParams(range),
        p_limit: 10000,
      });
      for (const r of (data as Record<string, unknown>[]) ?? []) all.push(r);
    }
    if (all.length) {
      downloadCsv(filename, toCsv(all));
    }
    setExporting(false);
  }

  return (
    <div>
      <PageHeader
        title={t("productsPage")}
        subtitle={t("productsSubtitle")}
        actions={
          selected.size > 0 ? (
            <button
              className="btn-primary"
              disabled={exporting}
              onClick={() => exportBuyers([...selected], `buyers-${selected.size}-books-${new Date().toISOString().slice(0, 10)}.csv`)}
            >
              <Download size={16} />
              {t("exportSelected")} ({selected.size})
            </button>
          ) : undefined
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
        {compare && totals.prev && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-violet-50 border border-violet-100 px-4 py-2.5 text-sm text-violet-900">
            <span className="flex items-center gap-2">
              <span className="font-semibold">{t("units")}:</span>
              <span className="font-bold" dir="ltr">{formatNumber(totals.cur.units)}</span>
              <DeltaBadge current={totals.cur.units} previous={totals.prev.units} fmtPrev={formatNumber} />
            </span>
            <span className="flex items-center gap-2">
              <span className="font-semibold">{t("revenue")}:</span>
              <span className="font-bold" dir="ltr">{formatMoney(totals.cur.revenue, lang)}</span>
              <DeltaBadge current={totals.cur.revenue} previous={totals.prev.revenue} fmtPrev={(n) => formatMoney(n, lang)} />
            </span>
            <span className="text-xs text-violet-500" dir="ltr">
              {t("vsLbl")} {compare.from} → {compare.to}
            </span>
          </div>
        )}
        <SearchBox
          className="max-w-md"
          placeholder={t("searchProducts")}
          value={searchInput}
          onChange={setSearchInput}
          onCommit={setSearch}
          active={!!search}
        />
      </div>

      {loading && rows.length === 0 ? (
        <Spinner />
      ) : loadError ? (
        <EmptyState message={t("error")} />
      ) : rows.length === 0 ? (
        <EmptyState message={t("noData")} />
      ) : (
        <div className={cn("card overflow-x-auto", loading && "opacity-50 pointer-events-none")}>
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-10">{t("selectForList")}</th>
                <SortTh label={t("products")} k="name" sort={sort} onToggle={toggleSort} />
                <SortTh label={t("sku")} k="sku" sort={sort} onToggle={toggleSort} />
                <SortTh label={t("units")} k="units" sort={sort} onToggle={toggleSort} />
                <SortTh label={t("orders")} k="orders" sort={sort} onToggle={toggleSort} />
                <SortTh label={t("revenue")} k="revenue" sort={sort} onToggle={toggleSort} />
                <th>{t("buyers")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.sku}>
                  <td>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-600"
                      checked={selected.has(r.sku)}
                      disabled={r.sku === "(no sku)"}
                      onChange={() => toggle(r.sku)}
                    />
                  </td>
                  <td className="!whitespace-normal max-w-md font-medium">{r.product_name}</td>
                  <td dir="ltr" className="font-mono text-xs text-slate-500">{r.sku}</td>
                  <td className="font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      {formatNumber(r.units)}
                      {cmpBySku && <DeltaBadge current={Number(r.units)} previous={Number(cmpBySku.get(r.sku)?.units ?? 0)} fmtPrev={formatNumber} />}
                    </span>
                  </td>
                  <td>{formatNumber(r.orders)}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      {formatMoney(r.revenue, lang)}
                      {cmpBySku && (
                        <DeltaBadge
                          current={Number(r.revenue)}
                          previous={Number(cmpBySku.get(r.sku)?.revenue ?? 0)}
                          fmtPrev={(n) => formatMoney(n, lang)}
                        />
                      )}
                    </span>
                  </td>
                  <td>
                    <button
                      className={cn(
                        "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold",
                        r.sku === "(no sku)" ? "text-slate-300" : "bg-brand-50 text-brand-700 hover:bg-brand-100"
                      )}
                      disabled={r.sku === "(no sku)" || exporting}
                      onClick={() => exportBuyers([r.sku], `buyers-${r.sku}-${new Date().toISOString().slice(0, 10)}.csv`)}
                    >
                      <Users size={14} />
                      {t("exportBuyers")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
