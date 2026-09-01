"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useLang, type DictKey } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { useRpc, rangeParams } from "@/lib/use-analytics";
import { PageHeader, KpiCard, ChartCard, Spinner, EmptyState, QueryFailed, DeltaBadge } from "@/components/ui";
import { AlertsBar } from "@/components/alerts-bar";
import { TrafficKpis } from "@/components/traffic-growth";
import { DeliveryQuality } from "@/components/delivery-quality";
import { TrendChart, DonutChart, BarsChart } from "@/components/charts";
import { formatMoney, formatNumber, formatPercent, formatWeight, cn, STATUS_AR } from "@/lib/utils";
import type { Kpis, DayRow, BreakdownRow } from "@/lib/types";

/* ------------------------------------------------------------------ *
 * Unified Dashboard — a preview of Overview + Analytics + Insights +
 * Reports collapsed into one page, organised by question rather than by
 * page name. The four original pages are untouched; every section here
 * links back to the full one.
 * ------------------------------------------------------------------ */

type Tab = "pulse" | "sales" | "customers" | "ops" | "products";

interface CustomerInsights {
  total_customers: number;
  repeat_customers: number;
  avg_orders_per_customer: number;
  avg_spend_per_customer: number;
}

interface RfmRow {
  segment: string;
  customers: number;
  avg_orders: number;
  avg_spend: number;
  total_revenue: number;
  avg_recency_days: number;
}

interface AbSummary {
  total_carts: number;
  total_value: number;
  last30_carts: number;
  last30_value: number;
  reachable_carts: number;
  reachable_value: number;
  hot_carts: number;
  recovered_carts: number;
}

interface TopUnitRow {
  sku: string;
  product_name: string;
  units: number;
  revenue: number;
}

interface CatRow {
  key: string;
  lines: number;
  units: number;
  revenue: number;
}

interface OosRow {
  sku: string;
  product_name: string;
  ecom_stock: number | null;
  sap_stock: number | null;
  units: number;
  revenue: number;
}

// RFM segment keys as they come out of SQL -> the existing dictionary labels
const SEGMENT_KEYS: Record<string, DictKey> = {
  champions: "segChampions",
  loyal: "segLoyal",
  new: "segNew",
  promising: "segPromising",
  at_risk: "segAtRisk",
  hibernating: "segHibernating",
};

// every section says where it came from and offers the full page
function SectionLink({ href, labelKey }: { href: string; labelKey: DictKey }) {
  const { t } = useLang();
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 transition hover:text-brand-800 hover:underline"
    >
      {t("dashSourceNote").replace("{page}", t(labelKey))}
      <ArrowUpRight size={13} />
    </Link>
  );
}

function SectionCard({
  title,
  href,
  labelKey,
  children,
}: {
  title: string;
  href: string;
  labelKey: DictKey;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-slate-800">{title}</h3>
        <SectionLink href={href} labelKey={labelKey} />
      </div>
      {children}
    </div>
  );
}

export default function DashboardPage() {
  const { t, lang } = useLang();
  const [tab, setTab] = useState<Tab>("pulse");
  const {
    preset,
    setPreset,
    range,
    setRange,
    comparePreset,
    setComparePreset,
    customCompare,
    setCustomCompare,
    compare,
  } = useDateRange("month");
  const params = rangeParams(range);
  const deps = [range.from, range.to];
  const money = (n: number) => formatMoney(n, lang);

  const kpis = useRpc<Kpis>("fn_kpis", params, deps);
  const prevKpis = useRpc<Kpis>("fn_kpis", compare ? rangeParams(compare) : {}, [compare?.from, compare?.to], !compare);
  const pk = compare ? prevKpis.data : null;
  const k = kpis.data;

  // per-tab fetches, skipped until the tab is opened
  const byDay = useRpc<DayRow[]>("fn_orders_by_day", params, [...deps, tab], tab !== "pulse" && tab !== "sales");
  const byStatus = useRpc<BreakdownRow[]>(
    "fn_breakdown",
    { p_dim: "order_status", ...params, p_limit: 15 },
    [...deps, tab],
    tab !== "pulse" && tab !== "sales"
  );
  const byPayment = useRpc<BreakdownRow[]>(
    "fn_breakdown",
    { p_dim: "payment_method", ...params, p_limit: 10 },
    [...deps, tab],
    tab !== "sales"
  );
  const byCity = useRpc<BreakdownRow[]>(
    "fn_breakdown",
    { p_dim: "city", ...params, p_limit: 15 },
    [...deps, tab],
    tab !== "sales"
  );
  const bySource = useRpc<BreakdownRow[]>(
    "fn_breakdown",
    { p_dim: "source", ...params, p_limit: 10 },
    [...deps, tab],
    tab !== "sales"
  );

  const cust = useRpc<CustomerInsights>("fn_customer_insights", params, [...deps, tab], tab !== "pulse" && tab !== "customers");
  const rfm = useRpc<RfmRow[]>("fn_rfm_summary", {}, [tab], tab !== "customers");
  const ab = useRpc<AbSummary>(
    "fn_abandoned_summary",
    { p_from: range.from, p_to: range.to },
    [...deps, tab],
    tab !== "pulse" && tab !== "customers"
  );

  const topUnits = useRpc<TopUnitRow[]>("fn_top_products_units", { ...params, p_limit: 20 }, [...deps, tab], tab !== "products");
  const cats = useRpc<CatRow[]>("fn_product_sales_breakdown", { ...params, p_by: "category" }, [...deps, tab], tab !== "products");
  const oos = useRpc<OosRow[]>("fn_out_of_stock_sellers", { ...params, p_limit: 20 }, [...deps, tab], tab !== "products");

  const TABS: { key: Tab; labelKey: DictKey }[] = [
    { key: "pulse", labelKey: "dashTabPulse" },
    { key: "sales", labelKey: "dashTabSales" },
    { key: "customers", labelKey: "dashTabCustomers" },
    { key: "ops", labelKey: "dashTabOps" },
    { key: "products", labelKey: "dashTabProducts" },
  ];

  const statusData = useMemo(
    () =>
      (byStatus.data ?? []).map((r) => ({
        ...r,
        label: lang === "ar" ? (STATUS_AR[r.label] ?? r.label) : r.label,
      })),
    [byStatus.data, lang]
  );

  const hasData = !kpis.loading && k && k.total_orders > 0;

  return (
    <div>
      <PageHeader
        title={t("dashboard")}
        subtitle={t("dashboardSubtitle")}
        actions={
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
        }
      />

      <div className="mb-5 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 w-fit">
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

      {kpis.loading ? (
        <Spinner />
      ) : kpis.error ? (
        <QueryFailed error={kpis.error} onRetry={kpis.retry} />
      ) : !hasData ? (
        <EmptyState message={t("noData")} />
      ) : (
        <div className="space-y-6">
          {/* the headline row is on every tab — it's the shared context */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard
              label={t("totalOrders")}
              value={formatNumber(k.total_orders)}
              delta={pk && <DeltaBadge current={k.total_orders} previous={pk.total_orders} fmtPrev={formatNumber} />}
            />
            <KpiCard
              label={t("grossRevenue")}
              value={money(k.gross_revenue)}
              delta={pk && <DeltaBadge current={k.gross_revenue} previous={pk.gross_revenue} fmtPrev={money} />}
            />
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
            <KpiCard label={t("avgOrderValue")} value={money(k.avg_order_value)} accent="slate" />
            <KpiCard label={t("rhTotalWeight")} value={formatWeight(k.net_weight_kg, lang)} sub={`${t("rhAvgWeight")}: ${formatWeight(k.avg_weight_kg, lang)}`} accent="slate" />
            <KpiCard
              label={t("uniqueCustomers")}
              value={formatNumber(k.unique_customers)}
              accent="slate"
              delta={pk && <DeltaBadge current={k.unique_customers} previous={pk.unique_customers} fmtPrev={formatNumber} />}
            />
          </div>

          {/* ---------------- Pulse ---------------- */}
          {tab === "pulse" && (
            <>
              <AlertsBar />

              {/* the connection worth seeing every morning: orders placed
                  against carts abandoned in the same window */}
              {ab.data && (
                <div className="card p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-bold text-slate-800">{t("dashIntentTitle")}</h3>
                    <SectionLink href="/abandoned" labelKey="abandoned" />
                  </div>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <KpiCard label={t("totalOrders")} value={formatNumber(k.total_orders)} accent="green" />
                    <KpiCard
                      label={t("abandoned")}
                      value={formatNumber(ab.data.total_carts)}
                      accent="red"
                      sub={money(ab.data.total_value)}
                    />
                    <KpiCard
                      label={t("dashAbandonRate")}
                      value={formatPercent(ab.data.total_carts, ab.data.total_carts + k.total_orders)}
                      accent="amber"
                      sub={t("dashAbandonRateSub")}
                    />
                    <KpiCard
                      label={t("dashReachable")}
                      value={formatNumber(ab.data.reachable_carts)}
                      accent="brand"
                      sub={money(ab.data.reachable_value)}
                    />
                  </div>
                </div>
              )}

              <TrafficKpis from={range.from} to={range.to} />

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

              {cust.data && (
                <SectionCard title={t("dashTabCustomers")} href="/customers" labelKey="customers">
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <KpiCard label={t("totalCustomers")} value={formatNumber(cust.data.total_customers)} />
                    <KpiCard
                      label={t("repeatCustomers")}
                      value={formatNumber(cust.data.repeat_customers)}
                      accent="green"
                      sub={formatPercent(cust.data.repeat_customers, cust.data.total_customers)}
                    />
                    <KpiCard label={t("avgOrdersPerCustomer")} value={formatNumber(cust.data.avg_orders_per_customer)} accent="slate" />
                    <KpiCard label={t("avgSpendPerCustomer")} value={money(cust.data.avg_spend_per_customer)} accent="slate" />
                  </div>
                </SectionCard>
              )}
            </>
          )}

          {/* ---------------- Sales ---------------- */}
          {tab === "sales" && (
            <>
              <ChartCard title={t("ordersPerDay")}>
                <TrendChart
                  data={(byDay.data ?? []) as unknown as Record<string, unknown>[]}
                  xKey="day"
                  series={[
                    { key: "orders", name: t("totalOrders") },
                    { key: "revenue", name: t("revenue"), color: "#8b5cf6" },
                  ]}
                />
              </ChartCard>

              <div className="grid gap-6 lg:grid-cols-2">
                <SectionCard title={t("ordersByStatus")} href="/analytics" labelKey="analytics">
                  <DonutChart
                    data={statusData as unknown as Record<string, unknown>[]}
                    nameKey="label"
                    valueKey="orders"
                  />
                </SectionCard>
                <SectionCard title={t("ordersByPayment")} href="/analytics" labelKey="analytics">
                  <DonutChart
                    data={(byPayment.data ?? []) as unknown as Record<string, unknown>[]}
                    nameKey="label"
                    valueKey="orders"
                  />
                </SectionCard>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <SectionCard title={t("ordersByCity")} href="/orders" labelKey="orders">
                  <div className="max-h-80 overflow-y-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {(byCity.data ?? []).map((r) => (
                          <tr key={r.label} className="border-b border-slate-100 last:border-0">
                            <td className="py-1.5">
                              <Link
                                href={`/orders?city=${encodeURIComponent(r.label)}`}
                                className="font-medium text-brand-700 hover:underline"
                              >
                                {r.label}
                              </Link>
                            </td>
                            <td className="py-1.5 text-end tabular-nums font-semibold">{formatNumber(r.orders)}</td>
                            <td className="py-1.5 text-end tabular-nums text-slate-500">{money(r.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
                <SectionCard title={t("reportBySource")} href="/traffic" labelKey="traffic">
                  <BarsChart
                    data={(bySource.data ?? []) as unknown as Record<string, unknown>[]}
                    xKey="label"
                    series={[{ key: "orders", name: t("orders") }]}
                  />
                </SectionCard>
              </div>
            </>
          )}

          {/* ---------------- Customers ---------------- */}
          {tab === "customers" && (
            <>
              {cust.data && (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <KpiCard label={t("totalCustomers")} value={formatNumber(cust.data.total_customers)} />
                  <KpiCard
                    label={t("repeatCustomers")}
                    value={formatNumber(cust.data.repeat_customers)}
                    accent="green"
                    sub={formatPercent(cust.data.repeat_customers, cust.data.total_customers)}
                  />
                  <KpiCard label={t("avgOrdersPerCustomer")} value={formatNumber(cust.data.avg_orders_per_customer)} accent="slate" />
                  <KpiCard label={t("avgSpendPerCustomer")} value={money(cust.data.avg_spend_per_customer)} accent="slate" />
                </div>
              )}

              <SectionCard title={t("rfmTitle")} href="/customers" labelKey="customers">
                {rfm.loading ? (
                  <Spinner />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                          <th className="px-2 py-2 text-start">{t("segment")}</th>
                          <th className="px-2 py-2 text-end">{t("customers")}</th>
                          <th className="px-2 py-2 text-end">{t("avgOrdersPerCustomer")}</th>
                          <th className="px-2 py-2 text-end">{t("avgSpendPerCustomer")}</th>
                          <th className="px-2 py-2 text-end">{t("revenue")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(rfm.data ?? []).map((r) => (
                          <tr key={r.segment} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                            <td className="px-2 py-2 font-semibold text-slate-800">
                              {SEGMENT_KEYS[r.segment] ? t(SEGMENT_KEYS[r.segment]) : r.segment}
                            </td>
                            <td className="px-2 py-2 text-end tabular-nums">{formatNumber(r.customers)}</td>
                            <td className="px-2 py-2 text-end tabular-nums text-slate-600">{formatNumber(r.avg_orders)}</td>
                            <td className="px-2 py-2 text-end tabular-nums text-slate-600">{money(r.avg_spend)}</td>
                            <td className="px-2 py-2 text-end tabular-nums font-semibold">{money(r.total_revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>

              {ab.data && (
                <SectionCard title={t("abandoned")} href="/abandoned" labelKey="abandoned">
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <KpiCard label={t("dashAbCarts")} value={formatNumber(ab.data.total_carts)} accent="red" sub={money(ab.data.total_value)} />
                    <KpiCard label={t("dashReachable")} value={formatNumber(ab.data.reachable_carts)} sub={money(ab.data.reachable_value)} />
                    <KpiCard label={t("dashHot")} value={formatNumber(ab.data.hot_carts)} accent="amber" />
                    <KpiCard label={t("dashRecovered")} value={formatNumber(ab.data.recovered_carts)} accent="green" />
                  </div>
                </SectionCard>
              )}
            </>
          )}

          {/* ---------------- Operations ---------------- */}
          {tab === "ops" && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <SectionLink href="/delivery?tab=quality" labelKey="deliveryReports" />
              </div>
              <DeliveryQuality from={range.from} to={range.to} />
            </div>
          )}

          {/* ---------------- Products ---------------- */}
          {tab === "products" && (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                <SectionCard title={t("reportTopProducts")} href="/products" labelKey="productsPage">
                  <div className="max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {(topUnits.data ?? []).map((r) => (
                          <tr key={r.sku} className="border-b border-slate-100 last:border-0">
                            <td className="py-1.5">
                              <Link
                                href={`/products?q=${encodeURIComponent(r.sku)}`}
                                className="font-medium text-brand-700 hover:underline"
                              >
                                {r.product_name}
                              </Link>
                            </td>
                            <td className="py-1.5 text-end tabular-nums font-semibold">{formatNumber(r.units)}</td>
                            <td className="py-1.5 text-end tabular-nums text-slate-500">{money(r.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>

                <SectionCard title={t("byCategory")} href="/analytics" labelKey="analytics">
                  <DonutChart
                    data={(cats.data ?? []).filter((r) => r.key !== "—" && r.units > 0) as unknown as Record<string, unknown>[]}
                    nameKey="key"
                    valueKey="units"
                  />
                </SectionCard>
              </div>

              {/* the products/stock connection: books that sold and then ran out */}
              <SectionCard title={t("reportOosSellers")} href="/stock?filter=oos" labelKey="stock">
                {oos.loading ? (
                  <Spinner />
                ) : (oos.data ?? []).length === 0 ? (
                  <EmptyState message={t("noData")} />
                ) : (
                  <div className="max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {(oos.data ?? []).map((r) => (
                          <tr key={r.sku} className="border-b border-slate-100 last:border-0">
                            <td className="py-1.5">
                              <Link
                                href={`/products?q=${encodeURIComponent(r.sku)}`}
                                className="font-medium text-brand-700 hover:underline"
                              >
                                {r.product_name}
                              </Link>
                            </td>
                            <td className="py-1.5 text-end tabular-nums font-semibold">{formatNumber(r.units)}</td>
                            <td className="py-1.5 text-end tabular-nums text-slate-500">{money(r.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
            </>
          )}
        </div>
      )}
    </div>
  );
}
