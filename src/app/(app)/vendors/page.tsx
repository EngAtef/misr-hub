"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Download, Store, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { rangeParams } from "@/lib/use-analytics";
import { PageHeader, KpiCard, ChartCard, Spinner, SortTh, useSort, DeltaBadge } from "@/components/ui";
import { TrendChart, BarsChart } from "@/components/charts";
import { formatMoney, formatNumber, toCsv, downloadCsv, cn } from "@/lib/utils";

// Vendor split is category-driven: SKUs in category "AL-Adwaa" belong to
// the Al Adwaa vendor, every other SKU belongs to NM Books (migration 052).
type VendorGroup = "adwaa" | "nm";

interface VendorKpis {
  units: number;
  revenue: number;
  orders: number;
  delivered_units: number;
  cancelled_units: number;
  unique_titles: number;
  unique_customers: number;
  avg_price: number;
}

interface SummaryRow {
  vendor: string; units: number; revenue: number; orders: number; titles: number; customers: number;
  delivered_units: number; cancelled_units: number; avg_price: number; revenue_share_pct: number;
}

function VendorComparison({ rows }: { rows: SummaryRow[] | null }) {
  const { t, lang } = useLang();
  if (rows === null) return null;
  if (!rows.length) return null;
  return (
    <div className="mb-6">
      <h2 className="mb-2 text-lg font-bold">{t("vendorCompare")}</h2>
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>{t("selectVendor")}</th>
              <th>{t("vendorUnits")}</th>
              <th>{t("vendorRevenue")}</th>
              <th>{t("vendorRevShare")}</th>
              <th>{t("vendorOrders")}</th>
              <th>{t("vendorTitles")}</th>
              <th>{t("vendorCustomers")}</th>
              <th>{t("vendorDeliveredUnits")}</th>
              <th>{t("vendorCancelledUnits")}</th>
              <th>{t("vendorAvgPrice")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.vendor}>
                <td className="font-semibold">{r.vendor === "AL-Adwaa" ? t("vendorAlAdwaa") : r.vendor}</td>
                <td className="font-semibold">{formatNumber(r.units)}</td>
                <td className="text-emerald-700 font-semibold">{formatMoney(r.revenue, lang)}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, r.revenue_share_pct)}%` }} />
                    </div>
                    <span className="font-bold">{r.revenue_share_pct}%</span>
                  </div>
                </td>
                <td>{formatNumber(r.orders)}</td>
                <td>{formatNumber(r.titles)}</td>
                <td>{formatNumber(r.customers)}</td>
                <td>{formatNumber(r.delivered_units)}</td>
                <td className={cn(r.cancelled_units > 0 && "text-red-600")}>{formatNumber(r.cancelled_units)}</td>
                <td>{formatMoney(r.avg_price, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function VendorsPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const { preset, setPreset, range, setRange, comparePreset, setComparePreset, customCompare, setCustomCompare, compare } = useDateRange("30d");

  const [grp, setGrp] = useState<VendorGroup>("adwaa");
  const [summary, setSummary] = useState<SummaryRow[] | null>(null);
  const [kpis, setKpis] = useState<VendorKpis | null>(null);
  const [prevKpis, setPrevKpis] = useState<VendorKpis | null>(null);
  const [monthly, setMonthly] = useState<{ month: string; units: number; revenue: number; orders: number }[]>([]);
  const [books, setBooks] = useState<{ product_name: string; sku: string; units: number; revenue: number }[]>([]);
  const [cities, setCities] = useState<{ city: string; units: number; revenue: number }[]>([]);
  const [loading, setLoading] = useState(true);

  // both vendors side by side, current range
  useEffect(() => {
    let cancelled = false;
    const p = rangeParams(range);
    supabase.rpc("fn_vendor_grp_summary", { p_from: p.p_from, p_to: p.p_to }).then(({ data }) => {
      if (!cancelled) setSummary((data as SummaryRow[]) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, range]);

  const load = useCallback(async () => {
    setLoading(true);
    const p = rangeParams(range);
    const args = { p_group: grp, p_from: p.p_from, p_to: p.p_to };
    const [k, m, b, c] = await Promise.all([
      supabase.rpc("fn_vendor_grp_kpis", args),
      supabase.rpc("fn_vendor_grp_by_month", args),
      supabase.rpc("fn_vendor_grp_top_books", { ...args, p_limit: 40 }),
      supabase.rpc("fn_vendor_grp_by_city", { ...args, p_limit: 20 }),
    ]);
    setKpis(k.data as VendorKpis);
    setMonthly(((m.data as { month: string; units: number; revenue: number; orders: number }[]) ?? []));
    setBooks(((b.data as { product_name: string; sku: string; units: number; revenue: number }[]) ?? []));
    setCities(((c.data as { city: string; units: number; revenue: number }[]) ?? []));
    setLoading(false);
  }, [supabase, grp, range]);

  useEffect(() => {
    load();
  }, [load]);

  // same vendor group, comparison period
  useEffect(() => {
    if (!compare) {
      setPrevKpis(null);
      return;
    }
    let cancelled = false;
    const p = rangeParams(compare);
    supabase
      .rpc("fn_vendor_grp_kpis", { p_group: grp, p_from: p.p_from, p_to: p.p_to })
      .then(({ data }) => {
        if (!cancelled) setPrevKpis((data as VendorKpis) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, compare, grp]);

  const pk = compare ? prevKpis : null;
  const money = (n: number) => formatMoney(n, lang);

  const { sort: sortBooks, toggle: toggleBooks, apply: applyBooks } = useSort<{ product_name: string; sku: string; units: number; revenue: number }>();
  const sortedBooks = useMemo(
    () =>
      applyBooks(books, {
        name: (b) => b.product_name,
        sku: (b) => b.sku,
        units: (b) => b.units,
        revenue: (b) => b.revenue,
      }),
    [books, applyBooks]
  );

  const grpLabel = grp === "adwaa" ? t("vendorAlAdwaa") : t("vendorNmBooks");

  return (
    <div>
      <PageHeader
        title={t("vendors")}
        subtitle={t("vendorSubtitle")}
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

      <div className="card p-4 mb-5 flex flex-wrap items-center gap-3">
        <Store size={18} className="text-brand-600" />
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          <button onClick={() => setGrp("adwaa")} className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", grp === "adwaa" ? "bg-white text-brand-700 shadow-sm" : "text-slate-600")}>
            {t("vendorAlAdwaa")}
          </button>
          <button onClick={() => setGrp("nm")} className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", grp === "nm" ? "bg-white text-brand-700 shadow-sm" : "text-slate-600")}>
            {t("vendorNmBooks")}
          </button>
        </div>
        <div className="flex items-start gap-2 rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-800">
          <Info size={15} className="shrink-0 mt-0.5" />
          {t("vendorCatNote")}
        </div>
      </div>

      <VendorComparison rows={summary} />

      {loading ? (
        <Spinner />
      ) : !kpis || kpis.units === 0 ? (
        <div className="card p-12 text-center text-slate-500">{t("noResults")}</div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard
              label={t("vendorUnits")}
              value={formatNumber(kpis.units)}
              delta={pk && <DeltaBadge current={kpis.units} previous={pk.units} fmtPrev={formatNumber} />}
            />
            <KpiCard
              label={t("vendorRevenue")}
              value={formatMoney(kpis.revenue, lang)}
              accent="green"
              delta={pk && <DeltaBadge current={kpis.revenue} previous={pk.revenue} fmtPrev={money} />}
            />
            <KpiCard
              label={t("vendorOrders")}
              value={formatNumber(kpis.orders)}
              accent="slate"
              delta={pk && <DeltaBadge current={kpis.orders} previous={pk.orders} fmtPrev={formatNumber} />}
            />
            <KpiCard
              label={t("vendorTitles")}
              value={formatNumber(kpis.unique_titles)}
              delta={pk && <DeltaBadge current={kpis.unique_titles} previous={pk.unique_titles} fmtPrev={formatNumber} />}
            />
            <KpiCard
              label={t("vendorAvgPrice")}
              value={formatMoney(kpis.avg_price, lang)}
              accent="slate"
              delta={pk && <DeltaBadge current={kpis.avg_price} previous={pk.avg_price} fmtPrev={money} />}
            />
            <KpiCard
              label={t("vendorCancelledUnits")}
              value={formatNumber(kpis.cancelled_units)}
              accent="red"
              delta={pk && <DeltaBadge current={kpis.cancelled_units} previous={pk.cancelled_units} invert fmtPrev={formatNumber} />}
            />
          </div>

          {monthly.length > 0 && (
            <ChartCard title={`${t("vendorMonthly")} — ${grpLabel}`}>
              <TrendChart
                data={monthly.map((m) => ({ ...m, month: new Date(m.month).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }) })) as unknown as Record<string, unknown>[]}
                xKey="month"
                series={[
                  { key: "units", name: t("vendorUnits") },
                  { key: "revenue", name: t("vendorRevenue"), color: "#10b981" },
                ]}
              />
            </ChartCard>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title={`${t("vendorByCity")} — ${grpLabel}`}>
              <BarsChart
                data={cities.slice(0, 10) as unknown as Record<string, unknown>[]}
                xKey="city"
                layout="vertical"
                series={[{ key: "units", name: t("vendorUnits") }]}
                height={340}
              />
            </ChartCard>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-700">{`${t("vendorTopBooks")} — ${grpLabel}`}</h3>
                <button
                  className="btn-secondary !py-1.5 text-xs"
                  onClick={() => downloadCsv(`vendor-${grp}-books-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(books as unknown as Record<string, unknown>[]))}
                >
                  <Download size={14} />
                  {t("exportCsv")}
                </button>
              </div>
              <div className="card overflow-x-auto max-h-[340px] overflow-y-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <SortTh label={t("products")} k="name" sort={sortBooks} onToggle={toggleBooks} />
                      <SortTh label={t("sku")} k="sku" sort={sortBooks} onToggle={toggleBooks} />
                      <SortTh label={t("vendorUnits")} k="units" sort={sortBooks} onToggle={toggleBooks} />
                      <SortTh label={t("revenue")} k="revenue" sort={sortBooks} onToggle={toggleBooks} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedBooks.map((b, i) => (
                      <tr key={i}>
                        <td className="!whitespace-normal max-w-xs font-medium">{b.product_name}</td>
                        <td dir="ltr" className="font-mono text-xs text-slate-500">{b.sku}</td>
                        <td className="font-semibold">{formatNumber(b.units)}</td>
                        <td>{formatMoney(b.revenue, lang)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
