"use client";

import { useState } from "react";
import { useLang, type DictKey } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { useRpc, rangeParams } from "@/lib/use-analytics";
import { PageHeader, ChartCard, KpiCard, Spinner } from "@/components/ui";
import { TrendChart, DonutChart, BarsChart } from "@/components/charts";
import { formatMoney, formatNumber, formatPercent, formatDateTime, cn } from "@/lib/utils";
import type { Kpis, DayRow, BreakdownRow } from "@/lib/types";

type Tab = "sales" | "delivery" | "payments" | "geography" | "products" | "returns" | "team";

const TABS: { key: Tab; labelKey: DictKey }[] = [
  { key: "sales", labelKey: "sales" },
  { key: "delivery", labelKey: "delivery" },
  { key: "payments", labelKey: "payments" },
  { key: "geography", labelKey: "geography" },
  { key: "products", labelKey: "products" },
  { key: "returns", labelKey: "returnsTab" },
  { key: "team", labelKey: "team" },
];

export default function AnalyticsPage() {
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>("sales");
  const { preset, setPreset, range, setRange } = useDateRange("30d");

  return (
    <div>
      <PageHeader title={t("analytics")} actions={<DateRangeFilter preset={preset} setPreset={setPreset} range={range} setRange={setRange} />} />

      <div className="mb-6 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {TABS.map((x) => (
          <button
            key={x.key}
            onClick={() => setTab(x.key)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-semibold transition",
              tab === x.key ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            )}
          >
            {t(x.labelKey)}
          </button>
        ))}
      </div>

      {tab === "sales" && <SalesTab range={range} />}
      {tab === "delivery" && <DeliveryTab range={range} />}
      {tab === "payments" && <PaymentsTab range={range} />}
      {tab === "geography" && <GeographyTab range={range} />}
      {tab === "products" && <ProductsTab range={range} />}
      {tab === "returns" && <ReturnsTab range={range} />}
      {tab === "team" && <TeamTab range={range} />}
    </div>
  );
}

type RangeProp = { range: { from: string | null; to: string | null } };

function SalesTab({ range }: RangeProp) {
  const { t, lang } = useLang();
  const params = rangeParams(range);
  const deps = [range.from, range.to];
  const kpis = useRpc<Kpis>("fn_kpis", params, deps);
  const byDay = useRpc<DayRow[]>("fn_orders_by_day", params, deps);
  const bySource = useRpc<BreakdownRow[]>("fn_breakdown", { p_dim: "source", ...params, p_limit: 10 }, deps);
  const customers = useRpc<{ total_customers: number; repeat_customers: number; avg_orders_per_customer: number; avg_spend_per_customer: number }>(
    "fn_customer_insights", params, deps
  );

  if (kpis.loading) return <Spinner />;
  const k = kpis.data;
  const c = customers.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label={t("grossRevenue")} value={formatMoney(k?.gross_revenue ?? 0, lang)} />
        <KpiCard label={t("netRevenue")} value={formatMoney(k?.net_revenue ?? 0, lang)} accent="green" />
        <KpiCard label={t("avgOrderValue")} value={formatMoney(k?.avg_order_value ?? 0, lang)} accent="slate" />
        <KpiCard
          label={t("repeatCustomers")}
          value={c ? formatNumber(c.repeat_customers) : "—"}
          sub={c ? formatPercent(c.repeat_customers, c.total_customers) : undefined}
          accent="amber"
        />
      </div>
      <ChartCard title={t("revenuePerDay")}>
        <TrendChart
          data={(byDay.data ?? []) as unknown as Record<string, unknown>[]}
          xKey="day"
          series={[{ key: "revenue", name: t("revenue"), color: "#1b6ef5" }]}
        />
      </ChartCard>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title={t("ordersPerDay")}>
          <TrendChart
            data={(byDay.data ?? []) as unknown as Record<string, unknown>[]}
            xKey="day"
            type="line"
            series={[{ key: "orders", name: t("totalOrders") }]}
          />
        </ChartCard>
        <ChartCard title={t("ordersBySource")}>
          <DonutChart data={(bySource.data ?? []) as unknown as Record<string, unknown>[]} nameKey="label" valueKey="orders" />
        </ChartCard>
      </div>
    </div>
  );
}

function DeliveryTab({ range }: RangeProp) {
  const { t } = useLang();
  const params = rangeParams(range);
  const deps = [range.from, range.to];
  const kpis = useRpc<Kpis>("fn_kpis", params, deps);
  const buckets = useRpc<{ bucket: string; bucket_order: number; orders: number }[]>("fn_delivery_buckets", params, deps);
  const byDeliveryStatus = useRpc<BreakdownRow[]>("fn_breakdown", { p_dim: "delivery_status", ...params, p_limit: 12 }, deps);

  if (kpis.loading) return <Spinner />;
  const k = kpis.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label={t("delivered")} value={formatNumber(k?.delivered_orders ?? 0)} accent="green" />
        <KpiCard
          label={t("deliveryRate")}
          value={k ? formatPercent(k.delivered_orders, k.total_orders) : "—"}
          accent="green"
        />
        <KpiCard
          label={t("avgDeliveryDays")}
          value={k?.avg_delivery_days != null ? `${formatNumber(k.avg_delivery_days)} ${t("days")}` : "—"}
        />
        <KpiCard
          label={t("driverRating")}
          value={k?.avg_driver_rating != null ? `${formatNumber(k.avg_driver_rating)} / 5` : "—"}
          accent="amber"
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title={t("deliverySpeed")}>
          <BarsChart
            data={(buckets.data ?? []) as unknown as Record<string, unknown>[]}
            xKey="bucket"
            series={[{ key: "orders", name: t("totalOrders"), color: "#10b981" }]}
          />
        </ChartCard>
        <ChartCard title={t("deliveryStatusBreakdown")}>
          <BarsChart
            data={(byDeliveryStatus.data ?? []) as unknown as Record<string, unknown>[]}
            xKey="label"
            layout="vertical"
            series={[{ key: "orders", name: t("totalOrders") }]}
            height={340}
          />
        </ChartCard>
      </div>
    </div>
  );
}

function PaymentsTab({ range }: RangeProp) {
  const { t, lang } = useLang();
  const params = rangeParams(range);
  const deps = [range.from, range.to];
  const kpis = useRpc<Kpis>("fn_kpis", params, deps);
  const byPayment = useRpc<BreakdownRow[]>("fn_breakdown", { p_dim: "payment_method", ...params, p_limit: 10 }, deps);

  if (kpis.loading) return <Spinner />;
  const k = kpis.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          label={t("codOrders")}
          value={formatNumber(k?.cod_orders ?? 0)}
          sub={k ? formatPercent(k.cod_orders, k.total_orders) : undefined}
          accent="amber"
        />
        <KpiCard label={t("codAmount")} value={formatMoney(k?.cod_amount ?? 0, lang)} accent="amber" />
        <KpiCard label={t("onlinePaid")} value={formatMoney(k?.online_paid_amount ?? 0, lang)} />
        <KpiCard label={t("grossRevenue")} value={formatMoney(k?.gross_revenue ?? 0, lang)} accent="green" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title={t("ordersByPayment")}>
          <DonutChart data={(byPayment.data ?? []) as unknown as Record<string, unknown>[]} nameKey="label" valueKey="orders" />
        </ChartCard>
        <ChartCard title={`${t("revenue")} — ${t("ordersByPayment")}`}>
          <BarsChart
            data={(byPayment.data ?? []) as unknown as Record<string, unknown>[]}
            xKey="label"
            layout="vertical"
            series={[{ key: "revenue", name: t("revenue"), color: "#fcaf17" }]}
          />
        </ChartCard>
      </div>
      <BreakdownTable rows={byPayment.data ?? []} />
    </div>
  );
}

function GeographyTab({ range }: RangeProp) {
  const { t } = useLang();
  const params = rangeParams(range);
  const deps = [range.from, range.to];
  const byCity = useRpc<BreakdownRow[]>("fn_breakdown", { p_dim: "city", ...params, p_limit: 30 }, deps);
  const byArea = useRpc<BreakdownRow[]>("fn_breakdown", { p_dim: "area", ...params, p_limit: 20 }, deps);

  if (byCity.loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <ChartCard title={t("ordersByCity")}>
        <BarsChart
          data={(byCity.data ?? []).slice(0, 15) as unknown as Record<string, unknown>[]}
          xKey="label"
          series={[
            { key: "orders", name: t("totalOrders") },
            { key: "delivered", name: t("delivered"), color: "#10b981" },
          ]}
          height={340}
        />
      </ChartCard>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title={`${t("ordersByCity")} — ${t("revenue")}`}>
          <BarsChart
            data={(byCity.data ?? []).slice(0, 10) as unknown as Record<string, unknown>[]}
            xKey="label"
            layout="vertical"
            series={[{ key: "revenue", name: t("revenue"), color: "#fcaf17" }]}
            height={340}
          />
        </ChartCard>
        <ChartCard title={`${t("area")} (Top 20)`}>
          <div className="overflow-x-auto max-h-[340px] overflow-y-auto">
            <BreakdownTable rows={byArea.data ?? []} compact />
          </div>
        </ChartCard>
      </div>
      <BreakdownTable rows={byCity.data ?? []} />
    </div>
  );
}

function ProductsTab({ range }: RangeProp) {
  const { t, lang } = useLang();
  const params = rangeParams(range);
  const deps = [range.from, range.to];
  const top = useRpc<{ product_name: string; sku: string; quantity: number; revenue: number }[]>(
    "fn_top_products", { ...params, p_limit: 30 }, deps
  );

  if (top.loading) return <Spinner />;
  const rows = top.data ?? [];

  return (
    <div className="space-y-6">
      <ChartCard title={`${t("topProducts")} (15)`}>
        <BarsChart
          data={rows.slice(0, 15).map((r) => ({
            ...r,
            short: r.product_name.length > 28 ? r.product_name.slice(0, 28) + "…" : r.product_name,
          })) as unknown as Record<string, unknown>[]}
          xKey="short"
          layout="vertical"
          series={[{ key: "quantity", name: t("quantity") }]}
          height={480}
        />
      </ChartCard>
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>#</th>
              <th>{t("products")}</th>
              <th>SKU</th>
              <th>{t("quantity")}</th>
              <th>{t("revenue")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="text-slate-400">{i + 1}</td>
                <td className="!whitespace-normal max-w-md">{r.product_name}</td>
                <td dir="ltr" className="text-slate-500 text-xs">{r.sku}</td>
                <td className="font-semibold">{formatNumber(r.quantity)}</td>
                <td>{formatMoney(r.revenue, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReturnsTab({ range }: RangeProp) {
  const { t } = useLang();
  const params = rangeParams(range);
  const deps = [range.from, range.to];
  const kpis = useRpc<Kpis>("fn_kpis", params, deps);
  const reasons = useRpc<BreakdownRow[]>("fn_breakdown", { p_dim: "cancellation_reason", ...params, p_limit: 15 }, deps);

  if (kpis.loading) return <Spinner />;
  const k = kpis.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          label={t("cancelled")}
          value={formatNumber(k?.cancelled_orders ?? 0)}
          sub={k ? formatPercent(k.cancelled_orders, k.total_orders) : undefined}
          accent="red"
        />
        <KpiCard
          label={t("returned")}
          value={formatNumber(k?.returned_orders ?? 0)}
          sub={k ? formatPercent(k.returned_orders, k.total_orders) : undefined}
          accent="amber"
        />
        <KpiCard label={t("inProgress")} value={formatNumber(k?.in_progress_orders ?? 0)} accent="slate" />
        <KpiCard label={t("totalOrders")} value={formatNumber(k?.total_orders ?? 0)} />
      </div>
      <ChartCard title={t("cancellationReasons")}>
        <BarsChart
          data={((reasons.data ?? []).filter((r) => r.label !== "(none)")) as unknown as Record<string, unknown>[]}
          xKey="label"
          layout="vertical"
          series={[{ key: "orders", name: t("totalOrders"), color: "#ef4444" }]}
          height={380}
        />
      </ChartCard>
    </div>
  );
}

function TeamTab({ range }: RangeProp) {
  const { t } = useLang();
  const params = rangeParams(range);
  const deps = [range.from, range.to];
  const team = useRpc<{ admin_name: string; actions: number; orders_touched: number; last_action: string }[]>(
    "fn_team_activity", { ...params, p_limit: 40 }, deps
  );

  if (team.loading) return <Spinner />;
  const rows = team.data ?? [];

  return (
    <div className="space-y-6">
      <ChartCard title={t("teamActivity")}>
        <BarsChart
          data={rows.slice(0, 15) as unknown as Record<string, unknown>[]}
          xKey="admin_name"
          layout="vertical"
          series={[
            { key: "actions", name: t("action") },
            { key: "orders_touched", name: t("orders"), color: "#fcaf17" },
          ]}
          height={420}
        />
      </ChartCard>
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>{t("user")}</th>
              <th>{t("action")}</th>
              <th>{t("orders")}</th>
              <th>{t("date")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="font-semibold">{r.admin_name}</td>
                <td>{formatNumber(r.actions)}</td>
                <td>{formatNumber(r.orders_touched)}</td>
                <td className="text-slate-500 text-xs">{formatDateTime(r.last_action)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BreakdownTable({ rows, compact }: { rows: BreakdownRow[]; compact?: boolean }) {
  const { t, lang } = useLang();
  return (
    <div className={cn("overflow-x-auto", !compact && "card")}>
      <table className="table-base">
        <thead>
          <tr>
            <th>{t("details")}</th>
            <th>{t("orders")}</th>
            <th>{t("revenue")}</th>
            <th>{t("delivered")}</th>
            <th>{t("returned")} / {t("cancelled")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="font-semibold">{r.label}</td>
              <td>{formatNumber(r.orders)}</td>
              <td>{formatMoney(r.revenue, lang)}</td>
              <td className="text-emerald-700">{formatNumber(r.delivered)}</td>
              <td className="text-red-600">{formatNumber(r.cancelled_or_returned)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
