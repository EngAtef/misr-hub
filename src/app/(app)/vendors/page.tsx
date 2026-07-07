"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Download, Store, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { rangeParams } from "@/lib/use-analytics";
import { PageHeader, KpiCard, ChartCard, Spinner } from "@/components/ui";
import { TrendChart, BarsChart } from "@/components/charts";
import { formatMoney, formatNumber, toCsv, downloadCsv, cn } from "@/lib/utils";

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

const AL_ADWAA_PATTERN = "أضواء";

interface ScRow {
  vendor: string; titles: number; units: number; revenue: number; profit: number;
  margin_pct: number | null; return_rate: number; stockout_titles: number; avg_sell_through: number;
}

function VendorScorecard() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<ScRow[] | null>(null);

  useEffect(() => {
    supabase.rpc("fn_vendor_scorecard", { p_from: null, p_to: null }).then(({ data }) => setRows((data as ScRow[]) ?? []));
  }, [supabase]);

  if (rows === null) return null;
  if (!rows.length) {
    return <div className="card p-5 mb-6 text-sm text-slate-500">{t("scNoVendors")}</div>;
  }

  return (
    <div className="mb-6">
      <h2 className="mb-2 text-lg font-bold">{t("scorecard")}</h2>
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>{t("selectVendor")}</th>
              <th>{t("scTitles")}</th>
              <th>{t("scUnits")}</th>
              <th>{t("revenue")}</th>
              <th>{t("grossProfit")}</th>
              <th>{t("marginPct")}</th>
              <th>{t("scReturnRate")}</th>
              <th>{t("scStockouts")}</th>
              <th>{t("scSellThrough")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.vendor}>
                <td className="font-semibold">{r.vendor}</td>
                <td>{formatNumber(r.titles)}</td>
                <td>{formatNumber(r.units)}</td>
                <td>{formatMoney(r.revenue, lang)}</td>
                <td className="text-emerald-700 font-semibold">{formatMoney(r.profit, lang)}</td>
                <td className={cn("font-bold", (r.margin_pct ?? 0) < 15 ? "text-red-600" : (r.margin_pct ?? 0) < 30 ? "text-amber-600" : "text-emerald-600")}>
                  {r.margin_pct != null ? `${r.margin_pct}%` : "—"}
                </td>
                <td className={cn("font-semibold", r.return_rate > 10 ? "text-red-600" : "text-slate-600")}>{r.return_rate}%</td>
                <td className={cn(r.stockout_titles > 0 && "text-amber-700 font-semibold")}>{formatNumber(r.stockout_titles)}</td>
                <td>{formatNumber(r.avg_sell_through)}</td>
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
  const { preset, setPreset, range, setRange } = useDateRange("all");

  const [mode, setMode] = useState<"adwaa" | "custom" | "tagged">("adwaa");
  const [custom, setCustom] = useState("");
  const [taggedVendors, setTaggedVendors] = useState<{ vendor: string; skus: number }[]>([]);
  const [tagged, setTagged] = useState("");

  const [kpis, setKpis] = useState<VendorKpis | null>(null);
  const [monthly, setMonthly] = useState<{ month: string; units: number; revenue: number; orders: number }[]>([]);
  const [books, setBooks] = useState<{ product_name: string; sku: string; units: number; revenue: number }[]>([]);
  const [cities, setCities] = useState<{ city: string; units: number; revenue: number }[]>([]);
  const [loading, setLoading] = useState(true);

  // resolve the active (pattern, vendorTag) pair
  const [pattern, vendorTag] =
    mode === "adwaa" ? [AL_ADWAA_PATTERN, null] : mode === "custom" ? [custom.trim(), null] : [null, tagged];

  useEffect(() => {
    supabase.rpc("fn_vendor_list").then(({ data }) => {
      const list = (data as { vendor: string; skus: number }[]) ?? [];
      setTaggedVendors(list);
      if (list.length) setTagged(list[0].vendor);
    });
  }, [supabase]);

  const load = useCallback(async () => {
    if (!pattern && !vendorTag) {
      setKpis(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const p = rangeParams(range);
    const args = { p_pattern: pattern, p_vendor: vendorTag, p_from: p.p_from, p_to: p.p_to };
    const [k, m, b, c] = await Promise.all([
      supabase.rpc("fn_vendor_kpis", args),
      supabase.rpc("fn_vendor_by_month", args),
      supabase.rpc("fn_vendor_top_books", { ...args, p_limit: 40 }),
      supabase.rpc("fn_vendor_by_city", { ...args, p_limit: 20 }),
    ]);
    setKpis(k.data as VendorKpis);
    setMonthly(((m.data as { month: string; units: number; revenue: number; orders: number }[]) ?? []));
    setBooks(((b.data as { product_name: string; sku: string; units: number; revenue: number }[]) ?? []));
    setCities(((c.data as { city: string; units: number; revenue: number }[]) ?? []));
    setLoading(false);
  }, [supabase, pattern, vendorTag, range]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title={t("vendors")}
        subtitle={t("vendorSubtitle")}
        actions={<DateRangeFilter preset={preset} setPreset={setPreset} range={range} setRange={setRange} />}
      />

      <div className="card p-4 mb-5 flex flex-wrap items-center gap-3">
        <Store size={18} className="text-brand-600" />
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          <button onClick={() => setMode("adwaa")} className={cn("rounded-md px-3 py-1.5 text-sm font-semibold", mode === "adwaa" ? "bg-white text-brand-700 shadow-sm" : "text-slate-600")}>
            {t("vendorAlAdwaa")}
          </button>
          <button onClick={() => setMode("custom")} className={cn("rounded-md px-3 py-1.5 text-sm font-semibold", mode === "custom" ? "bg-white text-brand-700 shadow-sm" : "text-slate-600")}>
            {t("vendorCustom")}
          </button>
          {taggedVendors.length > 0 && (
            <button onClick={() => setMode("tagged")} className={cn("rounded-md px-3 py-1.5 text-sm font-semibold", mode === "tagged" ? "bg-white text-brand-700 shadow-sm" : "text-slate-600")}>
              {t("taggedVendors")}
            </button>
          )}
        </div>
        {mode === "custom" && (
          <input className="input !w-72" placeholder={t("vendorKeywordPh")} value={custom} onChange={(e) => setCustom(e.target.value)} />
        )}
        {mode === "tagged" && (
          <select className="input !w-auto" value={tagged} onChange={(e) => setTagged(e.target.value)}>
            {taggedVendors.map((v) => (
              <option key={v.vendor} value={v.vendor}>{v.vendor} ({v.skus})</option>
            ))}
          </select>
        )}
      </div>

      {mode !== "tagged" && (
        <div className="mb-5 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-xs text-amber-800">
          <Info size={15} className="shrink-0 mt-0.5" />
          {t("vendorShareNote")}
        </div>
      )}

      <VendorScorecard />

      {loading ? (
        <Spinner />
      ) : !kpis || kpis.units === 0 ? (
        <div className="card p-12 text-center text-slate-500">{t("noResults")}</div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard label={t("vendorUnits")} value={formatNumber(kpis.units)} />
            <KpiCard label={t("vendorRevenue")} value={formatMoney(kpis.revenue, lang)} accent="green" />
            <KpiCard label={t("vendorOrders")} value={formatNumber(kpis.orders)} accent="slate" />
            <KpiCard label={t("vendorTitles")} value={formatNumber(kpis.unique_titles)} />
            <KpiCard label={t("vendorAvgPrice")} value={formatMoney(kpis.avg_price, lang)} accent="slate" />
            <KpiCard label={t("vendorCancelledUnits")} value={formatNumber(kpis.cancelled_units)} accent="red" />
          </div>

          {monthly.length > 0 && (
            <ChartCard title={t("vendorMonthly")}>
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
            <ChartCard title={t("vendorByCity")}>
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
                <h3 className="text-sm font-bold text-slate-700">{t("vendorTopBooks")}</h3>
                <button
                  className="btn-secondary !py-1.5 text-xs"
                  onClick={() => downloadCsv(`vendor-books-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(books as unknown as Record<string, unknown>[]))}
                >
                  <Download size={14} />
                  {t("exportCsv")}
                </button>
              </div>
              <div className="card overflow-x-auto max-h-[340px] overflow-y-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{t("products")}</th>
                      <th>{t("sku")}</th>
                      <th>{t("vendorUnits")}</th>
                      <th>{t("revenue")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {books.map((b, i) => (
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
