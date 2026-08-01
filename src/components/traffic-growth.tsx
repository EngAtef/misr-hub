"use client";

// Growth tabs of the Traffic page: Channels & ROI, Tracking Health and the
// Product Opportunity Matrix. All data comes from the ga4_* tables filled by
// /api/cron/ga4-sync plus the store's own orders/stock tables.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { KpiCard, ChartCard, Spinner, SortTh, useSort } from "@/components/ui";
import { TrendChart } from "@/components/charts";
import { formatNumber, formatMoney, cn } from "@/lib/utils";

// rough Arabic text normalizer so GA4 search terms match catalog names
const normalizeAr = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();

// GA4 reports Egyptian cities in English while order exports use Arabic
const CITY_AR: Record<string, string[]> = {
  cairo: ["القاهره"],
  alexandria: ["الاسكندريه", "اسكندريه"],
  giza: ["الجيزه", "جيزه"],
  "shubra el kheima": ["القليوبيه", "شبرا الخيمه"],
  "port said": ["بورسعيد"],
  suez: ["السويس"],
  mansoura: ["المنصوره", "الدقهليه"],
  "el mahalla el kubra": ["المحله الكبري", "الغربيه"],
  tanta: ["طنطا", "الغربيه"],
  asyut: ["اسيوط"],
  ismailia: ["الاسماعيليه"],
  faiyum: ["الفيوم"],
  fayoum: ["الفيوم"],
  zagazig: ["الزقازيق", "الشرقيه"],
  damietta: ["دمياط"],
  aswan: ["اسوان"],
  luxor: ["الاقصر"],
  minya: ["المنيا"],
  "beni suef": ["بني سويف"],
  qena: ["قنا"],
  sohag: ["سوهاج"],
  hurghada: ["الغردقه", "البحر الاحمر"],
  banha: ["بنها", "القليوبيه"],
  "kafr el sheikh": ["كفر الشيخ"],
  damanhur: ["دمنهور", "البحيره"],
  "6th of october city": ["اكتوبر", "السادس من اكتوبر"],
  "10th of ramadan city": ["العاشر من رمضان"],
  "new cairo": ["القاهره الجديده", "التجمع"],
  matruh: ["مطروح", "مرسي مطروح"],
  arish: ["العريش", "شمال سيناء"],
};

const isoDaysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

function RangePicker({
  value,
  onChange,
  options,
}: {
  value: number;
  onChange: (v: number) => void;
  options: number[];
}) {
  const { t } = useLang();
  const labels: Record<number, string> = { 7: t("last7"), 30: t("last30"), 60: t("last60"), 90: t("last90") };
  return (
    <div className="flex gap-1">
      {options.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-semibold border",
            value === d ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"
          )}
        >
          {labels[d]}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------- Overview strip

// Compact GA4 KPI row for the Overview page (renders nothing until the
// GA4 sync has daily data for the selected range).
export function TrafficKpis({ from, to }: { from: string | null; to: string | null }) {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [sums, setSums] = useState<{ sessions: number; purchases: number } | null>(null);

  useEffect(() => {
    if (!from || !to) return;
    let cancelled = false;
    supabase
      .from("ga4_daily")
      .select("sessions, purchases")
      .gte("date", from)
      .lte("date", to)
      .then(({ data }) => {
        if (cancelled) return;
        const list = (data as { sessions: number | null; purchases: number | null }[]) ?? [];
        if (!list.length) {
          setSums(null);
          return;
        }
        setSums({
          sessions: list.reduce((s, r) => s + (r.sessions ?? 0), 0),
          purchases: list.reduce((s, r) => s + (r.purchases ?? 0), 0),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, from, to]);

  if (!sums || sums.sessions === 0) return null;
  const cr = (sums.purchases / sums.sessions) * 100;
  return (
    <div className="grid grid-cols-3 gap-4">
      <KpiCard label={t("sessionsLbl")} value={formatNumber(sums.sessions)} />
      <KpiCard label={t("ga4PurchasesLbl")} value={formatNumber(sums.purchases)} accent="slate" />
      <KpiCard label="CR" value={`${cr.toFixed(2)}%`} accent={cr >= 1 ? "green" : "amber"} />
    </div>
  );
}

// ---------------------------------------------------------------- Channels

interface ChannelRow {
  source: string;
  medium: string;
  sessions: number;
  users: number;
  add_to_carts: number;
  ga4_purchases: number;
  ga4_revenue: number;
  orders: number;
  delivered: number;
  cancelled: number;
  order_revenue: number;
}

interface CampaignRow {
  campaign: string;
  sessions: number;
  ga4_purchases: number;
  ga4_revenue: number;
  orders: number;
  delivered: number;
  cancelled: number;
  order_revenue: number;
  spend: number | null;
  meta_purchases: number | null;
  meta_revenue: number | null;
}

export function ChannelsReport() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [days, setDays] = useState(30);
  const [channels, setChannels] = useState<ChannelRow[] | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setChannels(null);
    supabase
      .rpc("fn_channel_summary", { p_from: isoDaysAgo(days - 1), p_to: isoDaysAgo(0) })
      .then(({ data }) => {
        if (cancelled) return;
        const d = (data ?? {}) as { channels?: ChannelRow[]; campaigns?: CampaignRow[] };
        setChannels(d.channels ?? []);
        setCampaigns(d.campaigns ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, days]);

  const totals = useMemo(() => {
    if (!channels) return null;
    const sum = (f: (c: ChannelRow) => number) => channels.reduce((s, c) => s + (f(c) || 0), 0);
    const spend = campaigns.reduce((s, c) => s + (c.spend ?? 0), 0);
    const orderRevenue = sum((c) => c.order_revenue);
    return {
      sessions: sum((c) => c.sessions),
      ga4Purchases: sum((c) => c.ga4_purchases),
      orders: sum((c) => c.orders),
      orderRevenue,
      spend,
      roas: spend > 0 ? orderRevenue / spend : null,
    };
  }, [channels, campaigns]);

  const { sort: sortCh, toggle: toggleCh, apply: applyCh } = useSort<ChannelRow>();
  const sortedChannels = useMemo(
    () =>
      applyCh(channels ?? [], {
        channel: (c) => `${c.source}/${c.medium}`,
        sessions: (c) => c.sessions,
        atc: (c) => c.add_to_carts,
        ga4: (c) => c.ga4_purchases,
        orders: (c) => c.orders,
        delivered: (c) => c.delivered,
        revenue: (c) => c.order_revenue,
        cr: (c) => (c.sessions > 0 ? c.orders / c.sessions : 0),
      }),
    [channels, applyCh]
  );

  const { sort: sortCa, toggle: toggleCa, apply: applyCa } = useSort<CampaignRow>();
  const sortedCampaigns = useMemo(
    () =>
      applyCa(campaigns, {
        name: (c) => c.campaign,
        spend: (c) => c.spend ?? 0,
        meta: (c) => c.meta_purchases ?? 0,
        ga4: (c) => c.ga4_purchases,
        orders: (c) => c.orders,
        delivered: (c) => c.delivered,
        revenue: (c) => c.order_revenue,
        roas: (c) => (c.spend ? c.order_revenue / c.spend : 0),
        claim: (c) => (c.orders > 0 && c.meta_purchases ? c.meta_purchases / c.orders : 0),
      }),
    [campaigns, applyCa]
  );

  if (!channels) return <Spinner />;
  if (!channels.length)
    return <div className="card p-8 text-center text-sm text-slate-500">{t("noGrowthData")}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{t("channelsHint")}</p>
        <RangePicker value={days} onChange={setDays} options={[7, 30, 90]} />
      </div>

      {totals && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard label={t("sessionsLbl")} value={formatNumber(totals.sessions)} />
          <KpiCard label={t("ga4PurchasesLbl")} value={formatNumber(totals.ga4Purchases)} accent="slate" />
          <KpiCard label={t("actualOrdersLbl")} value={formatNumber(totals.orders)} accent="green" />
          <KpiCard label={t("grossRevenue")} value={formatMoney(totals.orderRevenue, lang)} accent="green" />
          <KpiCard label={t("totalSpend")} value={totals.spend ? formatMoney(totals.spend, lang) : "—"} accent="amber" />
          <KpiCard
            label={t("actualRoas")}
            value={totals.roas != null ? `${totals.roas.toFixed(2)}×` : "—"}
            accent={totals.roas != null && totals.roas < 1 ? "red" : "green"}
          />
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <SortTh label={t("channelLbl")} k="channel" sort={sortCh} onToggle={toggleCh} />
              <SortTh label={t("sessionsLbl")} k="sessions" sort={sortCh} onToggle={toggleCh} />
              <SortTh label={t("addToCarts")} k="atc" sort={sortCh} onToggle={toggleCh} />
              <SortTh label={t("ga4PurchasesLbl")} k="ga4" sort={sortCh} onToggle={toggleCh} />
              <SortTh label={t("actualOrdersLbl")} k="orders" sort={sortCh} onToggle={toggleCh} />
              <SortTh label={t("delivered")} k="delivered" sort={sortCh} onToggle={toggleCh} />
              <SortTh label={t("grossRevenue")} k="revenue" sort={sortCh} onToggle={toggleCh} />
              <SortTh label="CR%" k="cr" sort={sortCh} onToggle={toggleCh} />
            </tr>
          </thead>
          <tbody>
            {sortedChannels.slice(0, 30).map((c) => {
              const cr = c.sessions > 0 ? (c.orders / c.sessions) * 100 : 0;
              return (
                <tr key={`${c.source}|${c.medium}`}>
                  <td dir="ltr" className="font-medium text-xs">
                    {c.source || "(direct)"} <span className="text-slate-400">/ {c.medium || "—"}</span>
                  </td>
                  <td className="font-semibold">{formatNumber(c.sessions)}</td>
                  <td>{formatNumber(c.add_to_carts)}</td>
                  <td>{formatNumber(c.ga4_purchases)}</td>
                  <td className="font-semibold">{formatNumber(c.orders)}</td>
                  <td className="text-emerald-700">{formatNumber(c.delivered)}</td>
                  <td>{formatMoney(c.order_revenue, lang)}</td>
                  <td className={cn("font-bold", cr >= 1.5 ? "text-emerald-600" : cr < 0.5 ? "text-red-600" : "")}>
                    {cr.toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {campaigns.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-bold text-slate-700">{t("campaigns")}</h3>
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <SortTh label={t("campaignName")} k="name" sort={sortCa} onToggle={toggleCa} />
                  <SortTh label={t("spend")} k="spend" sort={sortCa} onToggle={toggleCa} />
                  <SortTh label={t("metaClaimed")} k="meta" sort={sortCa} onToggle={toggleCa} />
                  <SortTh label={t("ga4PurchasesLbl")} k="ga4" sort={sortCa} onToggle={toggleCa} />
                  <SortTh label={t("actualOrdersLbl")} k="orders" sort={sortCa} onToggle={toggleCa} />
                  <SortTh label={t("delivered")} k="delivered" sort={sortCa} onToggle={toggleCa} />
                  <SortTh label={t("grossRevenue")} k="revenue" sort={sortCa} onToggle={toggleCa} />
                  <SortTh label={t("actualRoas")} k="roas" sort={sortCa} onToggle={toggleCa} />
                  <SortTh label={t("overClaim")} k="claim" sort={sortCa} onToggle={toggleCa} />
                </tr>
              </thead>
              <tbody>
                {sortedCampaigns.slice(0, 40).map((c) => {
                  const roas = c.spend ? c.order_revenue / c.spend : null;
                  const claim = c.orders > 0 && c.meta_purchases ? c.meta_purchases / c.orders : null;
                  return (
                    <tr key={c.campaign}>
                      <td className="!whitespace-normal max-w-xs font-medium text-xs">{c.campaign}</td>
                      <td>{c.spend != null ? formatMoney(c.spend, lang) : "—"}</td>
                      <td className="text-slate-500">{c.meta_purchases != null ? formatNumber(c.meta_purchases) : "—"}</td>
                      <td>{formatNumber(c.ga4_purchases)}</td>
                      <td className="font-semibold">{formatNumber(c.orders)}</td>
                      <td className="text-emerald-700">{formatNumber(c.delivered)}</td>
                      <td>{formatMoney(c.order_revenue, lang)}</td>
                      <td className={cn("font-bold", roas != null && (roas >= 2 ? "text-emerald-600" : roas < 1 ? "text-red-600" : "text-amber-600"))}>
                        {roas != null ? `${roas.toFixed(2)}×` : "—"}
                      </td>
                      <td className={cn("font-bold", claim != null && claim > 1.5 ? "text-red-600" : "text-slate-600")}>
                        {claim != null ? `${claim.toFixed(1)}×` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Health

interface DailyRow {
  day: string;
  ga4_purchases: number;
  ga4_revenue: number;
  sessions: number;
  orders: number;
  order_revenue: number;
}

interface FunnelTotals {
  add_to_carts: number;
  checkouts: number;
}

export function HealthReport() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [days, setDays] = useState(60);
  const [rows, setRows] = useState<DailyRow[] | null>(null);
  const [funnelExtra, setFunnelExtra] = useState<FunnelTotals | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    const p_from = isoDaysAgo(days - 1);
    const p_to = isoDaysAgo(0);
    supabase.rpc("fn_tracking_daily", { p_from, p_to }).then(({ data }) => {
      if (!cancelled) setRows((data as DailyRow[]) ?? []);
    });
    supabase
      .from("ga4_daily")
      .select("add_to_carts, checkouts")
      .gte("date", p_from)
      .lte("date", p_to)
      .then(({ data }) => {
        if (cancelled) return;
        const list = (data as { add_to_carts: number | null; checkouts: number | null }[]) ?? [];
        setFunnelExtra({
          add_to_carts: list.reduce((s, r) => s + (r.add_to_carts ?? 0), 0),
          checkouts: list.reduce((s, r) => s + (r.checkouts ?? 0), 0),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, days]);

  const stats = useMemo(() => {
    if (!rows) return null;
    // ignore today (both sides incomplete) and days with no GA4 data at all
    const closed = rows.slice(0, -1).filter((r) => r.sessions > 0 || r.ga4_purchases > 0);
    const rate = (slice: DailyRow[]) => {
      const orders = slice.reduce((s, r) => s + r.orders, 0);
      const ga4 = slice.reduce((s, r) => s + r.ga4_purchases, 0);
      return orders > 0 ? ga4 / orders : null;
    };
    const rate7 = rate(closed.slice(-7));
    const rate30 = rate(closed.slice(-30));
    return {
      rate7,
      rate30,
      dropped: rate7 != null && rate30 != null && rate7 < rate30 * 0.85,
    };
  }, [rows]);

  if (!rows) return <Spinner />;
  if (!rows.some((r) => r.ga4_purchases > 0 || r.sessions > 0))
    return <div className="card p-8 text-center text-sm text-slate-500">{t("noGrowthData")}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{t("healthHint")}</p>
        <RangePicker value={days} onChange={setDays} options={[30, 60, 90]} />
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <KpiCard
            label={t("trackingRate7")}
            value={stats.rate7 != null ? `${(stats.rate7 * 100).toFixed(1)}%` : "—"}
            accent={stats.rate7 != null && stats.rate7 < 0.85 ? "red" : "green"}
          />
          <KpiCard
            label={t("trackingRate30")}
            value={stats.rate30 != null ? `${(stats.rate30 * 100).toFixed(1)}%` : "—"}
            accent="slate"
          />
          <KpiCard label={t("sessionsLbl")} value={formatNumber(rows.reduce((s, r) => s + r.sessions, 0))} />
        </div>
      )}

      {stats?.dropped && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          <AlertTriangle size={16} />
          {t("trackingDrop")}
        </div>
      )}

      {funnelExtra && (
        <div className="card p-5">
          <h3 className="mb-4 text-sm font-bold text-slate-700">{t("funnelTitle")}</h3>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
            {(() => {
              const steps = [
                { label: t("sessionsLbl"), value: rows.reduce((s, r) => s + r.sessions, 0) },
                { label: t("addToCarts"), value: funnelExtra.add_to_carts },
                { label: t("beginCheckout"), value: funnelExtra.checkouts },
                { label: t("ga4PurchasesLbl"), value: rows.reduce((s, r) => s + r.ga4_purchases, 0) },
                { label: t("actualOrdersLbl"), value: rows.reduce((s, r) => s + r.orders, 0) },
              ];
              return steps.map((st, i) => {
                const prev = i > 0 ? steps[i - 1].value : null;
                const pct = prev && prev > 0 ? (st.value / prev) * 100 : null;
                return (
                  <div key={st.label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold text-slate-500">{st.label}</div>
                    <div className="mt-1 text-xl font-bold text-slate-800">{formatNumber(st.value)}</div>
                    {pct != null && (
                      <div className={cn("mt-0.5 text-[11px] font-bold", pct < 20 ? "text-red-600" : "text-emerald-600")}>
                        {pct.toFixed(1)}%
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      <ChartCard title={t("trafficTabHealth")}>
        <TrendChart
          data={rows as unknown as Record<string, unknown>[]}
          xKey="day"
          type="line"
          series={[
            { key: "orders", name: t("actualOrdersLbl"), color: "#059669" },
            { key: "ga4_purchases", name: t("ga4PurchasesLbl"), color: "#6366f1" },
          ]}
        />
      </ChartCard>

      <ChartCard title={t("sessionsLbl")}>
        <TrendChart
          data={rows as unknown as Record<string, unknown>[]}
          xKey="day"
          series={[{ key: "sessions", name: t("sessionsLbl") }]}
          height={200}
        />
      </ChartCard>
    </div>
  );
}

// ---------------------------------------------------------------- SEO (GSC)

interface GscDailyRow {
  date: string;
  clicks: number | null;
  impressions: number | null;
  position: number | null;
}
interface GscTermRow {
  query?: string;
  page?: string;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
}

export function SeoReport({ months }: { months: string[] }) {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [days, setDays] = useState(30);
  const [daily, setDaily] = useState<GscDailyRow[] | null>(null);
  const [month, setMonth] = useState(months[0] ?? "");
  const [queries, setQueries] = useState<GscTermRow[]>([]);
  const [pages, setPages] = useState<GscTermRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setDaily(null);
    supabase
      .from("gsc_daily")
      .select("date, clicks, impressions, position")
      .gte("date", isoDaysAgo(days - 1))
      .lte("date", isoDaysAgo(0))
      .order("date")
      .then(({ data }) => {
        if (!cancelled) setDaily((data as GscDailyRow[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, days]);

  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    Promise.all([
      supabase.from("gsc_queries").select("query, clicks, impressions, ctr, position").eq("period_month", month).order("clicks", { ascending: false }).limit(50),
      supabase.from("gsc_pages").select("page, clicks, impressions, ctr, position").eq("period_month", month).order("clicks", { ascending: false }).limit(25),
    ]).then(([q, p]) => {
      if (cancelled) return;
      setQueries((q.data as GscTermRow[]) ?? []);
      setPages((p.data as GscTermRow[]) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, month]);

  if (!daily) return <Spinner />;
  if (!daily.length && !queries.length)
    return <div className="card p-8 text-center text-sm text-slate-500">{t("seoSetupHint")}</div>;

  const totals = {
    clicks: daily.reduce((s, r) => s + (r.clicks ?? 0), 0),
    impressions: daily.reduce((s, r) => s + (r.impressions ?? 0), 0),
    position:
      daily.length > 0
        ? daily.reduce((s, r) => s + (r.position ?? 0), 0) / daily.filter((r) => r.position != null).length
        : 0,
  };

  const gscTable = (rows: GscTermRow[], keyName: "query" | "page", title: string) =>
    rows.length > 0 && (
      <div className="card p-5">
        <h3 className="mb-3 text-sm font-bold text-slate-700">{title}</h3>
        <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200">
          <table className="table-base">
            <thead>
              <tr>
                <th>{keyName === "query" ? t("termLbl") : t("pagePath")}</th>
                <th>{t("clicksLbl")}</th>
                <th>{t("impressionsLbl")}</th>
                <th>CTR</th>
                <th>{t("avgPosition")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pos = r.position ?? 0;
                return (
                  <tr key={r[keyName]}>
                    <td className={cn("!whitespace-normal max-w-md font-medium", keyName === "page" && "font-mono text-xs truncate")} dir={keyName === "page" ? "ltr" : undefined}>
                      {keyName === "page" ? (r.page ?? "").replace(/^https?:\/\/[^/]+/, "") || "/" : r.query}
                    </td>
                    <td className="font-semibold">{formatNumber(r.clicks ?? 0)}</td>
                    <td className="text-slate-500">{formatNumber(r.impressions ?? 0)}</td>
                    <td>{((r.ctr ?? 0) * 100).toFixed(1)}%</td>
                    <td className={cn("font-bold", pos <= 5 ? "text-emerald-600" : pos > 10 ? "text-red-600" : "text-amber-600")}>
                      {pos.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">{t("seoHint")}</p>
        <div className="flex items-center gap-2">
          <RangePicker value={days} onChange={setDays} options={[30, 90]} />
          <select className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {new Date(m).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KpiCard label={t("clicksLbl")} value={formatNumber(totals.clicks)} accent="green" />
        <KpiCard label={t("impressionsLbl")} value={formatNumber(totals.impressions)} />
        <KpiCard
          label={t("avgPosition")}
          value={Number.isFinite(totals.position) ? totals.position.toFixed(1) : "—"}
          accent={totals.position <= 10 ? "green" : "amber"}
        />
      </div>

      {daily.length > 0 && (
        <ChartCard title={t("clicksLbl")}>
          <TrendChart
            data={daily as unknown as Record<string, unknown>[]}
            xKey="date"
            series={[{ key: "clicks", name: t("clicksLbl"), color: "#059669" }]}
            height={220}
          />
        </ChartCard>
      )}

      {gscTable(queries, "query", t("googleQueries"))}
      {gscTable(pages, "page", t("gscPagesTitle"))}
    </div>
  );
}

// ---------------------------------------------------------------- Audience

interface SearchTermRow {
  term: string;
  sessions: number | null;
  searches: number | null;
}
interface CityRow {
  city: string;
  sessions: number | null;
  purchases: number | null;
  revenue: number | null;
}
interface DeviceRow {
  device: string;
  sessions: number | null;
  add_to_carts: number | null;
  purchases: number | null;
  revenue: number | null;
}
interface LandingRow {
  landing_page: string;
  sessions: number | null;
  bounce_rate: number | null;
  purchases: number | null;
}
interface CityOrders {
  city: string;
  orders: number;
  delivered: number;
  revenue: number;
}

export function AudienceReport({ months }: { months: string[] }) {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [month, setMonth] = useState(months[0] ?? "");
  const [loading, setLoading] = useState(true);
  const [terms, setTerms] = useState<SearchTermRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [landing, setLanding] = useState<LandingRow[]>([]);
  const [cityOrders, setCityOrders] = useState<CityOrders[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);

  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const monthEnd = new Date(new Date(month).getFullYear(), new Date(month).getMonth() + 1, 0)
        .toISOString()
        .slice(0, 10);
      const [te, ci, de, la, co] = await Promise.all([
        supabase.from("ga4_search_terms").select("term, sessions, searches").eq("period_month", month).order("searches", { ascending: false }).limit(100),
        supabase.from("ga4_cities").select("city, sessions, purchases, revenue").eq("period_month", month).order("sessions", { ascending: false }).limit(40),
        supabase.from("ga4_devices").select("device, sessions, add_to_carts, purchases, revenue").eq("period_month", month),
        supabase.from("ga4_landing").select("landing_page, sessions, bounce_rate, purchases").eq("period_month", month).order("sessions", { ascending: false }).limit(25),
        supabase.rpc("fn_orders_by_city", { p_from: month, p_to: monthEnd, p_limit: 100 }),
      ]);
      // catalog names once, for the "no match" flag on search terms
      const names: string[] = [];
      for (let offset = 0; offset < 30000; offset += 1000) {
        const { data } = await supabase.from("stock_items").select("product_name").range(offset, offset + 999);
        const chunk = (data as { product_name: string | null }[]) ?? [];
        for (const s of chunk) if (s.product_name) names.push(normalizeAr(s.product_name));
        if (chunk.length < 1000) break;
      }
      if (cancelled) return;
      setTerms((te.data as SearchTermRow[]) ?? []);
      setCities((ci.data as CityRow[]) ?? []);
      setDevices((de.data as DeviceRow[]) ?? []);
      setLanding((la.data as LandingRow[]) ?? []);
      setCityOrders((co.data as CityOrders[]) ?? []);
      setCatalog(names);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, month]);

  const cityOrderLookup = useMemo(() => {
    const map = new Map<string, CityOrders>();
    for (const o of cityOrders) map.set(normalizeAr(o.city), o);
    return map;
  }, [cityOrders]);

  const findCityOrders = (ga4City: string): CityOrders | null => {
    const direct = cityOrderLookup.get(normalizeAr(ga4City));
    if (direct) return direct;
    for (const ar of CITY_AR[ga4City.toLowerCase()] ?? []) {
      for (const [key, val] of cityOrderLookup) {
        if (key.includes(ar)) return val;
      }
    }
    return null;
  };

  const termHasMatch = (term: string) => {
    const n = normalizeAr(term);
    if (n.length < 3) return true;
    return catalog.some((name) => name.includes(n));
  };

  if (!months.length)
    return <div className="card p-8 text-center text-sm text-slate-500">{t("noGrowthData")}</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <select className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>
              {new Date(m).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <>
          {devices.length > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {devices.map((d) => {
                const cr = d.sessions ? ((d.purchases ?? 0) / d.sessions) * 100 : 0;
                return (
                  <KpiCard
                    key={d.device}
                    label={`${t("devicesTitle")}: ${d.device}`}
                    value={`CR ${cr.toFixed(2)}%`}
                    sub={`${formatNumber(d.sessions ?? 0)} ${t("sessionsLbl")} · ${formatNumber(d.purchases ?? 0)} ${t("ga4PurchasesLbl")}`}
                    accent={cr >= 1 ? "green" : "amber"}
                  />
                );
              })}
            </div>
          )}

          {terms.length > 0 && (
            <div className="card p-5">
              <h3 className="mb-1 text-sm font-bold text-slate-700">{t("siteSearchTitle")}</h3>
              <p className="mb-3 text-xs text-slate-500">{t("siteSearchHint")}</p>
              <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{t("termLbl")}</th>
                      <th>{t("searchesLbl")}</th>
                      <th>{t("sessionsLbl")}</th>
                      <th>{t("status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {terms.map((tr) => (
                      <tr key={tr.term}>
                        <td className="!whitespace-normal max-w-md font-medium">{tr.term}</td>
                        <td className="font-semibold">{formatNumber(tr.searches ?? 0)}</td>
                        <td>{formatNumber(tr.sessions ?? 0)}</td>
                        <td>
                          {!termHasMatch(tr.term) && (
                            <span className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-bold text-red-700">
                              {t("notStocked")}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {cities.length > 0 && (
            <div className="card p-5">
              <h3 className="mb-1 text-sm font-bold text-slate-700">{t("cityGapTitle")}</h3>
              <p className="mb-3 text-xs text-slate-500">{t("cityGapHint")}</p>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{t("city")}</th>
                      <th>{t("sessionsLbl")}</th>
                      <th>{t("ga4PurchasesLbl")}</th>
                      <th>{t("actualOrdersLbl")}</th>
                      <th>{t("delivered")}</th>
                      <th>CR%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cities.slice(0, 25).map((c) => {
                      const o = findCityOrders(c.city);
                      const cr = c.sessions ? ((o?.orders ?? c.purchases ?? 0) / c.sessions) * 100 : 0;
                      return (
                        <tr key={c.city}>
                          <td dir="ltr" className="font-medium">{c.city}</td>
                          <td className="font-semibold">{formatNumber(c.sessions ?? 0)}</td>
                          <td>{formatNumber(c.purchases ?? 0)}</td>
                          <td className="font-semibold">{o ? formatNumber(o.orders) : "—"}</td>
                          <td className="text-emerald-700">{o ? formatNumber(o.delivered) : "—"}</td>
                          <td className={cn("font-bold", cr >= 1.5 ? "text-emerald-600" : cr < 0.5 ? "text-red-600" : "")}>
                            {cr.toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {landing.length > 0 && (
            <div className="card p-5">
              <h3 className="mb-3 text-sm font-bold text-slate-700">{t("landingTitle")}</h3>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{t("pagePath")}</th>
                      <th>{t("sessionsLbl")}</th>
                      <th>{t("bounceRate")}</th>
                      <th>{t("ga4PurchasesLbl")}</th>
                      <th>CR%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {landing.map((l) => {
                      const cr = l.sessions ? ((l.purchases ?? 0) / l.sessions) * 100 : 0;
                      const bounce = (l.bounce_rate ?? 0) * 100;
                      return (
                        <tr key={l.landing_page}>
                          <td dir="ltr" className="font-mono text-xs max-w-md truncate">{l.landing_page}</td>
                          <td className="font-semibold">{formatNumber(l.sessions ?? 0)}</td>
                          <td className={cn(bounce > 40 ? "text-red-600 font-semibold" : "")}>{bounce.toFixed(0)}%</td>
                          <td>{formatNumber(l.purchases ?? 0)}</td>
                          <td className={cn("font-bold", cr >= 1.5 ? "text-emerald-600" : cr < 0.5 ? "text-red-600" : "")}>
                            {cr.toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Matrix

type Quadrant = "fixPage" | "promote" | "restock" | "cart" | null;

interface MatrixRow {
  name: string;
  views: number;
  added: number;
  ga4_purchased: number;
  actual_units: number;
  stock: number | null;
  quadrant: Quadrant;
}

export function MatrixReport({ months }: { months: string[] }) {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [month, setMonth] = useState(months[0] ?? "");
  const [rows, setRows] = useState<MatrixRow[] | null>(null);
  const [filter, setFilter] = useState<Quadrant | "all">("all");

  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    setRows(null);
    (async () => {
      const monthEnd = new Date(new Date(month).getFullYear(), new Date(month).getMonth() + 1, 1)
        .toISOString()
        .slice(0, 10);
      const [items, actual] = await Promise.all([
        supabase
          .from("ga4_items")
          .select("item_name, items_viewed, items_added, items_purchased")
          .eq("period_month", month)
          .limit(8000),
        supabase.rpc("fn_top_products", { p_from: `${month}T00:00:00Z`, p_to: `${monthEnd}T00:00:00Z`, p_limit: 8000 }),
      ]);
      // stock map by product name (paged)
      const stockMap = new Map<string, number>();
      for (let offset = 0; offset < 50000; offset += 1000) {
        const { data } = await supabase
          .from("stock_items")
          .select("product_name, ecom_stock")
          .range(offset, offset + 999);
        const chunk = (data as { product_name: string | null; ecom_stock: number | null }[]) ?? [];
        for (const s of chunk) {
          if (s.product_name && s.ecom_stock != null) stockMap.set(s.product_name.trim(), s.ecom_stock);
        }
        if (chunk.length < 1000) break;
      }
      if (cancelled) return;

      const actualMap = new Map<string, number>();
      for (const a of (actual.data as { product_name: string; quantity: number }[]) ?? []) {
        actualMap.set(a.product_name.trim(), Number(a.quantity));
      }

      const out: MatrixRow[] = [];
      for (const it of (items.data as {
        item_name: string;
        items_viewed: number | null;
        items_added: number | null;
        items_purchased: number | null;
      }[]) ?? []) {
        const name = it.item_name.trim();
        const views = Number(it.items_viewed ?? 0);
        const added = Number(it.items_added ?? 0);
        const purchased = Number(it.items_purchased ?? 0);
        const actualUnits = actualMap.get(name) ?? 0;
        const stock = stockMap.get(name) ?? null;
        if (views < 30 && actualUnits < 5) continue;

        let quadrant: Quadrant = null;
        const buyRate = views > 0 ? purchased / views : 0;
        if (stock === 0 && (views >= 100 || actualUnits >= 10)) quadrant = "restock";
        else if (views >= 200 && buyRate < 0.005) quadrant = "fixPage";
        else if (added >= 20 && purchased / Math.max(added, 1) < 0.15) quadrant = "cart";
        else if (buyRate >= 0.03 && purchased >= 5 && views < 500) quadrant = "promote";

        out.push({ name, views, added, ga4_purchased: purchased, actual_units: actualUnits, stock, quadrant });
      }
      out.sort((a, b) => b.views - a.views);
      setRows(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, month]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { fixPage: 0, promote: 0, restock: 0, cart: 0 };
    for (const r of rows ?? []) if (r.quadrant) c[r.quadrant]++;
    return c;
  }, [rows]);

  const QUADS: { key: Quadrant & string; label: string; cls: string }[] = [
    { key: "restock", label: t("quadRestock"), cls: "bg-red-100 text-red-700" },
    { key: "promote", label: t("quadPromote"), cls: "bg-emerald-100 text-emerald-700" },
    { key: "fixPage", label: t("quadFixPage"), cls: "bg-amber-100 text-amber-700" },
    { key: "cart", label: t("quadCart"), cls: "bg-violet-100 text-violet-700" },
  ];

  const { sort, toggle, apply } = useSort<MatrixRow>();
  const visible = useMemo(() => {
    const base = (rows ?? []).filter((r) => (filter === "all" ? true : r.quadrant === filter));
    return apply(base, {
      name: (r) => r.name,
      views: (r) => r.views,
      added: (r) => r.added,
      ga4: (r) => r.ga4_purchased,
      actual: (r) => r.actual_units,
      stock: (r) => r.stock ?? -1,
      rate: (r) => (r.views > 0 ? r.ga4_purchased / r.views : 0),
    });
  }, [rows, filter, apply]);

  if (!months.length)
    return <div className="card p-8 text-center text-sm text-slate-500">{t("noGrowthData")}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">{t("matrixHint")}</p>
        <select className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>
              {new Date(m).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", {
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              })}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-semibold border",
            filter === "all" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"
          )}
        >
          {t("quadAll")} ({rows?.length ?? 0})
        </button>
        {QUADS.map((q) => (
          <button
            key={q.key}
            onClick={() => setFilter(q.key)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold border border-transparent",
              q.cls,
              filter === q.key && "ring-2 ring-offset-1 ring-slate-300"
            )}
          >
            {q.label} ({counts[q.key]})
          </button>
        ))}
      </div>

      {!rows ? (
        <Spinner />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <SortTh label={t("products")} k="name" sort={sort} onToggle={toggle} />
                <SortTh label={t("views")} k="views" sort={sort} onToggle={toggle} />
                <SortTh label={t("addedToCart")} k="added" sort={sort} onToggle={toggle} />
                <SortTh label={t("ga4Purchased")} k="ga4" sort={sort} onToggle={toggle} />
                <SortTh label={t("actualSold")} k="actual" sort={sort} onToggle={toggle} />
                <SortTh label={t("stockNow")} k="stock" sort={sort} onToggle={toggle} />
                <SortTh label={t("viewsToBuy")} k="rate" sort={sort} onToggle={toggle} />
                <th>{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 100).map((r) => {
                const q = QUADS.find((x) => x.key === r.quadrant);
                const rate = r.views > 0 ? (r.ga4_purchased / r.views) * 100 : 0;
                return (
                  <tr key={r.name}>
                    <td className="!whitespace-normal max-w-md font-medium">{r.name}</td>
                    <td className="font-semibold">{formatNumber(r.views)}</td>
                    <td>{formatNumber(r.added)}</td>
                    <td>{formatNumber(r.ga4_purchased)}</td>
                    <td className="font-semibold">{formatNumber(r.actual_units)}</td>
                    <td className={cn(r.stock === 0 && "font-bold text-red-600")}>
                      {r.stock != null ? formatNumber(r.stock) : "—"}
                    </td>
                    <td className={cn(rate >= 3 ? "text-emerald-600 font-semibold" : rate < 0.5 ? "text-red-600" : "")}>
                      {rate.toFixed(1)}%
                    </td>
                    <td>
                      {q ? (
                        <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold", q.cls)}>{q.label}</span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
