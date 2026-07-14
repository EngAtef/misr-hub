"use client";

import { useMemo, useState } from "react";
import { Coins, TrendingUp, TrendingDown } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { useRpc, rangeParams } from "@/lib/use-analytics";
import { PageHeader, KpiCard, ChartCard, Spinner, SortTh, useSort, DeltaBadge } from "@/components/ui";
import { TrendChart, BarsChart } from "@/components/charts";
import { formatMoney, formatNumber, cn } from "@/lib/utils";

interface ProfitSummary {
  revenue: number;
  total_units: number;
  covered_units: number;
  coverage_pct: number;
  revenue_covered: number;
  cost_covered: number;
  profit_covered: number;
  margin_covered_pct: number | null;
  est_total_profit: number;
}

interface VendorRow { vendor: string; units: number; revenue: number; cost: number; profit: number; margin_pct: number | null; }
interface BookRow { product_name: string; sku: string; units: number; revenue: number; profit: number; margin_pct: number | null; }

export default function ProfitPage() {
  const { t, lang } = useLang();
  const { preset, setPreset, range, setRange, comparePreset, setComparePreset, customCompare, setCustomCompare, compare } = useDateRange("30d");
  const [margin, setMargin] = useState(30);
  const params = rangeParams(range);
  const deps = [range.from, range.to, margin];

  const summary = useRpc<ProfitSummary>("fn_profit_summary", { ...params, p_default_margin: margin / 100 }, deps);
  const prevSummary = useRpc<ProfitSummary>(
    "fn_profit_summary",
    compare ? { ...rangeParams(compare), p_default_margin: margin / 100 } : {},
    [compare?.from, compare?.to, margin],
    !compare
  );
  const ps = compare ? prevSummary.data : null;
  const money = (n: number) => formatMoney(n, lang);
  const byVendor = useRpc<VendorRow[]>("fn_profit_by_vendor", { ...params, p_limit: 20 }, deps);
  const byMonth = useRpc<{ month: string; revenue: number; est_profit: number }[]>("fn_profit_by_month", { ...params, p_default_margin: margin / 100 }, deps);
  const topBooks = useRpc<BookRow[]>("fn_profit_by_book", { ...params, p_dir: "desc", p_limit: 15 }, deps);
  const worstBooks = useRpc<BookRow[]>("fn_profit_by_book", { ...params, p_dir: "asc", p_limit: 15 }, deps);

  const s = summary.data;
  const hasCost = s && s.covered_units > 0;

  return (
    <div>
      <PageHeader
        title={t("profit")}
        subtitle={t("profitSubtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-slate-500">{t("defaultMargin")}</span>
              <input type="number" min={0} max={90} className="input !w-16 !py-1" dir="ltr" value={margin} onChange={(e) => setMargin(Number(e.target.value) || 0)} />
            </div>
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
          </div>
        }
      />

      {summary.loading ? (
        <Spinner />
      ) : !s ? (
        <div className="card p-12 text-center text-slate-500">{t("noCostData")}</div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <KpiCard
              label={t("grossRevenue")}
              value={formatMoney(s.revenue, lang)}
              delta={ps && <DeltaBadge current={s.revenue} previous={ps.revenue} fmtPrev={money} />}
            />
            <KpiCard
              label={t("grossProfit")}
              value={formatMoney(s.est_total_profit, lang)}
              accent="green"
              delta={ps && <DeltaBadge current={s.est_total_profit} previous={ps.est_total_profit} fmtPrev={money} />}
            />
            <KpiCard
              label={t("marginPct")}
              value={s.revenue ? `${((s.est_total_profit / s.revenue) * 100).toFixed(1)}%` : "—"}
              accent="green"
              delta={
                ps && s.revenue && ps.revenue ? (
                  <DeltaBadge current={(s.est_total_profit / s.revenue) * 100} previous={(ps.est_total_profit / ps.revenue) * 100} />
                ) : undefined
              }
            />
            <KpiCard
              label={t("realProfit")}
              value={formatMoney(s.profit_covered, lang)}
              sub={s.margin_covered_pct != null ? `${s.margin_covered_pct}% ${t("marginPct")}` : undefined}
              delta={ps && <DeltaBadge current={s.profit_covered} previous={ps.profit_covered} fmtPrev={money} />}
            />
            <KpiCard label={t("costCoverage")} value={`${s.coverage_pct}%`} sub={t("coverageNote")} accent={s.coverage_pct > 50 ? "green" : "amber"} />
          </div>

          {!hasCost && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              {t("noCostData")}
            </div>
          )}

          {byMonth.data && byMonth.data.length > 0 && (
            <ChartCard title={t("profitTrend")}>
              <TrendChart
                data={byMonth.data.map((m) => ({ ...m, month: new Date(m.month).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }) })) as unknown as Record<string, unknown>[]}
                xKey="month"
                series={[
                  { key: "revenue", name: t("grossRevenue") },
                  { key: "est_profit", name: t("grossProfit"), color: "#10b981" },
                ]}
              />
            </ChartCard>
          )}

          {hasCost && (
            <>
              <ChartCard title={t("profitByVendor")}>
                <BarsChart
                  data={(byVendor.data ?? []).slice(0, 12) as unknown as Record<string, unknown>[]}
                  xKey="vendor"
                  layout="vertical"
                  series={[{ key: "profit", name: t("grossProfit"), color: "#10b981" }]}
                  height={360}
                />
              </ChartCard>

              <div className="grid gap-6 lg:grid-cols-2">
                <BookTable title={t("mostProfitable")} rows={topBooks.data ?? []} icon="up" />
                <BookTable title={t("worstMargin")} rows={worstBooks.data ?? []} icon="down" />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function BookTable({ title, rows, icon }: { title: string; rows: BookRow[]; icon: "up" | "down" }) {
  const { t, lang } = useLang();
  const Icon = icon === "up" ? TrendingUp : TrendingDown;
  const { sort, toggle, apply } = useSort<BookRow>();
  const sortedRows = useMemo(
    () =>
      apply(rows, {
        name: (b) => b.product_name,
        units: (b) => b.units,
        profit: (b) => b.profit,
        margin: (b) => b.margin_pct,
      }),
    [rows, apply]
  );
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
        <Icon size={16} className={icon === "up" ? "text-emerald-600" : "text-red-600"} />
        {title}
      </h3>
      <div className="card overflow-x-auto max-h-[360px] overflow-y-auto">
        <table className="table-base">
          <thead>
            <tr>
              <SortTh label={t("products")} k="name" sort={sort} onToggle={toggle} />
              <SortTh label={t("vendorUnits")} k="units" sort={sort} onToggle={toggle} />
              <SortTh label={t("grossProfit")} k="profit" sort={sort} onToggle={toggle} />
              <SortTh label={t("marginPct")} k="margin" sort={sort} onToggle={toggle} />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((b, i) => (
              <tr key={i}>
                <td className="!whitespace-normal max-w-xs font-medium">{b.product_name}</td>
                <td>{formatNumber(b.units)}</td>
                <td className={cn("font-semibold", b.profit < 0 && "text-red-600")}>{formatMoney(b.profit, lang)}</td>
                <td className={cn("font-bold", (b.margin_pct ?? 0) < 10 ? "text-red-600" : (b.margin_pct ?? 0) < 25 ? "text-amber-600" : "text-emerald-600")}>
                  {b.margin_pct != null ? `${b.margin_pct}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
