"use client";

import { useLang } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { useRpc, rangeParams } from "@/lib/use-analytics";
import { PageHeader, KpiCard, ChartCard, Spinner, EmptyState } from "@/components/ui";
import { AlertsBar } from "@/components/alerts-bar";
import { TrendChart, DonutChart, BarsChart } from "@/components/charts";
import { formatMoney, formatNumber, formatPercent } from "@/lib/utils";
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
              <DonutChart data={(byStatus.data ?? []) as unknown as Record<string, unknown>[]} nameKey="label" valueKey="orders" />
            </ChartCard>
            <ChartCard title={t("ordersByPayment")}>
              <DonutChart data={(byPayment.data ?? []) as unknown as Record<string, unknown>[]} nameKey="label" valueKey="orders" />
            </ChartCard>
            <ChartCard title={t("ordersByCity")}>
              <BarsChart
                data={(byCity.data ?? []) as unknown as Record<string, unknown>[]}
                xKey="label"
                layout="vertical"
                series={[{ key: "orders", name: t("totalOrders") }]}
              />
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
