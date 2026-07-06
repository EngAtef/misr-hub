"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { UploadCloud, TrendingDown, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner, KpiCard, ChartCard, EmptyState } from "@/components/ui";
import { BarsChart } from "@/components/charts";
import { formatNumber, formatMoney, formatPercent, cn } from "@/lib/utils";

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

function monthLabel(iso: string, lang: "ar" | "en") {
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { month: "long", year: "numeric" });
}

export default function TrafficPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.rpc("fn_ga4_months").then(({ data }) => {
      const list = (data as MonthRow[]) ?? [];
      setMonths(list);
      if (list.length) setSelected(list[0].period_month);
      setLoading(false);
    });
  }, [supabase]);

  const loadMonth = useCallback(
    async (month: string) => {
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
    },
    [supabase]
  );

  useEffect(() => {
    if (selected) loadMonth(selected);
  }, [selected, loadMonth]);

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
  const overallCr = s && s.views > 0 ? s.orders / s.users : 0;

  return (
    <div>
      <PageHeader
        title={t("traffic")}
        subtitle={t("trafficSubtitle")}
        actions={
          <select className="input !w-auto" value={selected ?? ""} onChange={(e) => setSelected(e.target.value)}>
            {months.map((m) => (
              <option key={m.period_month} value={m.period_month}>
                {monthLabel(m.period_month, lang)}
              </option>
            ))}
          </select>
        }
      />

      {s && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard label={t("views")} value={formatNumber(s.views)} />
            <KpiCard label={t("activeUsers")} value={formatNumber(s.users)} accent="slate" />
            <KpiCard label={t("addToCarts")} value={formatNumber(s.add_to_carts)} accent="amber" />
            <KpiCard label={t("totalOrders")} value={formatNumber(s.orders)} accent="green" />
            <KpiCard label={t("grossRevenue")} value={formatMoney(s.order_revenue, lang)} accent="green" />
            <KpiCard
              label={t("bounceRate")}
              value={s.avg_bounce != null ? `${(s.avg_bounce * 100).toFixed(1)}%` : "—"}
              accent="red"
            />
          </div>

          {/* Funnel gap analysis */}
          <div className="card p-5">
            <h3 className="mb-4 text-sm font-bold text-slate-700">{t("trafficGap")}</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <FunnelStep
                label={`${t("views")} → ${t("addToCarts")}`}
                value={s.views > 0 ? s.add_to_carts / s.views : 0}
                benchmark={0.05}
                lang={lang}
              />
              <FunnelStep
                label={`${t("addToCarts")} → ${t("orders")}`}
                value={s.add_to_carts > 0 ? s.orders / s.add_to_carts : 0}
                benchmark={0.25}
                lang={lang}
              />
              <FunnelStep
                label={`${t("activeUsers")} → ${t("orders")} (CR)`}
                value={overallCr}
                benchmark={0.015}
                lang={lang}
              />
            </div>
          </div>

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
                    <th>{t("pagePath")}</th>
                    <th>{t("views")}</th>
                    <th>{t("activeUsers")}</th>
                    <th>{t("addToCarts")}</th>
                    <th>{t("atcRate")}</th>
                    <th>{t("bounceRate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((p) => {
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

function FunnelStep({ label, value, benchmark, lang }: { label: string; value: number; benchmark: number; lang: "ar" | "en" }) {
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
      </div>
      <div className="mt-0.5 text-[11px] text-slate-500">
        {lang === "ar" ? "المعيار" : "Benchmark"}: {(benchmark * 100).toFixed(1)}%
      </div>
    </div>
  );
}
