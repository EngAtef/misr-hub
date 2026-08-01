"use client";

import { useMemo, useState } from "react";
import { Download, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { rangeParams, useRpc } from "@/lib/use-analytics";
import { PageHeader, KpiCard, ChartCard, Spinner, EmptyState, SortTh, useSort, DeltaBadge } from "@/components/ui";
import { TrendChart, BarsChart, DonutChart } from "@/components/charts";
import { toCsv, downloadCsv, formatNumber, formatMoney, formatPercent, formatDate, formatDateTime, cn, STATUS_AR } from "@/lib/utils";
import type { Kpis, BreakdownRow, DayRow } from "@/lib/types";

/* ---------- row types for the new report RPCs ---------- */

interface Extras {
  total_units: number;
  distinct_products: number;
  product_orders: number;
  shipping_fees: number;
  promo_discount: number;
  loyalty_discount: number;
  new_customers: number;
  rated_orders: number;
}
interface CustomerInsights {
  total_customers: number;
  repeat_customers: number;
  avg_orders_per_customer: number;
  avg_spend_per_customer: number;
}
interface RatingRow { kind: string; rating: number; orders: number }
interface SalesDayRow { day: string; orders: number; items_amount: number; delivery_fees: number; promo_discount: number; grand_total: number }
interface FulfillRow { order_number: string; customer_name: string | null; city: string | null; order_date: string; delivery_date: string; hours: number }
interface PromoRow { id: number; name: string; type: number; amount: number; active: boolean; expiration_date: string | null; uses_in_range: number; orders_value: number; discount_given: number; delivered_orders: number }
interface NewCustomerRow { customer_id: string; name: string | null; email: string | null; phone: string | null; city: string | null; joined_at: string; is_active: boolean; lifetime_orders: number; lifetime_amount: number }
interface OosRow { sku: string; product_name: string | null; ecom_stock: number; sap_stock: number; units: number; revenue: number }
interface CatRow { key: string; lines: number; units: number; revenue: number; discounted_revenue: number; discount_amount: number }
interface TopUnitRow { sku: string; product_name: string | null; category: string | null; units: number; orders: number; revenue: number }
interface BucketRow { bucket: string; bucket_order: number; orders: number }
interface AbTrendRow { day: string; lost_value: number; avg_cart_value: number; carts: number; platform_lost: number }
interface AbSummary { total_carts: number; total_value: number; avg_cart_value: number; recovered_carts: number; recovered_value: number }
interface TimePatterns { by_hour: { hour: number; orders: number; revenue: number }[]; by_dow: { dow: number; orders: number; revenue: number }[] }

/* ---------- custom report builder definitions (kept from v1) ---------- */

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

/* ---------- small local helpers ---------- */

const SECTIONS: { id: string; labelKey: DictKey }[] = [
  { id: "rh-kpis", labelKey: "rhKpis" },
  { id: "rh-status", labelKey: "rhStatusSection" },
  { id: "rh-timeline", labelKey: "rhTimeline" },
  { id: "rh-categories", labelKey: "rhCategories" },
  { id: "rh-top-products", labelKey: "rhTopProducts" },
  { id: "rh-daily", labelKey: "rhDailySales" },
  { id: "rh-fulfillment", labelKey: "rhFulfillment" },
  { id: "rh-geo", labelKey: "rhGeo" },
  { id: "rh-payments", labelKey: "rhPayments" },
  { id: "rh-sources", labelKey: "rhSources" },
  { id: "rh-ratings", labelKey: "rhRatings" },
  { id: "rh-promos", labelKey: "rhPromos" },
  { id: "rh-new-customers", labelKey: "rhNewCustomers" },
  { id: "rh-cancellations", labelKey: "reportCancellations" },
  { id: "rh-abandoned", labelKey: "rhAbandoned" },
  { id: "rh-oos", labelKey: "rhOos" },
  { id: "rh-timing", labelKey: "rhTimePatterns" },
  { id: "rh-builder", labelKey: "rhBuilder" },
];

const DOW_LABELS: Record<"ar" | "en", string[]> = {
  // isodow 1 = Monday
  ar: ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

function hoursFmt(h: number | null | undefined): string {
  if (h === null || h === undefined) return "—";
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return `${whole}h ${mins}m`;
}

function Section({ id, title, action, children }: { id: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-800">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function CsvButton({ rows, name }: { rows: Record<string, unknown>[] | null | undefined; name: string }) {
  const { t } = useLang();
  if (!rows?.length) return null;
  return (
    <button
      className="btn-secondary text-xs"
      onClick={() => downloadCsv(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows))}
    >
      <Download size={14} />
      {t("exportCsv")}
    </button>
  );
}

export default function ReportsPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const { preset, setPreset, range, setRange, comparePreset, setComparePreset, customCompare, setCustomCompare, compare } = useDateRange("30d");

  const deps = [range.from, range.to];
  const rp = rangeParams(range);
  const cmpRp = compare ? rangeParams(compare) : { p_from: null, p_to: null };

  /* ---------- data ---------- */
  const kpis = useRpc<Kpis>("fn_kpis", rp, deps);
  const kpisPrev = useRpc<Kpis>("fn_kpis", cmpRp, [compare?.from, compare?.to], !compare);
  const extras = useRpc<Extras>("fn_report_extras", rp, deps);
  const extrasPrev = useRpc<Extras>("fn_report_extras", cmpRp, [compare?.from, compare?.to], !compare);
  const cust = useRpc<CustomerInsights>("fn_customer_insights", rp, deps);
  const byStatus = useRpc<BreakdownRow[]>("fn_breakdown", { ...rp, p_dim: "order_status", p_limit: 20 }, deps);
  const byPayment = useRpc<BreakdownRow[]>("fn_breakdown", { ...rp, p_dim: "payment_method", p_limit: 20 }, deps);
  const bySource = useRpc<BreakdownRow[]>("fn_breakdown", { ...rp, p_dim: "source", p_limit: 20 }, deps);
  const byCity = useRpc<BreakdownRow[]>("fn_breakdown", { ...rp, p_dim: "city", p_limit: 30 }, deps);
  const byCancel = useRpc<BreakdownRow[]>("fn_breakdown", { ...rp, p_dim: "cancellation_reason", p_limit: 30 }, deps);
  const days = useRpc<DayRow[]>("fn_orders_by_day", rp, deps);
  const catRows = useRpc<CatRow[]>("fn_product_sales_breakdown", { ...rp, p_by: "category" }, deps);
  const subcatRows = useRpc<CatRow[]>("fn_product_sales_breakdown", { ...rp, p_by: "sub_category" }, deps);
  const topUnits = useRpc<TopUnitRow[]>("fn_top_products_units", { ...rp, p_limit: 50 }, deps);
  const salesByDay = useRpc<SalesDayRow[]>("fn_sales_by_day", rp, deps);
  const buckets = useRpc<BucketRow[]>("fn_delivery_buckets", rp, deps);
  const fulfillment = useRpc<FulfillRow[]>("fn_fulfillment_orders", { ...rp, p_limit: 300 }, deps);
  const ratings = useRpc<RatingRow[]>("fn_rating_breakdown", rp, deps);
  const promos = useRpc<PromoRow[]>("fn_promo_performance", { ...rp, p_limit: 100 }, deps);
  const newCust = useRpc<NewCustomerRow[]>("fn_new_customers", { ...rp, p_limit: 200 }, deps);
  const oos = useRpc<OosRow[]>("fn_out_of_stock_sellers", { ...rp, p_limit: 100 }, deps);
  const patterns = useRpc<TimePatterns>("fn_orders_time_patterns", rp, deps);
  const abSummary = useRpc<AbSummary>("fn_abandoned_summary", { p_from: range.from, p_to: range.to }, deps);
  const abTrend = useRpc<AbTrendRow[]>("fn_abandoned_trend", { p_days: 3650, p_from: range.from, p_to: range.to }, deps);

  const k = kpis.data;
  const kp = kpisPrev.data;
  const ex = extras.data;
  const exp = extrasPrev.data;

  /* ---------- derived chart data ---------- */
  const statusLabel = (label: string) => (lang === "ar" ? STATUS_AR[label] ?? label : label);
  const statusDonut = useMemo(
    () => (byStatus.data ?? []).filter((r) => r.orders > 0).map((r) => ({ ...r, label: statusLabel(r.label) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byStatus.data, lang]
  );
  const catDonut = useMemo(() => (catRows.data ?? []).filter((r) => r.key !== "—" && r.units > 0), [catRows.data]);
  const subcatUnits = useMemo(
    () => [...(subcatRows.data ?? [])].filter((r) => r.key !== "—").sort((a, b) => b.units - a.units).slice(0, 10),
    [subcatRows.data]
  );
  const subcatSales = useMemo(
    () => [...(subcatRows.data ?? [])].filter((r) => r.key !== "—").sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    [subcatRows.data]
  );
  const customerStars = useMemo(
    () => (ratings.data ?? []).filter((r) => r.kind === "customer").map((r) => ({ label: `${r.rating} ★`, orders: r.orders })),
    [ratings.data]
  );
  const driverStars = useMemo(
    () => (ratings.data ?? []).filter((r) => r.kind === "driver").map((r) => ({ label: `${r.rating} ★`, orders: r.orders })),
    [ratings.data]
  );
  const hourData = useMemo(
    () => (patterns.data?.by_hour ?? []).map((r) => ({ ...r, label: `${String(r.hour).padStart(2, "0")}:00` })),
    [patterns.data]
  );
  const dowData = useMemo(
    () => (patterns.data?.by_dow ?? []).map((r) => ({ ...r, label: DOW_LABELS[lang][r.dow - 1] ?? String(r.dow) })),
    [patterns.data, lang]
  );
  const cancelRows = useMemo(
    () => (byCancel.data ?? []).filter((r) => r.label !== "(none)"),
    [byCancel.data]
  );
  const cancelTotal = cancelRows.reduce((s, r) => s + r.orders, 0);
  const cityTotal = (byCity.data ?? []).reduce((s, r) => s + r.orders, 0);

  const abandonedRate =
    abSummary.data && k && abSummary.data.total_carts + k.total_orders > 0
      ? (abSummary.data.total_carts / (abSummary.data.total_carts + k.total_orders)) * 100
      : null;

  /* ---------- custom report builder state (kept from v1) ---------- */
  const [selected, setSelected] = useState<ReportDef>(REPORTS[0]);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [cmpRows, setCmpRows] = useState<Record<string, unknown>[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    const { data } = await supabase.rpc(selected.rpc, { ...rangeParams(range), ...(selected.params ?? {}) });
    setRows((data as Record<string, unknown>[]) ?? []);
    if (compare) {
      const { data: d2 } = await supabase.rpc(selected.rpc, { ...rangeParams(compare), ...(selected.params ?? {}) });
      setCmpRows((d2 as Record<string, unknown>[]) ?? []);
    } else {
      setCmpRows(null);
    }
    setLoading(false);
  }

  const cmpMap = useMemo(() => {
    if (!compare || !cmpRows?.length) return null;
    const keyCol = Object.keys(cmpRows[0])[0];
    return { keyCol, map: new Map(cmpRows.map((r) => [String(r[keyCol]), r])) };
  }, [compare, cmpRows]);

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
    const accessors = Object.fromEntries(Object.keys(rows[0]).map((c) => [c, (r: Record<string, unknown>) => r[c]]));
    return apply(rows, accessors);
  }, [rows, apply]);

  const money = (v: number | null | undefined) => formatMoney(v, lang);
  const showingTop = (n: number) => t("rhShowingTop").replace("{n}", String(n));

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("reports")}
        actions={
          <button className="btn-secondary" onClick={exportAllOrders}>
            <Download size={16} />
            {t("exportAllOrders")}
          </button>
        }
      />

      <div className="card p-4 space-y-4">
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
        {/* jump to a specific report, like the reference dashboard */}
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-500">{t("rhJump")}</div>
          <div className="flex flex-wrap gap-1.5">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" })}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-brand-500 hover:text-brand-700"
              >
                {t(s.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ================= KPI cards ================= */}
      <Section id="rh-kpis" title={t("rhKpis")}>
        {kpis.loading || extras.loading ? (
          <Spinner />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <KpiCard label={t("totalOrders")} value={formatNumber(k?.total_orders)} delta={compare && kp ? <DeltaBadge current={k?.total_orders ?? 0} previous={kp.total_orders} fmtPrev={formatNumber} /> : undefined} />
            <KpiCard label={t("grossRevenue")} value={money(k?.gross_revenue)} delta={compare && kp ? <DeltaBadge current={k?.gross_revenue ?? 0} previous={kp.gross_revenue} fmtPrev={(n) => money(n)} /> : undefined} />
            <KpiCard label={t("netRevenue")} value={money(k?.net_revenue)} accent="green" delta={compare && kp ? <DeltaBadge current={k?.net_revenue ?? 0} previous={kp.net_revenue} fmtPrev={(n) => money(n)} /> : undefined} />
            <KpiCard label={t("avgOrderValue")} value={money(k?.avg_order_value)} delta={compare && kp ? <DeltaBadge current={k?.avg_order_value ?? 0} previous={kp.avg_order_value} fmtPrev={(n) => money(n)} /> : undefined} />
            <KpiCard label={t("uniqueCustomers")} value={formatNumber(k?.unique_customers)} delta={compare && kp ? <DeltaBadge current={k?.unique_customers ?? 0} previous={kp.unique_customers} fmtPrev={formatNumber} /> : undefined} />
            <KpiCard label={t("rhNewCustomers")} value={formatNumber(ex?.new_customers)} delta={compare && exp ? <DeltaBadge current={ex?.new_customers ?? 0} previous={exp.new_customers} fmtPrev={formatNumber} /> : undefined} />
            <KpiCard label={t("rhOrdersPerCustomer")} value={k && k.unique_customers > 0 ? formatNumber(k.total_orders / k.unique_customers) : "—"} sub={`${t("repeatCustomers")}: ${formatNumber(cust.data?.repeat_customers)}`} />
            <KpiCard label={t("rhTotalUnits")} value={formatNumber(ex?.total_units)} delta={compare && exp ? <DeltaBadge current={ex?.total_units ?? 0} previous={exp.total_units} fmtPrev={formatNumber} /> : undefined} />
            <KpiCard label={t("rhAvgUnits")} value={ex && ex.product_orders > 0 ? formatNumber(ex.total_units / ex.product_orders) : "—"} />
            <KpiCard label={t("rhDistinctProducts")} value={formatNumber(ex?.distinct_products)} />
            <KpiCard label={t("rhShippingFees")} value={money(ex?.shipping_fees)} delta={compare && exp ? <DeltaBadge current={ex?.shipping_fees ?? 0} previous={exp.shipping_fees} fmtPrev={(n) => money(n)} /> : undefined} />
            <KpiCard label={t("rhPromoDiscount")} value={money(ex?.promo_discount)} accent="amber" />
            <KpiCard label={t("deliveryRate")} value={k && k.total_orders > 0 ? formatPercent(k.delivered_orders, k.total_orders) : "—"} sub={`${t("delivered")}: ${formatNumber(k?.delivered_orders)}`} accent="green" />
            <KpiCard label={t("avgDeliveryDays")} value={formatNumber(k?.avg_delivery_days)} sub={k?.avg_delivery_days ? hoursFmt(k.avg_delivery_days * 24) : undefined} />
            <KpiCard label={t("codAmount")} value={money(k?.cod_amount)} sub={`${t("codOrders")}: ${formatNumber(k?.cod_orders)}`} />
            <KpiCard label={t("onlinePaid")} value={money(k?.online_paid_amount)} />
            <KpiCard label={t("rhAbandoned")} value={formatNumber(abSummary.data?.total_carts)} sub={`${t("rhAbandonedValue")}: ${money(abSummary.data?.total_value)}`} accent="red" />
            <KpiCard label={t("rhAbandonedRate")} value={abandonedRate !== null ? `${formatNumber(abandonedRate)}%` : "—"} sub={`${t("rhRecovered")}: ${formatNumber(abSummary.data?.recovered_carts)}`} accent="red" />
          </div>
        )}
      </Section>

      {/* ================= order status ================= */}
      <Section id="rh-status" title={t("rhStatusSection")}>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title={t("ordersByStatus")}>
            <DonutChart data={statusDonut as unknown as Record<string, unknown>[]} nameKey="label" valueKey="orders" />
          </ChartCard>
          <ChartCard title={t("rhSalesByStatus")}>
            <DonutChart data={statusDonut as unknown as Record<string, unknown>[]} nameKey="label" valueKey="revenue" />
          </ChartCard>
        </div>
      </Section>

      {/* ================= timeline ================= */}
      <Section id="rh-timeline" title={t("rhTimeline")}>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title={t("rhOrdersTimeline")}>
            <TrendChart
              data={(days.data ?? []) as unknown as Record<string, unknown>[]}
              xKey="day"
              series={[
                { key: "orders", name: t("orders"), color: "#1b6ef5" },
                { key: "delivered", name: t("delivered"), color: "#10b981" },
              ]}
            />
          </ChartCard>
          <ChartCard title={t("rhSalesTimeline")}>
            <TrendChart
              data={(days.data ?? []) as unknown as Record<string, unknown>[]}
              xKey="day"
              series={[{ key: "revenue", name: t("revenue"), color: "#8b5cf6" }]}
            />
          </ChartCard>
        </div>
      </Section>

      {/* ================= categories ================= */}
      <Section id="rh-categories" title={t("rhCategories")}>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title={t("rhCatUnits")}>
            <DonutChart data={catDonut as unknown as Record<string, unknown>[]} nameKey="key" valueKey="units" />
          </ChartCard>
          <ChartCard title={t("rhCatSales")}>
            <DonutChart data={catDonut as unknown as Record<string, unknown>[]} nameKey="key" valueKey="revenue" />
          </ChartCard>
          <ChartCard title={t("rhSubcatUnits")}>
            <DonutChart data={subcatUnits as unknown as Record<string, unknown>[]} nameKey="key" valueKey="units" />
          </ChartCard>
          <ChartCard title={t("rhSubcatSales")}>
            <DonutChart data={subcatSales as unknown as Record<string, unknown>[]} nameKey="key" valueKey="revenue" />
          </ChartCard>
        </div>
      </Section>

      {/* ================= top products ================= */}
      <Section id="rh-top-products" title={t("rhTopProducts")} action={<CsvButton rows={topUnits.data as unknown as Record<string, unknown>[]} name="top-products" />}>
        <div className="grid gap-6 xl:grid-cols-2">
          <ChartCard title={`${t("rhTopProducts")} — ${t("units")}`}>
            <BarsChart
              data={(topUnits.data ?? []).slice(0, 15).map((r) => ({ ...r, short: (r.product_name ?? r.sku).slice(0, 28) })) as unknown as Record<string, unknown>[]}
              xKey="short"
              layout="vertical"
              series={[{ key: "units", name: t("units") }]}
              height={480}
            />
          </ChartCard>
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("products")}</th>
                  <th>{t("sku")}</th>
                  <th>{t("rhCategories")}</th>
                  <th>{t("units")}</th>
                  <th>{t("orders")}</th>
                  <th>{t("revenue")}</th>
                </tr>
              </thead>
              <tbody>
                {(topUnits.data ?? []).slice(0, 15).map((r, i) => (
                  <tr key={r.sku}>
                    <td className="text-slate-400">{i + 1}</td>
                    <td className="max-w-[260px] truncate" title={r.product_name ?? ""}>{r.product_name ?? "—"}</td>
                    <td dir="ltr">{r.sku}</td>
                    <td>{r.category ?? "—"}</td>
                    <td className="font-medium">{formatNumber(r.units)}</td>
                    <td>{formatNumber(r.orders)}</td>
                    <td className="font-medium">{money(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(topUnits.data?.length ?? 0) > 15 && <div className="p-3 text-xs text-slate-400">{showingTop(15)}</div>}
          </div>
        </div>
      </Section>

      {/* ================= daily sales ledger ================= */}
      <Section id="rh-daily" title={t("rhDailySales")} action={<CsvButton rows={salesByDay.data as unknown as Record<string, unknown>[]} name="daily-sales" />}>
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t("date")}</th>
                <th>{t("orders")}</th>
                <th>{t("rhItemsAmount")}</th>
                <th>{t("rhDeliveryFees")}</th>
                <th>{t("rhPromoDiscount")}</th>
                <th>{t("rhGrandTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {(salesByDay.data ?? []).slice(0, 15).map((r) => (
                <tr key={r.day}>
                  <td>{formatDate(r.day)}</td>
                  <td className="font-medium">{formatNumber(r.orders)}</td>
                  <td>{money(r.items_amount)}</td>
                  <td>{money(r.delivery_fees)}</td>
                  <td>{r.promo_discount > 0 ? money(r.promo_discount) : "—"}</td>
                  <td className="font-semibold">{money(r.grand_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(salesByDay.data?.length ?? 0) > 15 && <div className="p-3 text-xs text-slate-400">{showingTop(15)}</div>}
        </div>
      </Section>

      {/* ================= fulfillment ================= */}
      <Section id="rh-fulfillment" title={t("rhFulfillment")} action={<CsvButton rows={fulfillment.data as unknown as Record<string, unknown>[]} name="fulfillment-times" />}>
        <div className="grid gap-6 xl:grid-cols-2">
          <ChartCard title={t("rhFulfillmentBuckets")}>
            <BarsChart
              data={[...(buckets.data ?? [])].sort((a, b) => a.bucket_order - b.bucket_order) as unknown as Record<string, unknown>[]}
              xKey="bucket"
              series={[{ key: "orders", name: t("orders") }]}
            />
          </ChartCard>
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t("orders")} #</th>
                  <th>{t("customers")}</th>
                  <th>{t("city")}</th>
                  <th>{t("rhPlacedAt")}</th>
                  <th>{t("rhDeliveredAt")}</th>
                  <th>{t("rhFulfillHours")}</th>
                </tr>
              </thead>
              <tbody>
                {(fulfillment.data ?? []).slice(0, 12).map((r) => (
                  <tr key={r.order_number}>
                    <td dir="ltr">{r.order_number}</td>
                    <td className="max-w-[160px] truncate">{r.customer_name ?? "—"}</td>
                    <td>{r.city ?? "—"}</td>
                    <td className="whitespace-nowrap">{formatDateTime(r.order_date)}</td>
                    <td className="whitespace-nowrap">{formatDateTime(r.delivery_date)}</td>
                    <td className="font-medium" dir="ltr">{hoursFmt(r.hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(fulfillment.data?.length ?? 0) > 12 && <div className="p-3 text-xs text-slate-400">{showingTop(12)}</div>}
          </div>
        </div>
      </Section>

      {/* ================= geography ================= */}
      <Section id="rh-geo" title={t("rhGeo")} action={<CsvButton rows={byCity.data as unknown as Record<string, unknown>[]} name="orders-by-city" />}>
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t("city")}</th>
                <th>{t("orders")}</th>
                <th>{t("revenue")}</th>
                <th>{t("delivered")}</th>
                <th>{t("rhShare")}</th>
              </tr>
            </thead>
            <tbody>
              {(byCity.data ?? []).map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="font-medium">{formatNumber(r.orders)}</td>
                  <td>{money(r.revenue)}</td>
                  <td>{formatNumber(r.delivered)}</td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                        <span className="block h-full rounded-full bg-brand-500" style={{ width: cityTotal ? `${Math.max(2, (r.orders / cityTotal) * 100)}%` : 0 }} />
                      </span>
                      {formatPercent(r.orders, cityTotal)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ================= payments ================= */}
      <Section id="rh-payments" title={t("rhPayments")}>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title={t("rhPaymentsOrders")}>
            <DonutChart data={(byPayment.data ?? []) as unknown as Record<string, unknown>[]} nameKey="label" valueKey="orders" />
          </ChartCard>
          <ChartCard title={t("rhPaymentsSales")}>
            <DonutChart data={(byPayment.data ?? []) as unknown as Record<string, unknown>[]} nameKey="label" valueKey="revenue" />
          </ChartCard>
        </div>
      </Section>

      {/* ================= sources ================= */}
      <Section id="rh-sources" title={t("rhSources")}>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title={t("rhSourcesOrders")}>
            <DonutChart data={(bySource.data ?? []) as unknown as Record<string, unknown>[]} nameKey="label" valueKey="orders" />
          </ChartCard>
          <ChartCard title={t("rhSourcesSales")}>
            <DonutChart data={(bySource.data ?? []) as unknown as Record<string, unknown>[]} nameKey="label" valueKey="revenue" />
          </ChartCard>
        </div>
      </Section>

      {/* ================= ratings ================= */}
      <Section id="rh-ratings" title={t("rhRatings")}>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title={`${t("rhCustomerRate")} (${t("rhRatedOrders")}: ${formatNumber(ex?.rated_orders)})`}>
            <DonutChart data={customerStars as unknown as Record<string, unknown>[]} nameKey="label" valueKey="orders" />
          </ChartCard>
          <ChartCard title={t("rhDriverRate")}>
            <DonutChart data={driverStars as unknown as Record<string, unknown>[]} nameKey="label" valueKey="orders" />
          </ChartCard>
        </div>
      </Section>

      {/* ================= promo codes ================= */}
      <Section id="rh-promos" title={t("rhPromos")} action={<CsvButton rows={promos.data as unknown as Record<string, unknown>[]} name="promo-codes" />}>
        {promos.data && promos.data.length === 0 ? (
          <EmptyState message={t("noResults")} />
        ) : (
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t("promoCode")}</th>
                  <th>{t("rhUses")}</th>
                  <th>{t("rhOrdersValue")}</th>
                  <th>{t("rhDiscountGiven")}</th>
                  <th>{t("delivered")}</th>
                  <th>{t("active")}</th>
                  <th>{t("rhExpires")}</th>
                </tr>
              </thead>
              <tbody>
                {(promos.data ?? []).map((r) => (
                  <tr key={r.id}>
                    <td dir="ltr" className="font-medium">{r.name}</td>
                    <td>{formatNumber(r.uses_in_range)}</td>
                    <td>{money(r.orders_value)}</td>
                    <td>{money(r.discount_given)}</td>
                    <td>{formatNumber(r.delivered_orders)}</td>
                    <td>{r.active ? t("active") : t("inactive")}</td>
                    <td>{r.expiration_date ? formatDate(r.expiration_date) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ================= new customers ================= */}
      <Section id="rh-new-customers" title={t("rhNewCustomers")} action={<CsvButton rows={newCust.data as unknown as Record<string, unknown>[]} name="new-customers" />}>
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t("fullName")}</th>
                <th>{t("email")}</th>
                <th>{t("phone")}</th>
                <th>{t("city")}</th>
                <th>{t("rhJoined")}</th>
                <th>{t("rhLifetimeOrders")}</th>
                <th>{t("rhLifetimeSpend")}</th>
              </tr>
            </thead>
            <tbody>
              {(newCust.data ?? []).slice(0, 15).map((r) => (
                <tr key={r.customer_id}>
                  <td className="max-w-[180px] truncate">{r.name ?? "—"}</td>
                  <td dir="ltr" className="max-w-[220px] truncate">{r.email ?? "—"}</td>
                  <td dir="ltr">{r.phone ?? "—"}</td>
                  <td>{r.city ?? "—"}</td>
                  <td className="whitespace-nowrap">{formatDate(r.joined_at)}</td>
                  <td>{formatNumber(r.lifetime_orders)}</td>
                  <td>{money(r.lifetime_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(newCust.data?.length ?? 0) > 15 && <div className="p-3 text-xs text-slate-400">{showingTop(15)}</div>}
        </div>
      </Section>

      {/* ================= cancellations ================= */}
      <Section id="rh-cancellations" title={t("reportCancellations")} action={<CsvButton rows={cancelRows as unknown as Record<string, unknown>[]} name="cancellation-reasons" />}>
        {cancelRows.length === 0 && !byCancel.loading ? (
          <EmptyState message={t("noResults")} />
        ) : (
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t("reportCancellations")}</th>
                  <th>{t("orders")}</th>
                  <th>{t("revenue")}</th>
                  <th>{t("rhShare")}</th>
                </tr>
              </thead>
              <tbody>
                {cancelRows.map((r) => (
                  <tr key={r.label}>
                    <td className="max-w-[380px]">{r.label}</td>
                    <td className="font-medium">{formatNumber(r.orders)}</td>
                    <td>{money(r.revenue)}</td>
                    <td>{formatPercent(r.orders, cancelTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ================= abandoned carts ================= */}
      <Section id="rh-abandoned" title={t("rhAbandoned")}>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title={t("rhLostRevenue")}>
            <TrendChart
              data={(abTrend.data ?? []) as unknown as Record<string, unknown>[]}
              xKey="day"
              series={[{ key: "lost_value", name: t("rhAbandonedValue"), color: "#ef4444" }]}
            />
          </ChartCard>
          <ChartCard title={t("rhAvgCartTrend")}>
            <TrendChart
              data={(abTrend.data ?? []) as unknown as Record<string, unknown>[]}
              xKey="day"
              type="line"
              series={[
                { key: "avg_cart_value", name: t("rhAvgCartTrend"), color: "#2b3990" },
                { key: "carts", name: t("rhAbandoned"), color: "#fcaf17" },
              ]}
            />
          </ChartCard>
        </div>
      </Section>

      {/* ================= out of stock sellers ================= */}
      <Section id="rh-oos" title={t("rhOos")} action={<CsvButton rows={oos.data as unknown as Record<string, unknown>[]} name="out-of-stock-sellers" />}>
        {oos.data && oos.data.length === 0 ? (
          <EmptyState message={t("noResults")} />
        ) : (
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t("sku")}</th>
                  <th>{t("products")}</th>
                  <th>{t("units")}</th>
                  <th>{t("revenue")}</th>
                  <th>{t("ecomStock")}</th>
                  <th>{t("sapStock")}</th>
                </tr>
              </thead>
              <tbody>
                {(oos.data ?? []).slice(0, 15).map((r) => (
                  <tr key={r.sku}>
                    <td dir="ltr">{r.sku}</td>
                    <td className="max-w-[280px] truncate" title={r.product_name ?? ""}>{r.product_name ?? "—"}</td>
                    <td className="font-medium">{formatNumber(r.units)}</td>
                    <td>{money(r.revenue)}</td>
                    <td className="text-red-600 font-medium">{formatNumber(r.ecom_stock)}</td>
                    <td>{formatNumber(r.sap_stock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(oos.data?.length ?? 0) > 15 && <div className="p-3 text-xs text-slate-400">{showingTop(15)}</div>}
          </div>
        )}
      </Section>

      {/* ================= order timing ================= */}
      <Section id="rh-timing" title={t("rhTimePatterns")}>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title={t("rhByHour")}>
            <BarsChart data={hourData as unknown as Record<string, unknown>[]} xKey="label" series={[{ key: "orders", name: t("orders") }]} />
          </ChartCard>
          <ChartCard title={t("rhByDow")}>
            <BarsChart data={dowData as unknown as Record<string, unknown>[]} xKey="label" series={[{ key: "orders", name: t("orders"), color: "#10b981" }]} />
          </ChartCard>
        </div>
      </Section>

      {/* ================= custom report builder (v1, kept) ================= */}
      <Section id="rh-builder" title={t("rhBuilder")}>
        <div className="card p-4 space-y-4">
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
              <button
                className="btn-secondary"
                onClick={() => downloadCsv(`report-${selected.key}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows))}
              >
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
                {sortedRows.map((r, i) => {
                  const cmpRow = cmpMap ? cmpMap.map.get(String(r[cmpMap.keyCol])) : undefined;
                  return (
                    <tr key={i}>
                      {columns.map((c) => {
                        const v = r[c];
                        const prev = cmpRow && c !== cmpMap!.keyCol ? cmpRow[c] : undefined;
                        return (
                          <td key={c} className={typeof v === "number" ? "font-medium" : ""}>
                            {typeof v === "number" ? (
                              <span className="inline-flex items-center gap-1.5">
                                {formatNumber(v)}
                                {cmpRow && typeof prev === "number" && <DeltaBadge current={v} previous={prev} fmtPrev={formatNumber} />}
                              </span>
                            ) : v === null || v === "" ? (
                              "—"
                            ) : (
                              String(v)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
