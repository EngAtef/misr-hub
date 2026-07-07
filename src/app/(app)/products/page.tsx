"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Download, Users, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { rangeParams } from "@/lib/use-analytics";
import { PageHeader, Spinner, EmptyState, SortTh, useSort } from "@/components/ui";
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
  const { preset, setPreset, range, setRange } = useDateRange("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
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

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("fn_product_stats", {
      ...rangeParams(range),
      p_search: search || null,
      p_limit: 500,
    });
    setRows((data as ProductRow[]) ?? []);
    setLoading(false);
  }, [supabase, range.from, range.to, search]);

  useEffect(() => {
    load();
  }, [load]);

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
        <DateRangeFilter preset={preset} setPreset={setPreset} range={range} setRange={setRange} />
        <form
          className="relative max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input ps-9"
            placeholder={t("searchProducts")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </form>
      </div>

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message={t("noData")} />
      ) : (
        <div className="card overflow-x-auto">
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
                  <td className="font-semibold">{formatNumber(r.units)}</td>
                  <td>{formatNumber(r.orders)}</td>
                  <td>{formatMoney(r.revenue, lang)}</td>
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
