"use client";

import { useLang } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { useRpc, rangeParams } from "@/lib/use-analytics";
import { PageHeader, KpiCard, ChartCard, Spinner, EmptyState } from "@/components/ui";
import { AlertsBar } from "@/components/alerts-bar";
import { TrendChart, DonutChart } from "@/components/charts";

// Clear ranked list for ALL cities: name, count, share bar — scrolls inside the card
function CityRankList({ rows, total }: { rows: BreakdownRow[]; total: number }) {
  const top = rows;
  const max = Math.max(...top.map((r) => Number(r.orders)), 1);
  return (
    <div className="space-y-2.5 pt-1 max-h-72 overflow-y-auto pe-1">
      {top.map((r, i) => (
        <div key={r.label} className="flex items-center gap-3">
          <span className="w-5 text-xs font-bold text-slate-400">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-semibold text-slate-700">{r.label}</span>
              <span className="shrink-0 text-sm font-bold text-slate-900" dir="ltr">
                {new Intl.NumberFormat("en-EG").format(Number(r.orders))}
                <span className="ms-1 text-[11px] font-semibold text-slate-400">
                  {total ? ((Number(r.orders) / total) * 100).toFixed(0) : 0}%
                </span>
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-500"
                style={{ width: `${(Number(r.orders) / max) * 100}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
import { formatMoney, formatNumber, formatPercent, STATUS_AR } from "@/lib/utils";
import type { Kpis, DayRow, BreakdownRow } from "@/lib/types";

export default function OverviewPage() {
  const { t, lang } = useLang();
  const { preset, setPreset, range, setRange } = useDateRange("30d");
  const params = rangeParams(range);
  const deps = [range.from, range.to];

  const kpis = useRpc<Kpis>("fn_kpis", params, deps);
  const byDay = useRpc<DayRow[]>("fn_orders_by_day", params, deps);
  const byStatus = useRpc<BreakdownRow[]>("fn_breakdown", { p_dim: "order_status", ...params, p_limit: 15 }, deps);
  const byPayment = useRpc<BreakdownRow[]>("fn_breakdown", { p_dim: "payment_method", ...params, p_limit: 10 }, deps);
  const byCity = useRpc<BreakdownRow[]>("fn_breakdown", { p_dim: "city", ...params, p_limit: 10 }, deps);

  const k = kpis.data;
  const hasData = !kpis.loading && k && k.total_orders > 0;

  return (
    <div>
      <PageHeader title={t("overview")} actions={<DateRangeFilter preset={preset} setPreset={setPreset} range={range} setRange={setRange} />} />

      <AlertsBar />

      {kpis.loading ? (
        <Spinner />
      ) : !hasData ? (
        <EmptyState message={t("noData")} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard label={t("totalOrders")} value={formatNumber(k.total_orders)} />
            <KpiCard label={t("grossRevenue")} value={formatMoney(k.gross_revenue, lang)} />
            <KpiCard
              label={t("delivered")}
              value={formatNumber(k.delivered_orders)}
              sub={`${t("deliveryRate")}: ${formatPercent(k.delivered_orders, k.total_orders)}`}
              accent="green"
            />
            <KpiCard
              label={t("cancelled")}
              value={formatNumber(k.cancelled_orders)}
              sub={`${t("cancellationRate")}: ${formatPercent(k.cancelled_orders, k.total_orders)}`}
              accent="red"
            />
            <KpiCard
              label={t("returned")}
              value={formatNumber(k.returned_orders)}
              sub={`${t("returnRate")}: ${formatPercent(k.returned_orders, k.total_orders)}`}
              accent="amber"
            />
            <KpiCard label={t("avgOrderValue")} value={formatMoney(k.avg_order_value, lang)} accent="slate" />
          </div>

          <ChartCard title={t("ordersPerDay")}>
            <TrendChart
              data={(byDay.data ?? []) as unknown as Record<string, unknown>[]}
              xKey="day"
              series={[
                { key: "orders", name: t("totalOrders") },
                { key: "delivered", name: t("delivered"), color: "#10b981" },
                { key: "cancelled", name: t("cancelled"), color: "#ef4444" },
              ]}
            />
          </ChartCard>

          <div className="grid gap-6 lg:grid-cols-3">
            <ChartCard title={t("ordersByStatus")}>
              <DonutChart
                data={(byStatus.data ?? []).map((r) => ({
                  ...r,
                  label: lang === "ar" ? (STATUS_AR[r.label] ?? r.label) : r.label,
                })) as unknown as Record<string, unknown>[]}
                nameKey="label"
                valueKey="orders"
              />
            </ChartCard>
            <ChartCard title={t("ordersByPayment")}>
              <DonutChart
                data={(byPayment.data ?? []).map((r) => ({
                  ...r,
                  label: lang === "ar" ? (STATUS_AR[r.label] ?? r.label) : r.label,
                })) as unknown as Record<string, unknown>[]}
                nameKey="label"
                valueKey="orders"
              />
            </ChartCard>
            <ChartCard title={t("ordersByCity")}>
              <CityRankList rows={byCity.data ?? []} total={k.total_orders} />
            </ChartCard>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <KpiCard label={t("codAmount")} value={formatMoney(k.cod_amount, lang)} accent="amber" />
            <KpiCard label={t("onlinePaid")} value={formatMoney(k.online_paid_amount, lang)} />
            <KpiCard label={t("uniqueCustomers")} value={formatNumber(k.unique_customers)} accent="slate" />
            <KpiCard
              label={t("avgDeliveryDays")}
              value={k.avg_delivery_days != null ? `${formatNumber(k.avg_delivery_days)} ${t("days")}` : "—"}
              accent="green"
            />
          </div>
        </div>
      )}
    </div>
  );
}
