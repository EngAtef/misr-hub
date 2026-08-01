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

export function HealthReport() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [days, setDays] = useState(60);
  const [rows, setRows] = useState<DailyRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    supabase
      .rpc("fn_tracking_daily", { p_from: isoDaysAgo(days - 1), p_to: isoDaysAgo(0) })
      .then(({ data }) => {
        if (!cancelled) setRows((data as DailyRow[]) ?? []);
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
