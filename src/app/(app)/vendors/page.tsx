"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Download, Store, Info, AlertTriangle } from "lucide-react";
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

interface MonthRow { month: string; units: number; revenue: number; orders: number }
interface BookRow { product_name: string; sku: string; units: number; revenue: number }
interface CityRow { city: string; units: number; revenue: number }

// fn_vendor_grp_overview returns everything the page renders in one
// call (migration 072) — four parallel RPCs used to blow past the 8s
// statement timeout on anything wider than a week.
interface VendorOverview {
  kpis: VendorKpis;
  monthly: MonthRow[];
  books: BookRow[];
  cities: CityRow[];
}

interface ExportLine {
  order_number: string; order_date: string | null; order_status: string | null; payment_method: string | null;
  customer_name: string | null; customer_phone: string | null; city: string | null; area: string | null;
  sku: string; product_name: string | null; quantity: number; unit_price: number | null;
  total_before_discount: number | null; total_paid: number | null;
}

export default function VendorsPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const { preset, setPreset, range, setRange, comparePreset, setComparePreset, customCompare, setCustomCompare, compare } = useDateRange("month");

  const [grp, setGrp] = useState<VendorGroup>("adwaa");
  const [exporting, setExporting] = useState(false);
  const [kpis, setKpis] = useState<VendorKpis | null>(null);
  const [prevKpis, setPrevKpis] = useState<VendorKpis | null>(null);
  const [monthly, setMonthly] = useState<MonthRow[]>([]);
  const [books, setBooks] = useState<BookRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // full order-lines export for the current vendor + date range,
  // formatted so the file can be sent to the vendor as-is
  const exportOrders = useCallback(async () => {
    setExporting(true);
    try {
      const p = rangeParams(range);
      const { data } = await supabase.rpc("fn_vendor_grp_export", { p_group: grp, p_from: p.p_from, p_to: p.p_to });
      const lines = ((data as ExportLine[]) ?? []).map((r) => ({
        "Order Number": r.order_number,
        "Order Date": r.order_date ? r.order_date.slice(0, 10) : "",
        "Status": r.order_status ?? "",
        "Customer Name": r.customer_name ?? "",
        "Customer Phone": r.customer_phone ?? "",
        "City": r.city ?? "",
        "Area": r.area ?? "",
        "SKU": r.sku,
        "Product Title": r.product_name ?? "",
        "Quantity": r.quantity,
        "Unit Price": r.unit_price ?? "",
        "Total Before Discount": r.total_before_discount ?? "",
        "Total Paid": r.total_paid ?? "",
        "Payment Method": r.payment_method ?? "",
      }));
      const vendorSlug = grp === "adwaa" ? "al-adwaa" : "nm-books";
      downloadCsv(`${vendorSlug}-orders-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(lines));
    } finally {
      setExporting(false);
    }
  }, [supabase, grp, range]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const p = rangeParams(range);
    const { data, error: err } = await supabase.rpc("fn_vendor_grp_overview", {
      p_group: grp,
      p_from: p.p_from,
      p_to: p.p_to,
      p_limit: 40,
      p_city_limit: 20,
    });
    if (err) {
      // an empty page here used to be indistinguishable from "no sales"
      setError(err.message);
      setKpis(null);
      setMonthly([]);
      setBooks([]);
      setCities([]);
    } else {
      const o = data as VendorOverview | null;
      setKpis(o?.kpis ?? null);
      setMonthly(o?.monthly ?? []);
      setBooks(o?.books ?? []);
      setCities(o?.cities ?? []);
    }
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

  const { sort: sortBooks, toggle: toggleBooks, apply: applyBooks } = useSort<BookRow>();
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
        <button className="btn-secondary" onClick={exportOrders} disabled={exporting}>
          <Download size={15} />
          {exporting ? t("vendorExporting") : t("vendorExportOrders")}
        </button>
        <div className="flex items-start gap-2 rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-800">
          <Info size={15} className="shrink-0 mt-0.5" />
          {t("vendorCatNote")}
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="card p-12 text-center">
          <AlertTriangle size={22} className="mx-auto mb-2 text-amber-500" />
          <div className="font-semibold text-slate-700">{t("loadFailed")}</div>
          <div className="mt-1 text-xs text-slate-500" dir="ltr">{error}</div>
          <button className="btn-secondary mt-4" onClick={load}>
            {t("retry")}
          </button>
        </div>
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
