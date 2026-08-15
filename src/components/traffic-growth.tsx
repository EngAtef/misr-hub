"use client";

// Growth tabs of the Traffic page: Channels & ROI, Tracking Health and the
// Product Opportunity Matrix. All data comes from the ga4_* tables filled by
// /api/cron/ga4-sync plus the store's own orders/stock tables.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, X, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { KpiCard, ChartCard, Spinner, SortTh, useSort } from "@/components/ui";
import { TrendChart } from "@/components/charts";
import { formatNumber, formatMoney, cn, toCsv, downloadCsv } from "@/lib/utils";

function fillVars(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

// CSV export for any section — every table gets one.
function ExportButton({ name, rows }: { name: string; rows: unknown[] }) {
  if (!rows?.length) return null;
  return (
    <button
      className="btn-secondary !py-1 !px-2.5 text-xs shrink-0"
      onClick={() => downloadCsv(`${name}.csv`, toCsv(rows as Record<string, unknown>[]))}
    >
      <Download size={13} />
      CSV
    </button>
  );
}

// Surfaces a failed query instead of pretending there is no data — the
// difference matters (a timeout looks identical to an empty table otherwise).
function ErrorNote({ message }: { message: string }) {
  const { t } = useLang();
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <div className="font-bold">{t("queryFailed")}</div>
      <div className="mt-0.5 text-xs opacity-80" dir="ltr">{message}</div>
    </div>
  );
}

// ------------------------------------------------- generic drill-down drawer

export interface DetailSpec {
  title: string;
  table: string;
  keyColumn: string;
  keyValue: string;
  extraFilter?: Record<string, string>;
  orderColumn: "period_month" | "date";
  campaign?: string; // also load matched orders for this campaign
}

const NUM_SKIP = new Set(["period_month", "date", "imported_at", "dow", "hour"]);

function DetailDrawer({ spec, onClose }: { spec: DetailSpec | null; onClose: () => void }) {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [orders, setOrders] = useState<Record<string, unknown>[] | null>(null);

  useEffect(() => {
    if (!spec) return;
    let cancelled = false;
    setRows(null);
    setOrders(null);
    let q = supabase
      .from(spec.table)
      .select("*")
      .eq(spec.keyColumn, spec.keyValue)
      .order(spec.orderColumn, { ascending: true })
      .limit(3000);
    for (const [k, v] of Object.entries(spec.extraFilter ?? {})) q = q.eq(k, v);
    q.then(({ data }) => {
      if (cancelled) return;
      const raw = (data as Record<string, unknown>[]) ?? [];
      if (spec.orderColumn === "date") {
        // daily rows → aggregate per month for a readable history
        const byMonth = new Map<string, Record<string, number>>();
        for (const r of raw) {
          const m = String(r.date).slice(0, 7);
          const acc = byMonth.get(m) ?? {};
          for (const [k, v] of Object.entries(r)) {
            if (typeof v === "number" && !NUM_SKIP.has(k)) acc[k] = (acc[k] ?? 0) + v;
          }
          byMonth.set(m, acc);
        }
        setRows(Array.from(byMonth.entries()).map(([m, v]) => ({ month: m, ...v })));
      } else {
        setRows(raw.map((r) => ({ month: String(r.period_month).slice(0, 7), ...r })));
      }
    });
    if (spec.campaign) {
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10);
      supabase
        .rpc("fn_campaign_orders", { p_campaign: spec.campaign, p_from: from, p_to: to, p_limit: 100 })
        .then(({ data }) => {
          if (!cancelled) setOrders((data as Record<string, unknown>[]) ?? []);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [supabase, spec]);

  if (!spec) return null;
  const numericCols = rows?.length
    ? Object.keys(rows[0]).filter((k) => typeof rows[0][k] === "number" && !NUM_SKIP.has(k))
    : [];

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/30" />
      <div
        className="relative ms-auto h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase text-slate-400">{t("detailsHistory")}</div>
            <h3 className="text-base font-bold text-slate-800 break-all">{spec.title}</h3>
          </div>
          <div className="flex items-center gap-2">
            <ExportButton name={`history-${spec.keyValue.slice(0, 30)}`} rows={rows ?? []} />
            <button className="btn-secondary !p-2" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
        </div>

        {!rows ? (
          <Spinner />
        ) : !rows.length ? (
          <p className="text-sm text-slate-500">{t("noData")}</p>
        ) : (
          <div className="space-y-5">
            {numericCols.length > 0 && (
              <TrendChart
                data={rows as unknown as Record<string, unknown>[]}
                xKey="month"
                series={numericCols.slice(0, 2).map((k, i) => ({ key: k, name: k, color: i ? "#f59e0b" : "#2563eb" }))}
                height={190}
              />
            )}
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{lang === "ar" ? "الشهر" : "Month"}</th>
                    {numericCols.map((k) => (
                      <th key={k} className="text-xs">{k.replace(/_/g, " ")}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="font-semibold" dir="ltr">{String(r.month)}</td>
                      {numericCols.map((k) => (
                        <td key={k}>{formatNumber(Number(r[k] ?? 0))}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {spec.campaign && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase text-slate-500">{t("matchedOrders")}</h4>
                  <ExportButton name={`orders-${spec.campaign.slice(0, 30)}`} rows={orders ?? []} />
                </div>
                {!orders ? (
                  <Spinner />
                ) : (
                  <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>{t("orderNumber")}</th>
                          <th>{t("status")}</th>
                          <th>{t("amount")}</th>
                          <th>{t("city")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((o, i) => (
                          <tr key={i}>
                            <td className="font-bold text-brand-700" dir="ltr">#{String(o.order_number)}</td>
                            <td className="text-xs">{String(o.order_status ?? "—")}</td>
                            <td>{formatMoney(Number(o.total_order_amount ?? 0), lang)}</td>
                            <td className="text-xs">{String(o.city ?? "—")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function useDetail() {
  const [spec, setSpec] = useState<DetailSpec | null>(null);
  return { spec, setSpec };
}

// ------------------------------------------------------------ alarms panel

interface Alarm {
  kind: string;
  severity: "red" | "amber" | "info";
  data: Record<string, string | number>;
}

// Loaded once by the Traffic page so the tab can show a count badge without
// rendering the whole panel on every tab.
export function useTrafficAlarms() {
  const supabase = useMemo(() => createClient(), []);
  const [alarms, setAlarms] = useState<Alarm[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("fn_traffic_alarms").then(({ data, error }) => {
      if (cancelled) return;
      if (error) setError(error.message);
      setAlarms((data as Alarm[]) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return { alarms, error };
}

export function TrafficAlarms({ alarms, error }: { alarms: Alarm[] | null; error?: string | null }) {
  const { t } = useLang();

  const text = (a: Alarm): string => {
    const d = a.data;
    const n = (v: unknown) => formatNumber(Number(v ?? 0));
    switch (a.kind) {
      case "dead_spend":
        return fillVars(t("alarmDeadSpend"), { name: String(d.name), spend: n(d.spend) });
      case "low_roas":
        return fillVars(t("alarmLowRoas"), { name: String(d.name), spend: n(d.spend), revenue: n(d.revenue) });
      case "traffic_anomaly":
        return fillVars(t("alarmAnomaly"), { yesterday: n(d.yesterday), avg: n(d.avg) });
      case "oos_traffic":
        return fillVars(t("alarmOos"), { name: String(d.name), views: n(d.views) });
      case "conversion_collapse":
        return fillVars(t("alarmCollapse"), { name: String(d.name), cur: String(d.cur), prev: String(d.prev) });
      case "checkout_leak":
        return fillVars(t("alarmLeak"), { recent: String(d.recent), prior: String(d.prior) });
      case "rank_drop":
        return fillVars(t("alarmRankDrop"), { query: String(d.query), prev: String(d.prev), cur: String(d.cur) });
      case "rank_win":
        return fillVars(t("alarmRankWin"), { query: String(d.query), prev: String(d.prev), cur: String(d.cur) });
      case "city_delivery":
        return fillVars(t("alarmCityDel"), { city: String(d.city), cur: String(d.cur), prev: String(d.prev) });
      case "pace_driver": {
        const crCur = Number(d.o_cur) / Math.max(Number(d.s_cur), 1);
        const crPrev = Number(d.o_prev) / Math.max(Number(d.s_prev), 1);
        const aovCur = Number(d.r_cur) / Math.max(Number(d.o_cur), 1);
        const aovPrev = Number(d.r_prev) / Math.max(Number(d.o_prev), 1);
        const drops: [string, number][] = [
          [t("alarmDriverSessions"), Number(d.s_prev) > 0 ? Number(d.s_cur) / Number(d.s_prev) : 1],
          [t("alarmDriverCr"), crPrev > 0 ? crCur / crPrev : 1],
          [t("alarmDriverAov"), aovPrev > 0 ? aovCur / aovPrev : 1],
        ];
        drops.sort((x, y) => x[1] - y[1]);
        return fillVars(t("alarmPace"), { rc: n(d.r_cur), rp: n(d.r_prev), driver: drops[0][0] });
      }
      default:
        return a.kind;
    }
  };

  if (error) return <ErrorNote message={error} />;
  if (!alarms) return <Spinner />;

  const styles = {
    red: "border-red-200 bg-red-50 text-red-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    info: "border-brand-200 bg-brand-50 text-brand-800",
  };

  const order: Record<string, number> = { red: 0, amber: 1, info: 2 };
  const sorted = [...alarms].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
  const exportRows = sorted.map((a) => ({ kind: a.kind, severity: a.severity, detail: text(a) }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">{t("alarmsHint")}</p>
        <ExportButton name="traffic-alarms" rows={exportRows} />
      </div>
      {sorted.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          <CheckCircle2 size={16} />
          {t("alarmsOk")}
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {sorted.map((a, i) => (
            <div key={i} className={cn("rounded-xl border px-4 py-2.5 text-sm", styles[a.severity])}>
              {text(a)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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

// local parts, not toISOString — see the note in date-range.tsx
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const isoDaysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return isoLocal(d);
};

// 0 is the month-to-date option, the default everywhere
const MTD = 0;
const rangeStart = (days: number) => {
  if (days !== MTD) return isoDaysAgo(days - 1);
  const now = new Date();
  return isoLocal(new Date(now.getFullYear(), now.getMonth(), 1));
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
  const labels: Record<number, string> = { 0: t("thisMonth"), 7: t("last7"), 30: t("last30"), 60: t("last60"), 90: t("last90") };
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
  const [days, setDays] = useState(MTD);
  const [channels, setChannels] = useState<ChannelRow[] | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [quality, setQuality] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { spec, setSpec } = useDetail();

  useEffect(() => {
    let cancelled = false;
    setChannels(null);
    setError(null);
    const p_from = rangeStart(days);
    const p_to = isoDaysAgo(0);
    supabase.rpc("fn_channel_summary", { p_from, p_to }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setError(error.message);
      const d = (data ?? {}) as { channels?: ChannelRow[]; campaigns?: CampaignRow[] };
      setChannels(d.channels ?? []);
      setCampaigns(d.campaigns ?? []);
    });
    supabase.rpc("fn_channel_quality", { p_from, p_to }).then(({ data }) => {
      if (!cancelled) setQuality((data as Record<string, unknown>[]) ?? []);
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

  if (error) return <ErrorNote message={error} />;
  if (!channels) return <Spinner />;
  if (!channels.length)
    return <div className="card p-8 text-center text-sm text-slate-500">{t("noGrowthData")}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{t("channelsHint")}</p>
        <RangePicker value={days} onChange={setDays} options={[MTD, 7, 30, 90]} />
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

      <div className="flex justify-end">
        <ExportButton name="channels" rows={sortedChannels} />
      </div>
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
                <tr
                  key={`${c.source}|${c.medium}`}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() =>
                    setSpec({
                      title: `${c.source || "(direct)"} / ${c.medium || "—"}`,
                      table: "ga4_sources",
                      keyColumn: "source",
                      keyValue: c.source,
                      extraFilter: { medium: c.medium },
                      orderColumn: "date",
                    })
                  }
                >
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
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700">{t("campaigns")}</h3>
            <ExportButton name="campaigns-roi" rows={sortedCampaigns} />
          </div>
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
                    <tr
                      key={c.campaign}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() =>
                        setSpec({
                          title: c.campaign,
                          table: "ga4_sources",
                          keyColumn: "campaign",
                          keyValue: c.campaign,
                          orderColumn: "date",
                          campaign: c.campaign,
                        })
                      }
                    >
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

      {quality.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-700">{t("channelQuality")}</h3>
              <p className="text-xs text-slate-500">{t("channelQualityHint")}</p>
            </div>
            <ExportButton name="channel-quality" rows={quality} />
          </div>
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t("channelLbl")}</th>
                  <th>{t("customers")}</th>
                  <th>{t("repeatCustomers")}</th>
                  <th>%</th>
                  <th>{t("orders")}</th>
                  <th>{t("grossRevenue")}</th>
                </tr>
              </thead>
              <tbody>
                {quality.map((r, i) => {
                  const customers = Number(r.customers ?? 0);
                  const repeat = Number(r.repeat_customers ?? 0);
                  const pct = customers > 0 ? (repeat / customers) * 100 : 0;
                  return (
                    <tr key={i}>
                      <td dir="ltr" className="font-medium text-xs">{String(r.source)}</td>
                      <td className="font-semibold">{formatNumber(customers)}</td>
                      <td>{formatNumber(repeat)}</td>
                      <td className={cn("font-bold", pct >= 25 ? "text-emerald-600" : pct < 10 ? "text-red-600" : "text-amber-600")}>
                        {pct.toFixed(0)}%
                      </td>
                      <td>{formatNumber(Number(r.orders ?? 0))}</td>
                      <td>{formatMoney(Number(r.revenue ?? 0), lang)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DetailDrawer spec={spec} onClose={() => setSpec(null)} />
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
  const [days, setDays] = useState(MTD);
  const [rows, setRows] = useState<DailyRow[] | null>(null);
  const [funnelExtra, setFunnelExtra] = useState<FunnelTotals | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    const p_from = rangeStart(days);
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
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">{t("healthHint")}</p>
        <div className="flex items-center gap-2">
          <ExportButton name="tracking-daily" rows={rows} />
          <RangePicker value={days} onChange={setDays} options={[MTD, 30, 60, 90]} />
        </div>
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
  const [daily, setDaily] = useState<GscDailyRow[] | null>(null);
  const [month, setMonth] = useState(months[0] ?? "");
  const [queries, setQueries] = useState<GscTermRow[]>([]);
  const [pages, setPages] = useState<GscTermRow[]>([]);
  const [nearWins, setNearWins] = useState<GscTermRow[]>([]);
  const { spec, setSpec } = useDetail();

  // one control: the selected month drives KPIs, chart and every table
  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    setDaily(null);
    const start = new Date(month);
    const monthEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);
    supabase
      .from("gsc_daily")
      .select("date, clicks, impressions, position")
      .gte("date", month)
      .lte("date", monthEnd)
      .order("date")
      .then(({ data }) => {
        if (!cancelled) setDaily((data as GscDailyRow[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, month]);

  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    Promise.all([
      supabase.from("gsc_queries").select("query, clicks, impressions, ctr, position").eq("period_month", month).order("clicks", { ascending: false }).limit(50),
      supabase.from("gsc_pages").select("page, clicks, impressions, ctr, position").eq("period_month", month).order("clicks", { ascending: false }).limit(25),
      supabase.from("gsc_queries").select("query, clicks, impressions, ctr, position").eq("period_month", month).gte("position", 5).lte("position", 15).order("impressions", { ascending: false }).limit(30),
    ]).then(([q, p, w]) => {
      if (cancelled) return;
      setQueries((q.data as GscTermRow[]) ?? []);
      setPages((p.data as GscTermRow[]) ?? []);
      setNearWins((w.data as GscTermRow[]) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, month]);

  const monthPicker = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-slate-500">{t("seoHint")}</p>
      <select className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)}>
        {months.map((m) => (
          <option key={m} value={m}>
            {new Date(m).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}
          </option>
        ))}
      </select>
    </div>
  );

  if (!daily)
    return (
      <div className="space-y-6">
        {monthPicker}
        <Spinner />
      </div>
    );
  if (!daily.length && !queries.length)
    return (
      <div className="space-y-6">
        {monthPicker}
        <div className="card p-8 text-center text-sm text-slate-500">{t("seoSetupHint")}</div>
      </div>
    );

  const totals = {
    clicks: daily.reduce((s, r) => s + (r.clicks ?? 0), 0),
    impressions: daily.reduce((s, r) => s + (r.impressions ?? 0), 0),
    position:
      daily.length > 0
        ? daily.reduce((s, r) => s + (r.position ?? 0), 0) / daily.filter((r) => r.position != null).length
        : 0,
  };

  const gscTable = (rows: GscTermRow[], keyName: "query" | "page", title: string, hint?: string) =>
    rows.length > 0 && (
      <div className="card p-5">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700">{title}</h3>
          <ExportButton name={`${title.replace(/\s+/g, "-").slice(0, 30)}-${month.slice(0, 7)}`} rows={rows} />
        </div>
        {hint && <p className="mb-2 text-xs text-slate-500">{hint}</p>}
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
                  <tr
                    key={r[keyName]}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() =>
                      setSpec({
                        title: String(r[keyName]),
                        table: keyName === "query" ? "gsc_queries" : "gsc_pages",
                        keyColumn: keyName,
                        keyValue: String(r[keyName]),
                        orderColumn: "period_month",
                      })
                    }
                  >
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
      {monthPicker}

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

      {gscTable(nearWins, "query", t("nearWinsTitle"), t("nearWinsHint"))}
      {gscTable(queries, "query", t("googleQueries"))}
      {gscTable(pages, "page", t("gscPagesTitle"))}
      <DetailDrawer spec={spec} onClose={() => setSpec(null)} />
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
  const [hours, setHours] = useState<{ dow: number; hour: number; sessions: number | null; purchases: number | null }[]>([]);
  const { spec, setSpec } = useDetail();

  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const monthEnd = new Date(new Date(month).getFullYear(), new Date(month).getMonth() + 1, 0)
        .toISOString()
        .slice(0, 10);
      const [te, ci, de, la, co, hr] = await Promise.all([
        supabase.from("ga4_search_terms").select("term, sessions, searches").eq("period_month", month).order("searches", { ascending: false }).limit(100),
        supabase.from("ga4_cities").select("city, sessions, purchases, revenue").eq("period_month", month).order("sessions", { ascending: false }).limit(40),
        supabase.from("ga4_devices").select("device, sessions, add_to_carts, purchases, revenue").eq("period_month", month),
        supabase.from("ga4_landing").select("landing_page, sessions, bounce_rate, purchases").eq("period_month", month).order("sessions", { ascending: false }).limit(25),
        supabase.rpc("fn_orders_by_city", { p_from: month, p_to: monthEnd, p_limit: 100 }),
        supabase.from("ga4_hours").select("dow, hour, sessions, purchases").eq("period_month", month),
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
      setHours((hr.data as { dow: number; hour: number; sessions: number | null; purchases: number | null }[]) ?? []);
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

          {hours.length > 0 && (
            <div className="card p-5">
              <h3 className="mb-3 text-sm font-bold text-slate-700">{t("heatmapTitle")}</h3>
              {(() => {
                const max = Math.max(...hours.map((h) => Number(h.sessions ?? 0)), 1);
                const dows = lang === "ar"
                  ? ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"]
                  : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                const cell = new Map(hours.map((h) => [`${h.dow}|${h.hour}`, h]));
                return (
                  <div className="overflow-x-auto">
                    <div className="grid gap-0.5" style={{ gridTemplateColumns: "auto repeat(24, minmax(14px, 1fr))", minWidth: 620 }}>
                      <div />
                      {Array.from({ length: 24 }, (_, h) => (
                        <div key={h} className="text-center text-[9px] text-slate-400">{h}</div>
                      ))}
                      {dows.map((label, d) => (
                        <>
                          <div key={`l${d}`} className="pe-1 text-end text-[10px] font-semibold text-slate-500 leading-4">{label}</div>
                          {Array.from({ length: 24 }, (_, h) => {
                            const v = cell.get(`${d}|${h}`);
                            const s = Number(v?.sessions ?? 0);
                            const p = Number(v?.purchases ?? 0);
                            return (
                              <div
                                key={`${d}|${h}`}
                                title={`${label} ${h}:00 — ${formatNumber(s)} ${t("sessionsLbl")}, ${formatNumber(p)} ${t("ga4PurchasesLbl")}`}
                                className={cn("h-4 rounded-sm", p > 0 && s / max > 0.5 && "ring-1 ring-emerald-500")}
                                style={{ backgroundColor: `rgba(37, 99, 235, ${Math.max(s / max, 0.04)})` }}
                              />
                            );
                          })}
                        </>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {terms.length > 0 && (
            <div className="card p-5">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-700">{t("siteSearchTitle")}</h3>
                <ExportButton name={`site-search-${month.slice(0, 7)}`} rows={terms} />
              </div>
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
                      <tr
                        key={tr.term}
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() =>
                          setSpec({ title: tr.term, table: "ga4_search_terms", keyColumn: "term", keyValue: tr.term, orderColumn: "period_month" })
                        }
                      >
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
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-700">{t("cityGapTitle")}</h3>
                <ExportButton name={`cities-${month.slice(0, 7)}`} rows={cities} />
              </div>
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
                        <tr
                          key={c.city}
                          className="cursor-pointer hover:bg-slate-50"
                          onClick={() =>
                            setSpec({ title: c.city, table: "ga4_cities", keyColumn: "city", keyValue: c.city, orderColumn: "period_month" })
                          }
                        >
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
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-700">{t("landingTitle")}</h3>
                <ExportButton name={`landing-${month.slice(0, 7)}`} rows={landing} />
              </div>
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
                        <tr
                          key={l.landing_page}
                          className="cursor-pointer hover:bg-slate-50"
                          onClick={() =>
                            setSpec({ title: l.landing_page, table: "ga4_landing", keyColumn: "landing_page", keyValue: l.landing_page, orderColumn: "period_month" })
                          }
                        >
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
      <DetailDrawer spec={spec} onClose={() => setSpec(null)} />
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
  const { spec, setSpec } = useDetail();

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
        <div className="flex items-center gap-2">
          <ExportButton name={`product-matrix-${month.slice(0, 7)}`} rows={visible} />
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

      <DetailDrawer spec={spec} onClose={() => setSpec(null)} />

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
                  <tr
                    key={r.name}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() =>
                      setSpec({ title: r.name, table: "ga4_items", keyColumn: "item_name", keyValue: r.name, orderColumn: "period_month" })
                    }
                  >
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
