"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { useRpc, rangeParams } from "@/lib/use-analytics";
import { PageHeader, KpiCard, ChartCard, Spinner } from "@/components/ui";
import { TrendChart } from "@/components/charts";
import { formatMoney, cn } from "@/lib/utils";

interface Pnl {
  revenue: number; cogs: number; gross_profit: number; ad_spend: number;
  delivery_cost: number; returns_loss: number; orders: number; cost_coverage: number;
}
interface MonthRow { month: string; revenue: number; cogs: number; ad_spend: number; delivery_cost: number; returns_loss: number; }

export default function PnlPage() {
  const { t, lang } = useLang();
  const { preset, setPreset, range, setRange } = useDateRange("30d");
  const [margin, setMargin] = useState(30);
  const params = rangeParams(range);
  const deps = [range.from, range.to, margin];
  const pnl = useRpc<Pnl>("fn_pnl", { ...params, p_default_margin: margin / 100 }, deps);
  const byMonth = useRpc<MonthRow[]>("fn_pnl_by_month", { ...params, p_default_margin: margin / 100 }, deps);

  const p = pnl.data;
  const net = p ? p.gross_profit - p.ad_spend - p.delivery_cost - p.returns_loss : 0;
  const netMargin = p && p.revenue ? (net / p.revenue) * 100 : 0;

  const waterfall = p
    ? [
        { name: t("pnlRevenue"), value: p.revenue, color: "#1b6ef5" },
        { name: t("pnlCogs"), value: -p.cogs, color: "#f97316" },
        { name: t("pnlAdSpend"), value: -p.ad_spend, color: "#ef4444" },
        { name: t("pnlDelivery"), value: -p.delivery_cost, color: "#f59e0b" },
        { name: t("pnlReturns"), value: -p.returns_loss, color: "#e11d48" },
        { name: t("pnlNet"), value: net, color: "#10b981" },
      ]
    : [];

  return (
    <div>
      <PageHeader
        title={t("pnl")}
        subtitle={t("pnlSubtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-slate-500">{t("defaultMargin")}</span>
              <input type="number" min={0} max={90} className="input !w-16 !py-1" dir="ltr" value={margin} onChange={(e) => setMargin(Number(e.target.value) || 0)} />
            </div>
            <DateRangeFilter preset={preset} setPreset={setPreset} range={range} setRange={setRange} />
          </div>
        }
      />

      {pnl.loading || !p ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            <KpiCard label={t("pnlRevenue")} value={formatMoney(p.revenue, lang)} />
            <KpiCard label={t("pnlCogs")} value={formatMoney(p.cogs, lang)} accent="amber" />
            <KpiCard label={t("pnlGross")} value={formatMoney(p.gross_profit, lang)} accent="green" />
            <KpiCard label={t("pnlNet")} value={formatMoney(net, lang)} sub={`${t("pnlNetMargin")}: ${netMargin.toFixed(1)}%`} accent={net > 0 ? "green" : "red"} />
          </div>

          {p.cost_coverage < 50 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              {t("pnlCostNote")} ({t("costCoverage")}: {p.cost_coverage}%)
            </div>
          )}

          <div className="card p-5">
            <h3 className="mb-4 text-sm font-bold text-slate-700">{t("pnlWaterfall")}</h3>
            <div className="space-y-2.5">
              {waterfall.map((w, i) => {
                const max = p.revenue || 1;
                const pct = Math.abs(w.value) / max * 100;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-40 shrink-0 text-sm font-medium text-slate-600">{w.name}</span>
                    <div className="flex-1 h-6 rounded bg-slate-50 relative overflow-hidden">
                      <div className="h-full rounded" style={{ width: `${pct}%`, background: w.color }} />
                    </div>
                    <span className={cn("w-32 shrink-0 text-end text-sm font-bold", w.value < 0 ? "text-red-600" : "text-slate-800")} dir="ltr">
                      {w.value < 0 ? "−" : ""}{formatMoney(Math.abs(w.value), lang)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <KpiCard label={t("pnlAdSpend")} value={formatMoney(p.ad_spend, lang)} accent="red" />
            <KpiCard label={t("pnlDelivery")} value={formatMoney(p.delivery_cost, lang)} accent="amber" />
            <KpiCard label={t("pnlReturns")} value={formatMoney(p.returns_loss, lang)} accent="red" />
          </div>

          {byMonth.data && byMonth.data.length > 0 && (
            <ChartCard title={t("pnlTrend")}>
              <TrendChart
                data={byMonth.data.map((m) => ({
                  month: new Date(m.month).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }),
                  revenue: m.revenue,
                  net: Math.round(m.revenue - m.cogs - m.ad_spend - m.delivery_cost - m.returns_loss),
                })) as unknown as Record<string, unknown>[]}
                xKey="month"
                series={[
                  { key: "revenue", name: t("pnlRevenue") },
                  { key: "net", name: t("pnlNet"), color: "#10b981" },
                ]}
              />
            </ChartCard>
          )}
        </div>
      )}
    </div>
  );
}
