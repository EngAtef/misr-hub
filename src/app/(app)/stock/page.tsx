"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { Download, Info, FileSpreadsheet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { PageHeader, Spinner, EmptyState, KpiCard } from "@/components/ui";
import { formatNumber, toCsv, downloadCsv, cn } from "@/lib/utils";

interface EngineRow {
  sku: string;
  product_name: string;
  category: string | null;
  units: number;
  velocity: number;
  forecast: number;
  min_applied: number;
  target: number;
  ecom_stock: number | null;
  sap_stock: number | null;
  cover_days: number | null;
  need: number;
  move_qty: number;
  shortfall: number;
  surplus: number | null;
  status: "move" | "low_sap" | "oos_reorder" | "overstock" | "ok";
}

const STATUS_META: Record<string, { key: DictKey; style: string }> = {
  move: { key: "statusMove", style: "bg-emerald-100 text-emerald-800" },
  low_sap: { key: "statusLowSap", style: "bg-amber-100 text-amber-800" },
  oos_reorder: { key: "statusOos", style: "bg-red-100 text-red-700" },
  overstock: { key: "statusOverstock", style: "bg-blue-100 text-blue-800" },
  ok: { key: "statusOk", style: "bg-slate-100 text-slate-600" },
};

type Tab = "replenish" | "overstock" | "oos";

export default function StockPage() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [windowDays, setWindowDays] = useState(30);
  const [coverDays, setCoverDays] = useState(45);
  const [globalMin, setGlobalMin] = useState(0);
  const [bestsellerMin, setBestsellerMin] = useState(20);
  const [maxOrder, setMaxOrder] = useState(300);
  const [rows, setRows] = useState<EngineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("replenish");
  const [search, setSearch] = useState("");
  const [moveEdits, setMoveEdits] = useState<Record<string, string>>({});
  const [hasStockData, setHasStockData] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("fn_stock_engine", {
      p_window_days: windowDays,
      p_coverage_days: coverDays,
      p_global_min: globalMin,
      p_bestseller_min: bestsellerMin,
      p_bestseller_units: 20,
      p_max_order: maxOrder,
    });
    const list = (data as EngineRow[]) ?? [];
    setRows(list);
    setHasStockData(list.some((r) => r.ecom_stock !== null || r.sap_stock !== null));
    setLoading(false);
  }, [supabase, windowDays, coverDays, globalMin, bestsellerMin, maxOrder]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const bySearch = q
      ? rows.filter((r) => r.product_name?.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q))
      : rows;
    if (tab === "replenish") return bySearch.filter((r) => ["move", "low_sap"].includes(r.status) || (!hasStockData && r.need > 0));
    if (tab === "overstock") return bySearch.filter((r) => r.status === "overstock");
    return bySearch.filter((r) => r.status === "oos_reorder");
  }, [rows, tab, search, hasStockData]);

  const effMove = useCallback(
    (r: EngineRow) => {
      const edit = moveEdits[r.sku];
      if (edit !== undefined && edit !== "") {
        const n = parseInt(edit, 10);
        if (!isNaN(n)) return n;
      }
      return r.move_qty;
    },
    [moveEdits]
  );

  const kpis = useMemo(() => {
    const moveRows = rows.filter((r) => ["move", "low_sap"].includes(r.status));
    return {
      toMove: moveRows.reduce((s, r) => s + effMove(r), 0),
      moveSkus: moveRows.length,
      shortfall: rows.reduce((s, r) => s + (r.shortfall ?? 0), 0),
      oos: rows.filter((r) => r.status === "oos_reorder").length,
      overstock: rows.filter((r) => r.status === "overstock").length,
    };
  }, [rows, effMove]);

  function exportTeamCsv() {
    const list = filtered
      .filter((r) => (tab === "replenish" ? effMove(r) > 0 || r.shortfall > 0 : true))
      .map((r) =>
        tab === "replenish"
          ? { Sku: r.sku, "product name": r.product_name, restock: effMove(r) + r.shortfall }
          : tab === "overstock"
            ? { Sku: r.sku, "product name": r.product_name, "E-com now": r.ecom_stock, "Expected demand": r.forecast, Surplus: r.surplus }
            : { Sku: r.sku, "product name": r.product_name, "Units sold": r.units, Status: r.units > 0 ? "Had sales - reorder from publisher" : "No stock anywhere" }
      );
    if (!list.length) return;
    downloadCsv(`stock-${tab}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(list as Record<string, unknown>[]));
  }

  // Multi-sheet workbook like the ProMax engine: Move list + Overstock + Out of stock
  function exportWorkbook() {
    const wb = XLSX.utils.book_new();
    const moveRows = rows
      .filter((r) => ["move", "low_sap"].includes(r.status) && (effMove(r) > 0 || r.shortfall > 0))
      .map((r) => ({
        Sku: r.sku,
        "product name": r.product_name,
        Category: r.category ?? "",
        "Units sold": r.units,
        "Sales/day": r.velocity,
        Target: r.target,
        "E-com now": r.ecom_stock ?? "",
        "SAP avail": r.sap_stock ?? "",
        "Move qty": effMove(r),
        Shortfall: r.shortfall,
        Status: r.status === "low_sap" ? "Low SAP stock" : "Move",
      }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(moveRows.length ? moveRows : [{ Sku: "none" }]), "Move list");

    const overRows = rows
      .filter((r) => r.status === "overstock")
      .map((r) => ({
        Sku: r.sku,
        "product name": r.product_name,
        Category: r.category ?? "",
        "E-com now": r.ecom_stock,
        "Expected demand": r.forecast,
        Surplus: r.surplus,
        "Cover (days)": r.cover_days ?? "",
      }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(overRows.length ? overRows : [{ Sku: "none" }]), "Overstock");

    const oosRows = rows
      .filter((r) => r.status === "oos_reorder")
      .map((r) => ({
        Sku: r.sku,
        "product name": r.product_name,
        "Units sold": r.units,
        Status: r.units > 0 ? "Had sales - reorder from publisher" : "No stock anywhere",
      }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oosRows.length ? oosRows : [{ Sku: "none" }]), "Out of stock");

    XLSX.writeFile(wb, `Stock_replenishment_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const TABS: { key: Tab; labelKey: DictKey; count: number }[] = [
    { key: "replenish", labelKey: "stockTabReplenish", count: kpis.moveSkus },
    { key: "overstock", labelKey: "stockTabOverstock", count: kpis.overstock },
    { key: "oos", labelKey: "stockTabOos", count: kpis.oos },
  ];

  return (
    <div>
      <PageHeader
        title={t("stock")}
        subtitle={t("stockSubtitle")}
        actions={
          <div className="flex gap-2">
            <button className="btn-primary" onClick={exportWorkbook}>
              <FileSpreadsheet size={16} />
              {t("exportMoveList")}
            </button>
            <button className="btn-secondary" onClick={exportTeamCsv}>
              <Download size={16} />
              {t("exportCsv")}
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 mb-4">
        <KpiCard label={t("moveQty")} value={formatNumber(kpis.toMove)} sub={`${kpis.moveSkus} SKU`} accent="green" />
        <KpiCard label={t("shortfall")} value={formatNumber(kpis.shortfall)} accent="amber" />
        <KpiCard label={t("stockTabOos")} value={formatNumber(kpis.oos)} accent="red" />
        <KpiCard label={t("stockTabOverstock")} value={formatNumber(kpis.overstock)} accent="slate" />
      </div>

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <Ctl label={t("windowDays")}>
          <select className="input !w-auto" value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
            {[14, 30, 60, 90].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Ctl>
        <Ctl label={t("coverDays")}>
          <select className="input !w-auto" value={coverDays} onChange={(e) => setCoverDays(Number(e.target.value))}>
            {[15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Ctl>
        <Ctl label={t("globalMin")}>
          <input type="number" min={0} className="input !w-20" dir="ltr" value={globalMin} onChange={(e) => setGlobalMin(Number(e.target.value) || 0)} />
        </Ctl>
        <Ctl label={t("bestsellerMin")}>
          <input type="number" min={0} className="input !w-20" dir="ltr" value={bestsellerMin} onChange={(e) => setBestsellerMin(Number(e.target.value) || 0)} />
        </Ctl>
        <Ctl label={t("maxOrder")}>
          <select className="input !w-auto" value={maxOrder} onChange={(e) => setMaxOrder(Number(e.target.value))}>
            {[100, 150, 200, 300, 500].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Ctl>
        <div className="flex-1 min-w-[180px]">
          <input className="input" placeholder={t("searchProducts")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {!hasStockData && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <Info size={16} className="shrink-0" />
          {t("stockUploadNote")}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {TABS.map((x) => (
          <button
            key={x.key}
            onClick={() => setTab(x.key)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-semibold transition",
              tab === x.key ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            )}
          >
            {t(x.labelKey)} <span className="text-xs opacity-60">({x.count})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState message={t("noResults")} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t("products")}</th>
                <th>{t("sku")}</th>
                <th>{t("units")} ({windowDays}d)</th>
                <th>{t("velocity")}</th>
                {tab === "replenish" && (
                  <>
                    <th>{t("targetQty")}</th>
                    <th>{t("ecomStock")}</th>
                    <th>{t("sapStock")}</th>
                    <th>{t("moveQty")}</th>
                    <th>{t("shortfall")}</th>
                  </>
                )}
                {tab === "overstock" && (
                  <>
                    <th>{t("ecomStock")}</th>
                    <th>{t("forecastQty")}</th>
                    <th>{t("surplusQty")}</th>
                    <th>{t("daysOfCover")}</th>
                  </>
                )}
                {tab === "oos" && (
                  <>
                    <th>{t("ecomStock")}</th>
                    <th>{t("sapStock")}</th>
                    <th>{t("forecastQty")}</th>
                  </>
                )}
                <th>{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const meta = STATUS_META[r.status];
                return (
                  <tr key={r.sku}>
                    <td className="!whitespace-normal max-w-xs font-medium">{r.product_name}</td>
                    <td dir="ltr" className="font-mono text-xs text-slate-500">{r.sku}</td>
                    <td className="font-semibold">{formatNumber(r.units)}</td>
                    <td>{formatNumber(r.velocity)}</td>
                    {tab === "replenish" && (
                      <>
                        <td>{formatNumber(r.target)}</td>
                        <td>{r.ecom_stock != null ? formatNumber(r.ecom_stock) : "—"}</td>
                        <td className={cn(r.status === "low_sap" && "text-amber-700 font-semibold")}>
                          {r.sap_stock != null ? formatNumber(r.sap_stock) : "—"}
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            className="input !py-1 !w-20 text-xs font-bold text-brand-700"
                            dir="ltr"
                            value={moveEdits[r.sku] ?? String(r.move_qty)}
                            onChange={(e) => setMoveEdits((p) => ({ ...p, [r.sku]: e.target.value }))}
                          />
                        </td>
                        <td className={cn("font-semibold", r.shortfall > 0 && "text-red-600")}>{formatNumber(r.shortfall)}</td>
                      </>
                    )}
                    {tab === "overstock" && (
                      <>
                        <td>{formatNumber(r.ecom_stock ?? 0)}</td>
                        <td>{formatNumber(r.forecast)}</td>
                        <td className="font-semibold text-blue-700">{formatNumber(r.surplus ?? 0)}</td>
                        <td>{r.cover_days != null ? formatNumber(r.cover_days) : "—"}</td>
                      </>
                    )}
                    {tab === "oos" && (
                      <>
                        <td>{r.ecom_stock != null ? formatNumber(r.ecom_stock) : "—"}</td>
                        <td>{r.sap_stock != null ? formatNumber(r.sap_stock) : "—"}</td>
                        <td>{formatNumber(r.forecast)}</td>
                      </>
                    )}
                    <td>
                      <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", meta.style)}>
                        {t(meta.key)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Ctl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1 text-slate-500">{label}</label>
      {children}
    </div>
  );
}
