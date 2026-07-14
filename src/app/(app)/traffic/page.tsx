"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { UploadCloud, TrendingDown, TrendingUp, Radar, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner, KpiCard, ChartCard, StatusBadge, SortTh, useSort, DeltaBadge } from "@/components/ui";
import { BarsChart } from "@/components/charts";
import { normalizeTxId, GA4_ALL_TIME } from "@/lib/import/parse-ga4";
import { formatNumber, formatMoney, toCsv, downloadCsv, cn, STATUS_AR } from "@/lib/utils";

interface MonthRow {
  period_month: string;
  pages: number;
  views: number;
  users: number;
  add_to_carts: number;
}

interface Summary {
  views: number;
  users: number;
  add_to_carts: number;
  app_revenue: number;
  avg_bounce: number | null;
  orders: number;
  order_revenue: number;
  atc_rate: number;
  atc_to_order: number;
}

interface PageRow {
  page_path: string;
  views: number;
  active_users: number;
  add_to_carts: number;
  bounce_rate: number | null;
}

interface OrderSlim {
  order_number: string;
  order_date: string;
  order_status: string | null;
  payment_method: string | null;
  source: string | null;
  city: string | null;
  total_order_amount: number | null;
}

interface ItemGap {
  item_name: string;
  ga4_purchased: number;
  actual_units: number;
  gap: number;
}

function monthLabel(iso: string, lang: "ar" | "en") {
  if (iso === GA4_ALL_TIME) return lang === "ar" ? "كل الفترة (إجمالي)" : "All time (historical)";
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export default function TrafficPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [compareMonth, setCompareMonth] = useState<string>("");
  const [prevSummary, setPrevSummary] = useState<Summary | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(true);
  // reconciliation state (transaction-id based, independent of months)
  const [txMap, setTxMap] = useState<Map<string, number> | null>(null);
  const [monthOrders, setMonthOrders] = useState<OrderSlim[]>([]);
  const [itemGaps, setItemGaps] = useState<ItemGap[]>([]);

  useEffect(() => {
    supabase.rpc("fn_ga4_months").then(({ data }) => {
      const list = (data as MonthRow[]) ?? [];
      setMonths(list);
      if (list.length) setSelected(list[0].period_month);
      setLoading(false);
    });
    // load ALL GA4 transaction ids once — merged from all-time + monthly uploads
    (async () => {
      const map = new Map<string, number>();
      for (let offset = 0; offset < 200000; offset += 1000) {
        const { data } = await supabase
          .from("ga4_transactions")
          .select("transaction_id, revenue")
          .range(offset, offset + 999);
        const chunk = (data as { transaction_id: string; revenue: number | null }[]) ?? [];
        for (const r of chunk) map.set(normalizeTxId(r.transaction_id), r.revenue ?? 0);
        if (chunk.length < 1000) break;
      }
      setTxMap(map);
    })();
  }, [supabase]);

  const loadMonth = useCallback(
    async (month: string) => {
      const isAllTime = month === GA4_ALL_TIME;
      const monthEnd = isAllTime
        ? null
        : new Date(new Date(month).getFullYear(), new Date(month).getMonth() + 1, 1).toISOString().slice(0, 10);
      const [s, p] = await Promise.all([
        supabase.rpc("fn_ga4_summary", { p_month: month }),
        supabase
          .from("ga4_pages")
          .select("page_path, views, active_users, add_to_carts, bounce_rate")
          .eq("period_month", month)
          .order("views", { ascending: false })
          .limit(25),
      ]);
      setSummary(s.data as Summary);
      setPages((p.data as PageRow[]) ?? []);

      // orders for reconciliation: all-time bucket compares ALL orders
      const all: OrderSlim[] = [];
      for (let offset = 0; offset < 200000; offset += 1000) {
        let q = supabase
          .from("orders")
          .select("order_number, order_date, order_status, payment_method, source, city, total_order_amount")
          .range(offset, offset + 999);
        if (!isAllTime) q = q.gte("order_date", `${month}T00:00:00Z`).lt("order_date", `${monthEnd}T00:00:00Z`);
        const { data } = await q;
        const chunk = (data as OrderSlim[]) ?? [];
        all.push(...chunk);
        if (chunk.length < 1000) break;
      }
      setMonthOrders(all);

      // item gaps: this bucket's GA4 items vs actual sales in the same window
      const { data: items } = await supabase
        .from("ga4_items")
        .select("item_name, items_purchased")
        .eq("period_month", month)
        .limit(8000);
      const { data: actual } = await supabase.rpc("fn_top_products", {
        p_from: isAllTime ? null : `${month}T00:00:00Z`,
        p_to: isAllTime ? null : `${monthEnd}T00:00:00Z`,
        p_limit: 8000,
      });
      const actualMap = new Map<string, number>();
      for (const a of (actual as { product_name: string; quantity: number }[]) ?? []) {
        actualMap.set(a.product_name.trim(), Number(a.quantity));
      }
      const gaps: ItemGap[] = [];
      const seen = new Set<string>();
      for (const it of (items as { item_name: string; items_purchased: number | null }[]) ?? []) {
        const name = it.item_name.trim();
        seen.add(name);
        const actualUnits = actualMap.get(name) ?? 0;
        const ga4Units = Number(it.items_purchased ?? 0);
        if (actualUnits >= 10 || ga4Units >= 10) {
          gaps.push({ item_name: name, ga4_purchased: ga4Units, actual_units: actualUnits, gap: actualUnits - ga4Units });
        }
      }
      for (const [name, units] of actualMap) {
        if (!seen.has(name) && units >= 10) gaps.push({ item_name: name, ga4_purchased: 0, actual_units: units, gap: units });
      }
      gaps.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
      setItemGaps(gaps.slice(0, 25));
    },
    [supabase]
  );

  useEffect(() => {
    if (selected) loadMonth(selected);
  }, [selected, loadMonth]);

  // GA4 summary of the comparison month
  useEffect(() => {
    if (!compareMonth || compareMonth === selected) {
      setPrevSummary(null);
      return;
    }
    let cancelled = false;
    supabase.rpc("fn_ga4_summary", { p_month: compareMonth }).then(({ data }) => {
      if (!cancelled) setPrevSummary((data as Summary) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, compareMonth, selected]);

  // transaction-id reconciliation: an order is tracked if its number exists
  // in ANY uploaded GA4 transactions file (all-time or monthly — merged)
  const tracking = useMemo(() => {
    if (!txMap || !monthOrders.length) return null;
    const untracked = monthOrders.filter((o) => !txMap.has(normalizeTxId(o.order_number)));
    const tracked = monthOrders.length - untracked.length;
    const byPayment = new Map<string, { untracked: number; total: number }>();
    for (const o of monthOrders) {
      const k = o.payment_method ?? "unknown";
      const e = byPayment.get(k) ?? { untracked: 0, total: 0 };
      e.total++;
      if (!txMap.has(normalizeTxId(o.order_number))) e.untracked++;
      byPayment.set(k, e);
    }
    return {
      orders: monthOrders.length,
      tracked,
      untracked,
      untrackedRevenue: untracked.reduce((s, o) => s + (o.total_order_amount ?? 0), 0),
      byPayment: Array.from(byPayment.entries())
        .map(([payment_method, v]) => ({ payment_method, ...v }))
        .sort((a, b) => b.untracked - a.untracked),
    };
  }, [txMap, monthOrders]);

  const { sort: sortPay, toggle: togglePay, apply: applyPay } = useSort<{ payment_method: string; untracked: number; total: number }>();
  const sortedByPayment = useMemo(
    () =>
      applyPay(tracking?.byPayment ?? [], {
        method: (p) => p.payment_method,
        untracked: (p) => p.untracked,
        total: (p) => p.total,
        pct: (p) => (p.total > 0 ? p.untracked / p.total : 0),
      }),
    [tracking, applyPay]
  );

  const { sort: sortUn, toggle: toggleUn, apply: applyUn } = useSort<OrderSlim>();
  const sortedUntracked = useMemo(
    () =>
      applyUn(tracking?.untracked ?? [], {
        order: (o) => o.order_number,
        method: (o) => o.payment_method,
        amount: (o) => o.total_order_amount,
        status: (o) => o.order_status,
      }),
    [tracking, applyUn]
  );

  const { sort: sortGap, toggle: toggleGap, apply: applyGap } = useSort<ItemGap>();
  const sortedGaps = useMemo(
    () =>
      applyGap(itemGaps, {
        name: (g) => g.item_name,
        ga4: (g) => g.ga4_purchased,
        actual: (g) => g.actual_units,
        gap: (g) => g.gap,
      }),
    [itemGaps, applyGap]
  );

  const { sort: sortPg, toggle: togglePg, apply: applyPg } = useSort<PageRow>();
  const sortedPages = useMemo(
    () =>
      applyPg(pages, {
        path: (p) => p.page_path,
        views: (p) => p.views,
        users: (p) => p.active_users,
        atc: (p) => p.add_to_carts ?? 0,
        atcRate: (p) => (p.views > 0 ? (p.add_to_carts ?? 0) / p.views : 0),
        bounce: (p) => p.bounce_rate ?? 0,
      }),
    [pages, applyPg]
  );

  if (loading) return <div><PageHeader title={t("traffic")} /><Spinner /></div>;

  if (!months.length) {
    return (
      <div>
        <PageHeader title={t("traffic")} subtitle={t("trafficSubtitle")} />
        <div className="card p-12 text-center space-y-4">
          <UploadCloud className="mx-auto h-12 w-12 text-slate-300" />
          <p className="text-slate-500">{t("noTraffic")}</p>
          <Link href="/data-center" className="btn-primary inline-flex">{t("dataCenter")}</Link>
        </div>
      </div>
    );
  }

  const s = summary;
  const ps = compareMonth && compareMonth !== selected ? prevSummary : null;
  const overallCr = s && s.users > 0 ? s.orders / s.users : 0;

  return (
    <div>
      <PageHeader
        title={t("traffic")}
        subtitle={t("trafficSubtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select className="input !w-auto" value={selected ?? ""} onChange={(e) => setSelected(e.target.value)}>
              {months.map((m) => (
                <option key={m.period_month} value={m.period_month}>
                  {monthLabel(m.period_month, lang)}
                </option>
              ))}
            </select>
            {months.length > 1 && (
              <select
                className={cn("input !w-auto", compareMonth && "!border-violet-400 !text-violet-700")}
                value={compareMonth}
                onChange={(e) => setCompareMonth(e.target.value)}
              >
                <option value="">{t("noCompare")}</option>
                {months
                  .filter((m) => m.period_month !== selected)
                  .map((m) => (
                    <option key={m.period_month} value={m.period_month}>
                      {t("vsLbl")} {monthLabel(m.period_month, lang)}
                    </option>
                  ))}
              </select>
            )}
          </div>
        }
      />

      {s && (
        <div className="space-y-6">
          {ps && compareMonth && (
            <div className="flex items-center gap-2 rounded-lg bg-violet-50 border border-violet-100 px-4 py-2 text-xs font-semibold text-violet-700">
              {t("vsLbl")} {monthLabel(compareMonth, lang)}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard
              label={t("views")}
              value={formatNumber(s.views)}
              delta={ps && <DeltaBadge current={s.views} previous={ps.views} fmtPrev={formatNumber} />}
            />
            <KpiCard
              label={t("activeUsers")}
              value={formatNumber(s.users)}
              accent="slate"
              delta={ps && <DeltaBadge current={s.users} previous={ps.users} fmtPrev={formatNumber} />}
            />
            <KpiCard
              label={t("addToCarts")}
              value={formatNumber(s.add_to_carts)}
              accent="amber"
              delta={ps && <DeltaBadge current={s.add_to_carts} previous={ps.add_to_carts} fmtPrev={formatNumber} />}
            />
            <KpiCard
              label={t("totalOrders")}
              value={formatNumber(s.orders)}
              accent="green"
              delta={ps && <DeltaBadge current={s.orders} previous={ps.orders} fmtPrev={formatNumber} />}
            />
            <KpiCard
              label={t("grossRevenue")}
              value={formatMoney(s.order_revenue, lang)}
              accent="green"
              delta={ps && <DeltaBadge current={s.order_revenue} previous={ps.order_revenue} fmtPrev={(n) => formatMoney(n, lang)} />}
            />
            <KpiCard
              label={t("bounceRate")}
              value={s.avg_bounce != null ? `${(s.avg_bounce * 100).toFixed(1)}%` : "—"}
              accent="red"
              delta={
                ps?.avg_bounce != null && s.avg_bounce != null ? (
                  <DeltaBadge current={s.avg_bounce * 100} previous={ps.avg_bounce * 100} invert />
                ) : undefined
              }
            />
          </div>

          <div className="card p-5">
            <h3 className="mb-4 text-sm font-bold text-slate-700">{t("trafficGap")}</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <FunnelStep
                label={`${t("views")} → ${t("addToCarts")}`}
                value={s.views > 0 ? s.add_to_carts / s.views : 0}
                prev={ps ? (ps.views > 0 ? ps.add_to_carts / ps.views : 0) : null}
                benchmark={0.05}
                lang={lang}
              />
              <FunnelStep
                label={`${t("addToCarts")} → ${t("orders")}`}
                value={s.add_to_carts > 0 ? s.orders / s.add_to_carts : 0}
                prev={ps ? (ps.add_to_carts > 0 ? ps.orders / ps.add_to_carts : 0) : null}
                benchmark={0.25}
                lang={lang}
              />
              <FunnelStep
                label={`${t("activeUsers")} → ${t("orders")} (CR)`}
                value={overallCr}
                prev={ps ? (ps.users > 0 ? ps.orders / ps.users : 0) : null}
                benchmark={0.015}
                lang={lang}
              />
            </div>
          </div>

          {/* GA4 vs actual orders reconciliation — matched by transaction id */}
          <div className="card p-5">
            <div className="mb-1 flex items-center gap-2">
              <Radar size={18} className="text-brand-600" />
              <h3 className="text-sm font-bold text-slate-700">{t("tracking")}</h3>
            </div>
            <p className="mb-4 text-xs text-slate-500">{t("trackingHint")}</p>
            {!txMap ? (
              <Spinner />
            ) : txMap.size === 0 ? (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                {t("noTrackingData")}
              </div>
            ) : !tracking ? (
              <Spinner />
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <KpiCard
                    label={t("trackingRate")}
                    value={`${((tracking.tracked / Math.max(tracking.orders, 1)) * 100).toFixed(1)}%`}
                    sub={`${formatNumber(tracking.tracked)} / ${formatNumber(tracking.orders)}`}
                    accent={tracking.untracked.length / Math.max(tracking.orders, 1) > 0.05 ? "red" : "green"}
                  />
                  <KpiCard label={t("untrackedOrders")} value={formatNumber(tracking.untracked.length)} accent="red" />
                  <KpiCard label={t("untrackedRevenue")} value={formatMoney(tracking.untrackedRevenue, lang)} accent="amber" />
                  <KpiCard label="GA4 IDs" value={formatNumber(txMap.size)} accent="slate" />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <h4 className="mb-2 text-xs font-bold uppercase text-slate-500">{t("untrackedByPayment")}</h4>
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="table-base">
                        <thead>
                          <tr>
                            <SortTh label={t("paymentMethod")} k="method" sort={sortPay} onToggle={togglePay} />
                            <SortTh label={t("untrackedOrders")} k="untracked" sort={sortPay} onToggle={togglePay} />
                            <SortTh label={t("of")} k="total" sort={sortPay} onToggle={togglePay} />
                            <SortTh label="%" k="pct" sort={sortPay} onToggle={togglePay} />
                          </tr>
                        </thead>
                        <tbody>
                          {sortedByPayment.map((p) => {
                            const pct = p.total > 0 ? (p.untracked / p.total) * 100 : 0;
                            return (
                              <tr key={p.payment_method}>
                                <td className="font-medium">{lang === "ar" ? (STATUS_AR[p.payment_method] ?? p.payment_method) : p.payment_method}</td>
                                <td>{formatNumber(p.untracked)}</td>
                                <td className="text-slate-500">{formatNumber(p.total)}</td>
                                <td className={cn("font-bold", pct > 50 ? "text-red-600" : pct > 10 ? "text-amber-600" : "text-emerald-600")}>
                                  {pct.toFixed(1)}%
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase text-slate-500">{t("untrackedOrders")}</h4>
                      <button
                        className="btn-secondary !py-1 !px-2.5 text-xs"
                        onClick={() =>
                          downloadCsv(
                            `untracked-orders-${selected?.slice(0, 7)}.csv`,
                            toCsv(tracking.untracked as unknown as Record<string, unknown>[])
                          )
                        }
                      >
                        <Download size={13} />
                        {t("exportUntracked")}
                      </button>
                    </div>
                    <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                      <table className="table-base">
                        <thead>
                          <tr>
                            <SortTh label={t("orderNumber")} k="order" sort={sortUn} onToggle={toggleUn} />
                            <SortTh label={t("paymentMethod")} k="method" sort={sortUn} onToggle={toggleUn} />
                            <SortTh label={t("amount")} k="amount" sort={sortUn} onToggle={toggleUn} />
                            <SortTh label={t("status")} k="status" sort={sortUn} onToggle={toggleUn} />
                          </tr>
                        </thead>
                        <tbody>
                          {sortedUntracked.slice(0, 50).map((o) => (
                            <tr key={o.order_number}>
                              <td className="font-bold text-brand-700" dir="ltr">#{o.order_number}</td>
                              <td className="text-xs">{lang === "ar" ? (STATUS_AR[o.payment_method ?? ""] ?? o.payment_method) : o.payment_method}</td>
                              <td>{formatMoney(o.total_order_amount, lang)}</td>
                              <td><StatusBadge status={o.order_status} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {itemGaps.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-xs font-bold uppercase text-slate-500">{t("itemTrackingGaps")}</h4>
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="table-base">
                        <thead>
                          <tr>
                            <SortTh label={t("products")} k="name" sort={sortGap} onToggle={toggleGap} />
                            <SortTh label={t("ga4Purchased")} k="ga4" sort={sortGap} onToggle={toggleGap} />
                            <SortTh label={t("actualSold")} k="actual" sort={sortGap} onToggle={toggleGap} />
                            <SortTh label={t("gap")} k="gap" sort={sortGap} onToggle={toggleGap} />
                          </tr>
                        </thead>
                        <tbody>
                          {sortedGaps.map((g, i) => (
                            <tr key={i}>
                              <td className="!whitespace-normal max-w-md font-medium">{g.item_name}</td>
                              <td>{formatNumber(g.ga4_purchased)}</td>
                              <td className="font-semibold">{formatNumber(g.actual_units)}</td>
                              <td className={cn("font-bold", Math.abs(g.gap) > 20 ? "text-red-600" : "text-slate-600")}>
                                {g.gap > 0 ? "+" : ""}{formatNumber(g.gap)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <FunnelBreakdown month={selected} />

          {months.length > 1 && (
            <ChartCard title={t("monthComparison")}>
              <BarsChart
                data={[...months].reverse().map((m) => ({
                  month: monthLabel(m.period_month, lang),
                  views: m.views,
                  add_to_carts: m.add_to_carts,
                })) as unknown as Record<string, unknown>[]}
                xKey="month"
                series={[
                  { key: "views", name: t("views") },
                  { key: "add_to_carts", name: t("addToCarts"), color: "#fcaf17" },
                ]}
              />
            </ChartCard>
          )}

          <div>
            <h2 className="mb-3 text-lg font-bold">{t("topPages")}</h2>
            <div className="card overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <SortTh label={t("pagePath")} k="path" sort={sortPg} onToggle={togglePg} />
                    <SortTh label={t("views")} k="views" sort={sortPg} onToggle={togglePg} />
                    <SortTh label={t("activeUsers")} k="users" sort={sortPg} onToggle={togglePg} />
                    <SortTh label={t("addToCarts")} k="atc" sort={sortPg} onToggle={togglePg} />
                    <SortTh label={t("atcRate")} k="atcRate" sort={sortPg} onToggle={togglePg} />
                    <SortTh label={t("bounceRate")} k="bounce" sort={sortPg} onToggle={togglePg} />
                  </tr>
                </thead>
                <tbody>
                  {sortedPages.map((p) => {
                    const atcRate = p.views > 0 ? (p.add_to_carts ?? 0) / p.views : 0;
                    const bounce = p.bounce_rate ?? 0;
                    return (
                      <tr key={p.page_path}>
                        <td dir="ltr" className="font-mono text-xs max-w-md truncate">{p.page_path}</td>
                        <td className="font-semibold">{formatNumber(p.views)}</td>
                        <td>{formatNumber(p.active_users)}</td>
                        <td>{formatNumber(p.add_to_carts ?? 0)}</td>
                        <td className={cn(atcRate >= 0.08 ? "text-emerald-600 font-semibold" : atcRate < 0.02 ? "text-red-600" : "")}>
                          {(atcRate * 100).toFixed(1)}%
                        </td>
                        <td className={cn(bounce > 0.4 ? "text-red-600 font-semibold" : "text-slate-600")}>
                          {(bounce * 100).toFixed(0)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface FunnelRow { dimension: string; label: string; orders: number; delivered: number; cancelled: number; delivered_rate: number; aov: number; }

function FunnelTable({ title, data }: { title: string; data: FunnelRow[] }) {
  const { t, lang } = useLang();
  const { sort, toggle, apply } = useSort<FunnelRow>();
  const sortedData = useMemo(
    () =>
      apply(data, {
        label: (r) => r.label,
        orders: (r) => r.orders,
        delivered: (r) => r.delivered,
        rate: (r) => r.delivered_rate,
        aov: (r) => r.aov,
      }),
    [data, apply]
  );
  return (
    <div>
      <h4 className="mb-2 text-xs font-bold uppercase text-slate-500">{title}</h4>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="table-base">
          <thead>
            <tr>
              <SortTh label={title} k="label" sort={sort} onToggle={toggle} />
              <SortTh label={t("orders")} k="orders" sort={sort} onToggle={toggle} />
              <SortTh label={t("delivered")} k="delivered" sort={sort} onToggle={toggle} />
              <SortTh label={t("deliveryRate")} k="rate" sort={sort} onToggle={toggle} />
              <SortTh label={t("avgOrderValue")} k="aov" sort={sort} onToggle={toggle} />
            </tr>
          </thead>
          <tbody>
            {sortedData.map((r) => (
              <tr key={r.label}>
                <td className="font-medium">{lang === "ar" ? (STATUS_AR[r.label] ?? r.label) : r.label}</td>
                <td className="font-semibold">{formatNumber(r.orders)}</td>
                <td>{formatNumber(r.delivered)}</td>
                <td className={cn("font-bold", r.delivered_rate < 40 ? "text-red-600" : r.delivered_rate < 70 ? "text-amber-600" : "text-emerald-600")}>{r.delivered_rate}%</td>
                <td>{formatMoney(r.aov, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FunnelBreakdown({ month }: { month: string | null }) {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<FunnelRow[]>([]);

  useEffect(() => {
    if (!month) return;
    const isAll = month === GA4_ALL_TIME;
    const monthEnd = isAll ? null : new Date(new Date(month).getFullYear(), new Date(month).getMonth() + 1, 1).toISOString().slice(0, 10);
    supabase
      .rpc("fn_funnel_breakdown", { p_from: isAll ? null : `${month}T00:00:00Z`, p_to: isAll ? null : `${monthEnd}T00:00:00Z` })
      .then(({ data }) => setRows((data as FunnelRow[]) ?? []));
  }, [supabase, month]);

  if (!rows.length) return null;
  const pay = rows.filter((r) => r.dimension === "payment_method");
  const src = rows.filter((r) => r.dimension === "source");

  return (
    <div className="card p-5">
      <h3 className="mb-1 text-sm font-bold text-slate-700">{t("funnelDrill")}</h3>
      <p className="mb-4 text-xs text-slate-500">{t("funnelDrillHint")}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <FunnelTable title={t("byPayment")} data={pay} />
        <FunnelTable title={t("bySource")} data={src} />
      </div>
    </div>
  );
}

function FunnelStep({ label, value, prev, benchmark, lang }: { label: string; value: number; prev?: number | null; benchmark: number; lang: "ar" | "en" }) {
  const good = value >= benchmark;
  const Icon = good ? TrendingUp : TrendingDown;
  return (
    <div className={cn("rounded-xl border p-4", good ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50")}>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className={cn("text-2xl font-bold", good ? "text-emerald-700" : "text-red-700")}>
          {(value * 100).toFixed(2)}%
        </span>
        <Icon size={18} className={good ? "text-emerald-600" : "text-red-600"} />
        {prev !== null && prev !== undefined && <DeltaBadge current={value * 100} previous={prev * 100} />}
      </div>
      <div className="mt-0.5 text-[11px] text-slate-500">
        {lang === "ar" ? "المعيار" : "Benchmark"}: {(benchmark * 100).toFixed(1)}%
      </div>
    </div>
  );
}
