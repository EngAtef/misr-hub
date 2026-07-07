"use client";

import { useMemo, useState } from "react";
import { Download, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { rangeParams } from "@/lib/use-analytics";
import { PageHeader, Spinner, EmptyState, SortTh, useSort } from "@/components/ui";
import { toCsv, downloadCsv, formatNumber, cn } from "@/lib/utils";

interface ReportDef {
  key: string;
  labelKey: DictKey;
  rpc: string;
  params?: Record<string, unknown>;
}

const REPORTS: ReportDef[] = [
  { key: "daily", labelKey: "reportSalesByDay", rpc: "fn_orders_by_day" },
  { key: "city", labelKey: "reportByCity", rpc: "fn_breakdown", params: { p_dim: "city", p_limit: 100 } },
  { key: "payment", labelKey: "reportByPayment", rpc: "fn_breakdown", params: { p_dim: "payment_method", p_limit: 50 } },
  { key: "status", labelKey: "reportByStatus", rpc: "fn_breakdown", params: { p_dim: "order_status", p_limit: 50 } },
  { key: "delivery", labelKey: "reportByDeliveryStatus", rpc: "fn_breakdown", params: { p_dim: "delivery_status", p_limit: 50 } },
  { key: "source", labelKey: "reportBySource", rpc: "fn_breakdown", params: { p_dim: "source", p_limit: 20 } },
  { key: "products", labelKey: "reportTopProducts", rpc: "fn_top_products", params: { p_limit: 100 } },
  { key: "team", labelKey: "reportTeam", rpc: "fn_team_activity", params: { p_limit: 100 } },
  { key: "cancellations", labelKey: "reportCancellations", rpc: "fn_breakdown", params: { p_dim: "cancellation_reason", p_limit: 50 } },
  { key: "promotions", labelKey: "reportPromotions", rpc: "fn_breakdown", params: { p_dim: "applied_promotion", p_limit: 100 } },
];

export default function ReportsPage() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const { preset, setPreset, range, setRange } = useDateRange("30d");
  const [selected, setSelected] = useState<ReportDef>(REPORTS[0]);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    const { data } = await supabase.rpc(selected.rpc, { ...rangeParams(range), ...(selected.params ?? {}) });
    setRows((data as Record<string, unknown>[]) ?? []);
    setLoading(false);
  }

  function exportReport() {
    if (!rows?.length) return;
    downloadCsv(`report-${selected.key}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
  }

  function exportAllOrders() {
    const params = new URLSearchParams();
    if (range.from) params.set("from", `${range.from}T00:00:00Z`);
    if (range.to) params.set("to", `${range.to}T23:59:59Z`);
    window.open(`/api/export?${params.toString()}`, "_blank");
  }

  const columns = rows?.length ? Object.keys(rows[0]) : [];
  const { sort, toggle, apply } = useSort<Record<string, unknown>>();

  const sortedRows = useMemo(() => {
    if (!rows?.length) return rows ?? [];
    const accessors = Object.fromEntries(
      Object.keys(rows[0]).map((c) => [c, (r: Record<string, unknown>) => r[c]])
    );
    return apply(rows, accessors);
  }, [rows, apply]);

  return (
    <div>
      <PageHeader
        title={t("reports")}
        actions={
          <button className="btn-secondary" onClick={exportAllOrders}>
            <Download size={16} />
            {t("exportAllOrders")}
          </button>
        }
      />

      <div className="card p-4 mb-6 space-y-4">
        <DateRangeFilter preset={preset} setPreset={setPreset} range={range} setRange={setRange} />
        <div className="flex flex-wrap gap-2">
          {REPORTS.map((r) => (
            <button
              key={r.key}
              onClick={() => {
                setSelected(r);
                setRows(null);
              }}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm font-medium transition",
                selected.key === r.key
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              )}
            >
              {t(r.labelKey)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={generate} disabled={loading}>
            <FileText size={16} />
            {t("generateReport")}
          </button>
          {rows && rows.length > 0 && (
            <button className="btn-secondary" onClick={exportReport}>
              <Download size={16} />
              {t("exportCsv")}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : rows === null ? null : rows.length === 0 ? (
        <EmptyState message={t("noResults")} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                {columns.map((c) => (
                  <SortTh key={c} label={c.replace(/_/g, " ")} k={c} sort={sort} onToggle={toggle} />
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, i) => (
                <tr key={i}>
                  {columns.map((c) => {
                    const v = r[c];
                    return (
                      <td key={c} className={typeof v === "number" ? "font-medium" : ""}>
                        {typeof v === "number" ? formatNumber(v) : v === null || v === "" ? "—" : String(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
