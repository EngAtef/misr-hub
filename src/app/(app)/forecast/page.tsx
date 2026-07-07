"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";
import { formatNumber, toCsv, downloadCsv, cn } from "@/lib/utils";

interface Row {
  sku: string; product_name: string; units_30d: number; units_prev_30d: number;
  velocity_per_day: number; seasonal_factor: number; forecast_next_30: number;
  current_ecom: number | null; suggested_buy: number;
}

export default function ForecastPage() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.rpc("fn_demand_forecast", { p_limit: 100 }).then(({ data }) => {
      setRows((data as Row[]) ?? []);
      setLoading(false);
    });
  }, [supabase]);

  return (
    <div>
      <PageHeader
        title={t("forecast")}
        subtitle={t("forecastSubtitle")}
        actions={
          rows.length > 0 ? (
            <button className="btn-secondary" onClick={() => downloadCsv(`forecast-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows as unknown as Record<string, unknown>[]))}>
              <Download size={16} />
              {t("exportCsv")}
            </button>
          ) : undefined
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg bg-brand-50 border border-brand-100 px-4 py-2.5 text-xs text-brand-800">
        <Info size={15} className="shrink-0 mt-0.5" />
        {t("forecastNote")}
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
                <th>{t("fcUnits30")}</th>
                <th>{t("fcVelocity")}</th>
                <th>{t("fcSeasonal")}</th>
                <th>{t("fcForecast")}</th>
                <th>{t("fcCurrentStock")}</th>
                <th>{t("fcSuggestedBuy")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku}>
                  <td className="!whitespace-normal max-w-xs font-medium">{r.product_name}</td>
                  <td dir="ltr" className="font-mono text-xs text-slate-500">{r.sku}</td>
                  <td className="font-semibold">{formatNumber(r.units_30d)}</td>
                  <td>{formatNumber(r.velocity_per_day)}</td>
                  <td>
                    <span className={cn("font-semibold", r.seasonal_factor > 1.2 ? "text-emerald-600" : r.seasonal_factor < 0.8 ? "text-red-600" : "text-slate-600")}>
                      {formatNumber(r.seasonal_factor)}×
                    </span>
                  </td>
                  <td className="font-bold text-brand-700">{formatNumber(r.forecast_next_30)}</td>
                  <td className={cn(r.current_ecom != null && r.current_ecom < r.forecast_next_30 && "text-red-600 font-semibold")}>
                    {r.current_ecom != null ? formatNumber(r.current_ecom) : "—"}
                  </td>
                  <td className={cn("font-bold", r.suggested_buy > 0 ? "text-amber-700" : "text-slate-400")}>{formatNumber(r.suggested_buy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
