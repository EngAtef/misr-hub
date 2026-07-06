"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Download, Info, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";
import { formatNumber, toCsv, downloadCsv, cn } from "@/lib/utils";

interface ReorderRow {
  sku: string;
  product_name: string;
  units_recent: number;
  units_prior: number;
  velocity_per_day: number;
  trend_pct: number | null;
  projected_demand: number;
  current_stock: number | null;
  lead_time_days: number;
  days_of_cover: number | null;
  suggested_reorder: number;
  priority: "stockout" | "urgent" | "high" | "rising" | "normal";
}

const PRIORITY_STYLE: Record<string, string> = {
  stockout: "bg-fuchsia-100 text-fuchsia-800",
  urgent: "bg-red-100 text-red-700",
  high: "bg-amber-100 text-amber-800",
  rising: "bg-blue-100 text-blue-800",
  normal: "bg-slate-100 text-slate-600",
};
const PRIORITY_KEY: Record<string, DictKey> = {
  stockout: "prioStockout",
  urgent: "prioUrgent",
  high: "prioHigh",
  rising: "prioRising",
  normal: "prioNormal",
};

export default function StockPage() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [periodDays, setPeriodDays] = useState(30);
  const [coverDays, setCoverDays] = useState(45);
  const [maxOrder, setMaxOrder] = useState(150);
  const [rows, setRows] = useState<ReorderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("fn_reorder_suggestions", {
      p_period_days: periodDays,
      p_cover_days: coverDays,
      p_min_units: 3,
      p_max_order: maxOrder,
    });
    setRows((data as ReorderRow[]) ?? []);
    setLoading(false);
  }, [supabase, periodDays, coverDays, maxOrder]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveStock(row: ReorderRow) {
    const raw = edits[row.sku];
    if (raw === undefined || raw === "") return;
    const value = parseInt(raw, 10);
    if (isNaN(value)) return;
    setSaving(row.sku);
    await supabase.from("stock_items").upsert(
      { sku: row.sku, product_name: row.product_name, current_stock: value, updated_at: new Date().toISOString() },
      { onConflict: "sku" }
    );
    setSaving(null);
    await load();
  }

  function exportCsv() {
    if (!rows.length) return;
    downloadCsv(`reorder-suggestions-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows as unknown as Record<string, unknown>[]));
  }

  // Exactly the format sent to the warehouse team: Sku | product name | restock
  function exportForTeam() {
    const list = rows
      .filter((r) => r.suggested_reorder > 0 && r.sku !== "(no sku)")
      .map((r) => ({ Sku: r.sku, "product name": r.product_name, restock: r.suggested_reorder }));
    if (!list.length) return;
    downloadCsv(`restock-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(list));
  }

  return (
    <div>
      <PageHeader
        title={t("stock")}
        subtitle={t("stockSubtitle")}
        actions={
          rows.length > 0 ? (
            <div className="flex gap-2">
              <button className="btn-primary" onClick={exportForTeam}>
                <Download size={16} />
                {t("exportForTeam")}
              </button>
              <button className="btn-secondary" onClick={exportCsv}>
                <Download size={16} />
                {t("exportCsv")}
              </button>
            </div>
          ) : undefined
        }
      />

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-semibold mb-1 text-slate-500">{t("periodDays")}</label>
          <select className="input !w-auto" value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))}>
            {[14, 30, 60, 90].map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1 text-slate-500">{t("coverDays")}</label>
          <select className="input !w-auto" value={coverDays} onChange={(e) => setCoverDays(Number(e.target.value))}>
            {[15, 30, 45, 60, 90].map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1 text-slate-500">{t("maxOrder")}</label>
          <select className="input !w-auto" value={maxOrder} onChange={(e) => setMaxOrder(Number(e.target.value))}>
            {[50, 100, 150, 200, 300].map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-lg bg-brand-50 border border-brand-100 px-4 py-3 text-sm text-brand-800">
        <Info size={16} className="shrink-0" />
        {t("stockMethodNote")}
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
                <th>{t("products")}</th>
                <th>{t("sku")}</th>
                <th>{t("units")} ({periodDays}{t("days")})</th>
                <th>{t("velocity")}</th>
                <th>{t("trend")}</th>
                <th>{t("projectedDemand")}</th>
                <th>{t("currentStock")}</th>
                <th>{t("daysOfCover")}</th>
                <th>{t("suggestedReorder")}</th>
                <th>{t("priority")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku}>
                  <td className="!whitespace-normal max-w-xs font-medium">{r.product_name}</td>
                  <td dir="ltr" className="font-mono text-xs text-slate-500">{r.sku}</td>
                  <td className="font-semibold">{formatNumber(r.units_recent)}</td>
                  <td>{formatNumber(r.velocity_per_day)}</td>
                  <td className={cn(r.trend_pct != null && (r.trend_pct >= 0 ? "text-emerald-600" : "text-red-600"))}>
                    {r.trend_pct != null ? `${r.trend_pct > 0 ? "+" : ""}${r.trend_pct}%` : "—"}
                  </td>
                  <td className="font-semibold">{formatNumber(r.projected_demand)}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        className="input !py-1 !w-20 text-xs"
                        dir="ltr"
                        placeholder={r.current_stock != null ? String(r.current_stock) : "—"}
                        value={edits[r.sku] ?? ""}
                        onChange={(e) => setEdits((p) => ({ ...p, [r.sku]: e.target.value }))}
                      />
                      {edits[r.sku] !== undefined && edits[r.sku] !== "" && (
                        <button
                          className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                          disabled={saving === r.sku}
                          onClick={() => saveStock(r)}
                        >
                          <Save size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className={cn(r.days_of_cover != null && r.days_of_cover < r.lead_time_days && "text-red-600 font-semibold")}>
                    {r.days_of_cover != null ? formatNumber(r.days_of_cover) : "—"}
                  </td>
                  <td className="font-bold text-brand-700">{formatNumber(r.suggested_reorder)}</td>
                  <td>
                    <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold", PRIORITY_STYLE[r.priority])}>
                      {t(PRIORITY_KEY[r.priority])}
                    </span>
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
