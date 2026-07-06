"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Download, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { PageHeader, KpiCard, ChartCard, Spinner, EmptyState, StatusBadge } from "@/components/ui";
import { TrendChart } from "@/components/charts";
import { formatMoney, formatNumber, formatDateTime, toCsv, downloadCsv, cn, STATUS_AR } from "@/lib/utils";

interface Row {
  order_number: string;
  order_date: string | null;
  delivery_date: string | null;
  order_status: string | null;
  city: string | null;
  payment_method: string | null;
  source: string | null;
  total_order_amount: number | null;
  actual_delivery_fees: number | null;
  original_delivery_fees: number | null;
  applied_promotion: string | null;
  cancellation_reason: string | null;
  cancellation_note: string | null;
}

type Tab = "free" | "sameday" | "cancel";

export default function DeliveryPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const { preset, setPreset, range, setRange } = useDateRange("30d");
  const [tab, setTab] = useState<Tab>("free");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const all: Row[] = [];
    const pageSize = 1000;
    for (let offset = 0; offset < 60000; offset += pageSize) {
      let q = supabase
        .from("orders")
        .select(
          "order_number, order_date, delivery_date, order_status, city, payment_method, source, total_order_amount, actual_delivery_fees, original_delivery_fees, applied_promotion, cancellation_reason, cancellation_note"
        )
        .order("order_date", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (range.from) q = q.gte("order_date", `${range.from}T00:00:00Z`);
      if (range.to) q = q.lte("order_date", `${range.to}T23:59:59Z`);
      const { data } = await q;
      const chunk = (data as Row[]) ?? [];
      all.push(...chunk);
      if (chunk.length < pageSize) break;
    }
    setRows(all);
    setLoading(false);
  }, [supabase, range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  const TABS: { key: Tab; labelKey: DictKey }[] = [
    { key: "free", labelKey: "freeDeliveryTab" },
    { key: "sameday", labelKey: "sameDayTab" },
    { key: "cancel", labelKey: "cancellationsTab" },
  ];

  return (
    <div>
      <PageHeader
        title={t("deliveryReports")}
        subtitle={t("deliverySubtitle")}
        actions={<DateRangeFilter preset={preset} setPreset={setPreset} range={range} setRange={setRange} />}
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

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message={t("noData")} />
      ) : tab === "free" ? (
        <FreeDeliveryTab rows={rows} lang={lang} />
      ) : tab === "sameday" ? (
        <SameDayTab rows={rows} lang={lang} />
      ) : (
        <CancellationsTab rows={rows} lang={lang} />
      )}
    </div>
  );
}

const isFree = (r: Row) => (r.actual_delivery_fees ?? 0) === 0 && (r.original_delivery_fees ?? 0) > 0;
const isPaidDelivery = (r: Row) => (r.actual_delivery_fees ?? 0) > 0;
const notCancelled = (r: Row) => r.order_status !== "Cancelled";

function dayKey(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function FreeDeliveryTab({ rows, lang }: { rows: Row[]; lang: "ar" | "en" }) {
  const { t } = useLang();
  const [threshold, setThreshold] = useState(500);

  const d = useMemo(() => {
    const valid = rows.filter(notCancelled);
    const free = valid.filter(isFree);
    const paid = valid.filter(isPaidDelivery);
    const cost = free.reduce((s, r) => s + (r.original_delivery_fees ?? 0), 0);
    const freeRevenue = free.reduce((s, r) => s + (r.total_order_amount ?? 0), 0);
    const aovFree = free.length ? freeRevenue / free.length : 0;
    const aovPaid = paid.length ? paid.reduce((s, r) => s + (r.total_order_amount ?? 0), 0) / paid.length : 0;

    const byCity = new Map<string, { orders: number; cost: number; revenue: number }>();
    const byDay = new Map<string, { cost: number; orders: number }>();
    for (const r of free) {
      const c = r.city ?? "—";
      const e = byCity.get(c) ?? { orders: 0, cost: 0, revenue: 0 };
      e.orders++;
      e.cost += r.original_delivery_fees ?? 0;
      e.revenue += r.total_order_amount ?? 0;
      byCity.set(c, e);
      const k = dayKey(r.order_date);
      const dd = byDay.get(k) ?? { cost: 0, orders: 0 };
      dd.cost += r.original_delivery_fees ?? 0;
      dd.orders++;
      byDay.set(k, dd);
    }
    return { valid, free, paid, cost, freeRevenue, aovFree, aovPaid, byCity, byDay };
  }, [rows]);

  const sim = useMemo(() => {
    const losers = d.free.filter((r) => (r.total_order_amount ?? 0) < threshold);
    return {
      count: losers.length,
      saved: losers.reduce((s, r) => s + (r.original_delivery_fees ?? 0), 0),
      revenue: losers.reduce((s, r) => s + (r.total_order_amount ?? 0), 0),
    };
  }, [d.free, threshold]);

  const trend = Array.from(d.byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, v]) => ({ day, cost: Math.round(v.cost), orders: v.orders }));

  const cityRows = Array.from(d.byCity.entries())
    .map(([city, v]) => ({ city, ...v, costPct: v.revenue > 0 ? (v.cost / v.revenue) * 100 : 0 }))
    .sort((a, b) => b.cost - a.cost);

  const uplift = d.aovFree - d.aovPaid;
  const costPerOrder = d.free.length ? d.cost / d.free.length : 0;
  // rough margin assumption: extra basket value at ~30% margin vs delivery cost
  const offerGood = uplift * 0.3 >= costPerOrder;

  function exportOrders() {
    downloadCsv(
      `free-delivery-orders.csv`,
      toCsv(
        d.free.map((r) => ({
          order: r.order_number,
          date: r.order_date,
          city: r.city,
          cart: r.total_order_amount,
          delivery_cost: r.original_delivery_fees,
          promotion: r.applied_promotion,
        }))
      )
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label={t("freeDeliveryOrders")} value={formatNumber(d.free.length)} sub={`${t("freeDeliveryShare")}: ${d.valid.length ? ((d.free.length / d.valid.length) * 100).toFixed(1) : 0}%`} />
        <KpiCard label={t("absorbedCost")} value={formatMoney(d.cost, lang)} accent="red" />
        <KpiCard label={t("costPctRevenue")} value={d.freeRevenue ? `${((d.cost / d.freeRevenue) * 100).toFixed(1)}%` : "—"} accent="amber" />
        <KpiCard label={t("aovFree")} value={formatMoney(d.aovFree, lang)} accent="green" />
        <KpiCard label={t("aovPaid")} value={formatMoney(d.aovPaid, lang)} accent="slate" />
        <KpiCard label={t("costPerFreeOrder")} value={formatMoney(costPerOrder, lang)} />
      </div>

      <div
        className={cn(
          "rounded-xl border px-4 py-3 text-sm font-semibold",
          offerGood ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"
        )}
      >
        {offerGood ? t("freeVerdictGood") : t("freeVerdictBad")}
        <span className="ms-2 font-normal opacity-75" dir="ltr">
          (AOV Δ {formatMoney(uplift, lang)} × ~30% margin vs {formatMoney(costPerOrder, lang)}/order)
        </span>
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-bold text-slate-700">{t("thresholdSim")}</h3>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>{t("thresholdLabel")}</span>
          <input
            type="number"
            className="input !w-28"
            dir="ltr"
            value={threshold}
            step={50}
            min={0}
            onChange={(e) => setThreshold(Number(e.target.value) || 0)}
          />
          <span className="font-bold text-red-600">{formatNumber(sim.count)}</span>
          <span>{t("wouldLose")}</span>
          <span className="mx-1 text-slate-300">|</span>
          <span>{t("wouldSave")}:</span>
          <span className="font-bold text-emerald-700">{formatMoney(sim.saved, lang)}</span>
          <span className="mx-1 text-slate-300">|</span>
          <span>{t("atRiskRevenue")}:</span>
          <span className="font-bold text-amber-700">{formatMoney(sim.revenue, lang)}</span>
        </div>
      </div>

      <ChartCard title={t("costTrend")}>
        <TrendChart data={trend as unknown as Record<string, unknown>[]} xKey="day" series={[{ key: "cost", name: t("absorbedCost"), color: "#ef4444" }, { key: "orders", name: t("freeDeliveryOrders") }]} />
      </ChartCard>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700">{t("byCityTable")}</h3>
          <button className="btn-secondary !py-1.5 text-xs" onClick={exportOrders}>
            <Download size={14} />
            {t("exportCsv")}
          </button>
        </div>
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t("city")}</th>
                <th>{t("freeDeliveryOrders")}</th>
                <th>{t("absorbedCost")}</th>
                <th>{t("revenue")}</th>
                <th>{t("costPctRevenue")}</th>
              </tr>
            </thead>
            <tbody>
              {cityRows.map((r) => (
                <tr key={r.city}>
                  <td className="font-medium">{r.city}</td>
                  <td>{formatNumber(r.orders)}</td>
                  <td className="text-red-600 font-semibold">{formatMoney(r.cost, lang)}</td>
                  <td>{formatMoney(r.revenue, lang)}</td>
                  <td className={cn("font-bold", r.costPct > 10 ? "text-red-600" : "text-slate-700")}>{r.costPct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SameDayTab({ rows, lang }: { rows: Row[]; lang: "ar" | "en" }) {
  const { t } = useLang();

  const d = useMemo(() => {
    const delivered = rows.filter((r) => r.order_status === "Delivered" && r.order_date && r.delivery_date);
    const withHours = delivered.map((r) => ({
      ...r,
      hours: (new Date(r.delivery_date!).getTime() - new Date(r.order_date!).getTime()) / 3600000,
    })).filter((r) => r.hours >= 0 && r.hours < 24 * 60);
    const within24 = withHours.filter((r) => r.hours <= 24);
    const avgHours = withHours.length ? withHours.reduce((s, r) => s + r.hours, 0) / withHours.length : 0;

    const byCity = new Map<string, { delivered: number; fast: number; hours: number }>();
    const byDay = new Map<string, { delivered: number; fast: number }>();
    for (const r of withHours) {
      const c = r.city ?? "—";
      const e = byCity.get(c) ?? { delivered: 0, fast: 0, hours: 0 };
      e.delivered++;
      e.hours += r.hours;
      if (r.hours <= 24) e.fast++;
      byCity.set(c, e);
      const k = dayKey(r.order_date);
      const dd = byDay.get(k) ?? { delivered: 0, fast: 0 };
      dd.delivered++;
      if (r.hours <= 24) dd.fast++;
      byDay.set(k, dd);
    }
    return { withHours, within24, avgHours, byCity, byDay };
  }, [rows]);

  const trend = Array.from(d.byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, v]) => ({ day, rate: v.delivered ? Math.round((v.fast / v.delivered) * 100) : 0 }));

  const cityRows = Array.from(d.byCity.entries())
    .map(([city, v]) => ({ city, ...v, rate: v.delivered ? (v.fast / v.delivered) * 100 : 0, avg: v.delivered ? v.hours / v.delivered : 0 }))
    .sort((a, b) => b.delivered - a.delivered);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label={t("deliveredTotal")} value={formatNumber(d.withHours.length)} />
        <KpiCard label={t("deliveredWithin24")} value={formatNumber(d.within24.length)} accent="green" />
        <KpiCard label={t("within24Rate")} value={d.withHours.length ? `${((d.within24.length / d.withHours.length) * 100).toFixed(1)}%` : "—"} accent="green" />
        <KpiCard label={t("avgDeliveryHours")} value={`${formatNumber(d.avgHours)} h`} accent="slate" />
      </div>

      <ChartCard title={`${t("within24Rate")} — ${t("costTrend").split("—")[0]}`}>
        <TrendChart data={trend as unknown as Record<string, unknown>[]} xKey="day" type="line" series={[{ key: "rate", name: `${t("within24Rate")} %`, color: "#10b981" }]} />
      </ChartCard>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>{t("city")}</th>
              <th>{t("deliveredTotal")}</th>
              <th>{t("deliveredWithin24")}</th>
              <th>{t("within24Rate")}</th>
              <th>{t("avgDeliveryHours")}</th>
            </tr>
          </thead>
          <tbody>
            {cityRows.map((r) => (
              <tr key={r.city}>
                <td className="font-medium">{r.city}</td>
                <td>{formatNumber(r.delivered)}</td>
                <td>{formatNumber(r.fast)}</td>
                <td className={cn("font-bold", r.rate >= 50 ? "text-emerald-600" : r.rate >= 20 ? "text-amber-600" : "text-red-600")}>
                  {r.rate.toFixed(1)}%
                </td>
                <td>{formatNumber(r.avg)} h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CancellationsTab({ rows, lang }: { rows: Row[]; lang: "ar" | "en" }) {
  const { t } = useLang();

  const d = useMemo(() => {
    const cancelled = rows.filter((r) => r.order_status === "Cancelled");
    const lost = cancelled.reduce((s, r) => s + (r.total_order_amount ?? 0), 0);

    const reasons = new Map<string, { count: number; lost: number }>();
    const byCity = new Map<string, number>();
    const byPayment = new Map<string, number>();
    const byDay = new Map<string, number>();
    for (const r of cancelled) {
      const reason = [r.cancellation_reason, r.cancellation_note].filter(Boolean).join(" — ") || t("noReason");
      const e = reasons.get(reason) ?? { count: 0, lost: 0 };
      e.count++;
      e.lost += r.total_order_amount ?? 0;
      reasons.set(reason, e);
      byCity.set(r.city ?? "—", (byCity.get(r.city ?? "—") ?? 0) + 1);
      byPayment.set(r.payment_method ?? "—", (byPayment.get(r.payment_method ?? "—") ?? 0) + 1);
      byDay.set(dayKey(r.order_date), (byDay.get(dayKey(r.order_date)) ?? 0) + 1);
    }
    return { cancelled, lost, reasons, byCity, byPayment, byDay };
  }, [rows, t]);

  const trend = Array.from(d.byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, n]) => ({ day, cancelled: n }));

  const reasonRows = Array.from(d.reasons.entries())
    .map(([reason, v]) => ({ reason, ...v }))
    .sort((a, b) => b.count - a.count);

  function exportCancelled() {
    downloadCsv(
      "cancelled-orders.csv",
      toCsv(
        d.cancelled.map((r) => ({
          order: r.order_number,
          date: r.order_date,
          city: r.city,
          payment: r.payment_method,
          amount: r.total_order_amount,
          reason: r.cancellation_reason,
          note: r.cancellation_note,
        }))
      )
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label={t("cancelledOrdersKpi")} value={formatNumber(d.cancelled.length)} accent="red" />
        <KpiCard label={t("cancellationRate")} value={rows.length ? `${((d.cancelled.length / rows.length) * 100).toFixed(1)}%` : "—"} accent="red" />
        <KpiCard label={t("lostRevenue")} value={formatMoney(d.lost, lang)} accent="amber" />
        <KpiCard label={t("topCancelReasons")} value={formatNumber(reasonRows.filter((r) => r.reason !== t("noReason")).length)} accent="slate" />
      </div>

      <ChartCard title={t("cancellationsTab")}>
        <TrendChart data={trend as unknown as Record<string, unknown>[]} xKey="day" series={[{ key: "cancelled", name: t("cancelledOrdersKpi"), color: "#ef4444" }]} />
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700">{t("topCancelReasons")}</h3>
            <button className="btn-secondary !py-1.5 text-xs" onClick={exportCancelled}>
              <Download size={14} />
              {t("exportCsv")}
            </button>
          </div>
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t("reason")}</th>
                  <th>{t("orders")}</th>
                  <th>{t("lostRevenue")}</th>
                </tr>
              </thead>
              <tbody>
                {reasonRows.map((r) => (
                  <tr key={r.reason}>
                    <td className="!whitespace-normal max-w-sm">{r.reason}</td>
                    <td className="font-bold">{formatNumber(r.count)}</td>
                    <td>{formatMoney(r.lost, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t("byPaymentTable")}</th>
                  <th>{t("cancelledOrdersKpi")}</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(d.byPayment.entries()).sort((a, b) => b[1] - a[1]).map(([p, n]) => (
                  <tr key={p}>
                    <td>{lang === "ar" ? (STATUS_AR[p] ?? p) : p}</td>
                    <td className="font-bold">{formatNumber(n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t("byCityTable")}</th>
                  <th>{t("cancelledOrdersKpi")}</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(d.byCity.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, n]) => (
                  <tr key={c}>
                    <td>{c}</td>
                    <td className="font-bold">{formatNumber(n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold text-slate-700">{t("recentCancelled")}</h3>
        <div className="card overflow-x-auto max-h-96 overflow-y-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t("orderNumber")}</th>
                <th>{t("date")}</th>
                <th>{t("city")}</th>
                <th>{t("amount")}</th>
                <th>{t("status")}</th>
                <th>{t("reason")}</th>
              </tr>
            </thead>
            <tbody>
              {d.cancelled.slice(0, 60).map((r) => (
                <tr key={r.order_number}>
                  <td className="font-bold text-brand-700" dir="ltr">#{r.order_number}</td>
                  <td className="text-xs text-slate-500">{formatDateTime(r.order_date)}</td>
                  <td>{r.city ?? "—"}</td>
                  <td>{formatMoney(r.total_order_amount, lang)}</td>
                  <td><StatusBadge status={r.order_status} /></td>
                  <td className="!whitespace-normal max-w-xs text-xs">{[r.cancellation_reason, r.cancellation_note].filter(Boolean).join(" — ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
