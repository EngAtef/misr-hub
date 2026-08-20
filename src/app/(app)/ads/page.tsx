"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import {
  UploadCloud,
  Download,
  Settings2,
  RefreshCw,
  X,
  Info,
  ChevronDown,
  Trash2,
  ListTree,
  ExternalLink,
  FileSpreadsheet,
  TrendingUp,
  TrendingDown,
  Lightbulb,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner, EmptyState, KpiCard, SortTh, useSort, ChartCard } from "@/components/ui";
import { MultiSelect } from "@/components/multi-select";
import { BarsChart, DonutChart } from "@/components/charts";
import { AdsImportDialog } from "@/components/ads-import-dialog";
import { AdsMapping } from "@/components/ads-mapping";
import { AdsLists } from "@/components/ads-lists";
import { AdsBackfill } from "@/components/ads-backfill";
import { ProductDrawer } from "@/components/product-drawer";
import { formatMoney, formatNumber, toCsv, downloadCsv, cn } from "@/lib/utils";
import { AD } from "@/lib/ads/strings";
import { DEFAULT_AD_SETTINGS, totals, groupBy, type AdRow, type AdPeriod, type AdSettings } from "@/lib/ads/types";
import {
  diagnose,
  computeBenchmarks,
  breakevenRoas,
  portfolioInsights,
  VERDICT_META,
  BOTTLENECK_LABEL,
  type Verdict,
} from "@/lib/ads/diagnose";
import { buildAdsWorkbook, downloadWorkbook, adRowsForExport } from "@/lib/ads/export";
import { confirmDialog } from "@/components/dialog";

type Tab =
  | "overview"
  | "ads"
  | "campaigns"
  | "adsets"
  | "books"
  | "lists"
  | "gap"
  | "funnel"
  | "compare"
  | "mapping"
  | "imports";

const TABS: { key: Tab; label: keyof typeof AD }[] = [
  { key: "overview", label: "tabOverview" },
  { key: "ads", label: "tabAds" },
  { key: "campaigns", label: "tabCampaigns" },
  { key: "adsets", label: "tabAdsets" },
  { key: "books", label: "tabBooks" },
  { key: "lists", label: "tabLists" },
  { key: "gap", label: "tabGap" },
  { key: "funnel", label: "tabFunnel" },
  { key: "compare", label: "tabCompare" },
  { key: "mapping", label: "tabMapping" },
  { key: "imports", label: "tabImports" },
];

// fn_ads_gap — one row per advertised book, three witnesses side by side
interface GapRow {
  book_label: string;
  campaigns: string[] | null;
  ads: number;
  spend: number;
  meta_purchases: number;
  meta_value: number;
  meta_roas: number | null;
  ga4_sessions: number | null;
  ga4_atc: number | null;
  ga4_purchases: number | null;
  ga4_revenue: number | null;
  ga4_tracked_orders: number | null;
  ga4_tracked_revenue: number | null;
  store_orders: number;
  store_units: number;
  store_revenue: number;
  store_net_revenue: number;
  store_cancelled: number;
  actual_roas: number | null;
  claim_vs_reality: number | null;
  purchases_vs_orders: number | null;
  verdict: "impossible" | "inflated" | "plausible";
  gsc_clicks: number | null;
  gsc_impressions: number | null;
}

interface Blended {
  spend: number;
  store_orders: number;
  store_revenue: number;
  store_net_revenue: number;
  mer: number | null;
  net_mer: number | null;
  cac: number | null;
  aov: number | null;
  spend_share_of_revenue: number | null;
  meta_value: number;
}

interface TopProduct {
  sku: string;
  product_name: string;
  units: number;
  revenue: number;
}

export default function AdsPage() {
  const { lang } = useLang();
  const tx = useCallback((v: { ar: string; en: string }) => v[lang], [lang]);
  const supabase = useMemo(() => createClient(), []);

  const [periods, setPeriods] = useState<AdPeriod[]>([]);
  const [rows, setRows] = useState<AdRow[]>([]);
  const [settings, setSettings] = useState<AdSettings>(DEFAULT_AD_SETTINGS);
  const [blended, setBlended] = useState<Blended | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncNote, setSyncNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [gapRows, setGapRows] = useState<GapRow[]>([]);
  const [gapLoading, setGapLoading] = useState(false);
  const [drawerSku, setDrawerSku] = useState<{ sku: string; name?: string | null; stock?: number | null } | null>(null);

  // ------------------------------------------------------------- filters
  const [selPeriods, setSelPeriods] = useState<string[]>([]);
  const [selAccounts, setSelAccounts] = useState<string[]>([]);
  const [selCampaigns, setSelCampaigns] = useState<string[]>([]);
  const [selAdsets, setSelAdsets] = useState<string[]>([]);
  const [selAds, setSelAds] = useState<string[]>([]);
  const [selBooks, setSelBooks] = useState<string[]>([]);
  const [selStatus, setSelStatus] = useState<string[]>([]);
  const [selVerdicts, setSelVerdicts] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [minSpend, setMinSpend] = useState("");
  const [cmpA, setCmpA] = useState("");
  const [cmpB, setCmpB] = useState("");

  const { sort, toggle, apply } = useSort<AdRow>();

  // ---------------------------------------------------------------- load
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [p, r, s] = await Promise.all([
      supabase.rpc("fn_ads_periods"),
      supabase.rpc("fn_ads_insights", { p_from: null, p_to: null }),
      supabase.rpc("fn_ads_settings"),
    ]);
    // a failed RPC must never masquerade as "no data" — a Supabase timeout
    // returns an error with empty data, and silently showing the empty state
    // is exactly how the July import "disappeared" once already
    const failed = [p.error, r.error, s.error].find(Boolean);
    if (failed) setLoadError(failed.message);
    setPeriods((p.data as AdPeriod[]) ?? []);
    setRows((r.data as AdRow[]) ?? []);
    if (s.data) setSettings({ ...DEFAULT_AD_SETTINGS, ...(s.data as Partial<AdSettings>) });
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // land on the newest period so the page opens on "this month", not everything
  useEffect(() => {
    if (!periods.length || selPeriods.length) return;
    const newest = periods[0].period_key;
    setSelPeriods([newest]);
    setCmpA(newest);
    const older = periods.find((p) => p.period_key !== newest);
    if (older) setCmpB(older.period_key);
  }, [periods, selPeriods.length]);

  // ?campaign= deep link from the Overview alert feed
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("campaign");
    if (c) {
      setSelCampaigns([c]);
      setTab("ads");
    }
  }, []);

  // calendar window covered by the selected periods — drives store-wide numbers
  const win = useMemo(() => {
    const chosen = periods.filter((p) => !selPeriods.length || selPeriods.includes(p.period_key));
    if (!chosen.length) return null;
    return {
      from: chosen.reduce((m, p) => (p.period_start < m ? p.period_start : m), chosen[0].period_start),
      to: chosen.reduce((m, p) => (p.period_end > m ? p.period_end : m), chosen[0].period_end),
    };
  }, [periods, selPeriods]);

  useEffect(() => {
    if (!win) return;
    let cancelled = false;
    (async () => {
      const [b, tp] = await Promise.all([
        supabase.rpc("fn_ads_blended", { p_from: win.from, p_to: win.to }),
        supabase.rpc("fn_product_stats", {
          p_from: `${win.from}T00:00:00Z`,
          p_to: `${win.to}T23:59:59Z`,
          p_search: null,
          p_limit: 60,
        }),
      ]);
      if (cancelled) return;
      setBlended((b.data as Blended) ?? null);
      setTopProducts((tp.data as TopProduct[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, win]);

  // the gap reconciliation is a heavier query — fetch only when the tab opens
  useEffect(() => {
    if (tab !== "gap" || !win) return;
    let cancelled = false;
    setGapLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc("fn_ads_gap", { p_from: win.from, p_to: win.to });
      if (cancelled) return;
      if (error) setLoadError(error.message);
      setGapRows((data as GapRow[]) ?? []);
      setGapLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, tab, win]);

  // ------------------------------------------------------ derived filters
  const adRows = useMemo(() => rows.filter((r) => r.level === "ad"), [rows]);
  const bench = useMemo(() => computeBenchmarks(rows), [rows]);
  const be = useMemo(() => breakevenRoas(settings), [settings]);

  const inPeriod = useMemo(
    () => adRows.filter((r) => !selPeriods.length || selPeriods.includes(r.period_key)),
    [adRows, selPeriods]
  );

  const options = useMemo(
    () => ({
      accounts: Array.from(new Set(inPeriod.map((r) => r.account_label))).sort(),
      campaigns: Array.from(new Set(inPeriod.map((r) => r.campaign_name ?? "—"))).sort(),
      adsets: Array.from(new Set(inPeriod.map((r) => r.adset_name ?? "—"))).sort(),
      ads: Array.from(new Set(inPeriod.map((r) => r.ad_name ?? "—"))).sort(),
      books: Array.from(new Set(inPeriod.map((r) => r.book_label ?? "—"))).sort(),
      statuses: Array.from(new Set(inPeriod.map((r) => r.delivery_status ?? "—"))).sort(),
    }),
    [inPeriod]
  );

  const verdictOf = useCallback((r: AdRow) => diagnose(r, { settings, bench }), [settings, bench]);

  const filtered = useMemo(() => {
    const min = parseFloat(minSpend);
    const q = query.trim().toLowerCase();
    return inPeriod.filter((r) => {
      if (selAccounts.length && !selAccounts.includes(r.account_label)) return false;
      if (selCampaigns.length && !selCampaigns.includes(r.campaign_name ?? "—")) return false;
      if (selAdsets.length && !selAdsets.includes(r.adset_name ?? "—")) return false;
      if (selAds.length && !selAds.includes(r.ad_name ?? "—")) return false;
      if (selBooks.length && !selBooks.includes(r.book_label ?? "—")) return false;
      if (selStatus.length && !selStatus.includes(r.delivery_status ?? "—")) return false;
      if (!isNaN(min) && (r.spend ?? 0) < min) return false;
      if (q) {
        const hay = `${r.ad_name ?? ""} ${r.campaign_name ?? ""} ${r.adset_name ?? ""} ${r.book_label ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (selVerdicts.length && !selVerdicts.includes(verdictOf(r).verdict)) return false;
      return true;
    });
  }, [inPeriod, selAccounts, selCampaigns, selAdsets, selAds, selBooks, selStatus, selVerdicts, query, minSpend, verdictOf]);

  const agg = useMemo(() => totals(filtered), [filtered]);
  const insights = useMemo(
    () => portfolioInsights(filtered, agg, settings, blended?.store_revenue ?? null),
    [filtered, agg, settings, blended]
  );

  const filtersActive =
    selAccounts.length + selCampaigns.length + selAdsets.length + selAds.length + selBooks.length + selStatus.length + selVerdicts.length > 0 ||
    query.trim() !== "" ||
    minSpend !== "";

  function resetFilters() {
    setSelAccounts([]);
    setSelCampaigns([]);
    setSelAdsets([]);
    setSelAds([]);
    setSelBooks([]);
    setSelStatus([]);
    setSelVerdicts([]);
    setQuery("");
    setMinSpend("");
  }

  // ---------------------------------------------------------- roll-ups
  const campaignRows = useMemo(
    () => groupBy(filtered, (r) => r.campaign_name ?? "—").sort((a, b) => b.spend - a.spend),
    [filtered]
  );

  const adsetRows = useMemo(
    () => groupBy(filtered, (r) => `${r.campaign_name ?? "—"} › ${r.adset_name ?? "—"}`).sort((a, b) => b.spend - a.spend),
    [filtered]
  );

  const bookRows = useMemo(
    () =>
      groupBy(filtered, (r) => r.book_label)
        .map((g) => {
          // a book's real sales are shared by every ad on it within a period,
          // so count them once per period rather than once per ad
          const perPeriod = new Map<string, AdRow>();
          for (const r of g.rows) if (!perPeriod.has(r.period_key)) perPeriod.set(r.period_key, r);
          const demand = Array.from(perPeriod.values());
          const bookRevenue = demand.reduce((s, r) => s + (r.book_revenue ?? 0), 0);
          const bookOrders = demand.reduce((s, r) => s + (r.book_orders ?? 0), 0);
          const cancelled = demand.reduce((s, r) => s + (r.book_cancelled_orders ?? 0), 0);
          return {
            ...g,
            bookRevenue,
            bookOrders,
            cancelRate: bookOrders + cancelled > 0 ? (cancelled * 100) / (bookOrders + cancelled) : null,
            stock: demand[0]?.book_stock ?? null,
            skus: demand[0]?.book_skus ?? [],
            adCount: new Set(g.rows.map((r) => r.ad_name)).size,
          };
        })
        .sort((a, b) => b.spend - a.spend),
    [filtered]
  );

  // books selling with no ad behind them — the cheapest growth available
  const unadvertised = useMemo(() => {
    const advertised = new Set(adRows.flatMap((r) => r.book_skus ?? []));
    return topProducts.filter((p) => !advertised.has(p.sku)).slice(0, 12);
  }, [topProducts, adRows]);

  // ------------------------------------------------------------- compare
  const compareRows = useMemo(() => {
    if (!cmpA || !cmpB || cmpA === cmpB) return [];
    const build = (pk: string) => {
      const m = new Map<string, ReturnType<typeof totals> & { key: string }>();
      for (const g of groupBy(adRows.filter((r) => r.period_key === pk), (r) => r.ad_name ?? "—")) m.set(g.key, g);
      return m;
    };
    const a = build(cmpA);
    const b = build(cmpB);
    return Array.from(new Set([...a.keys(), ...b.keys()]))
      .map((name) => {
        const ca = a.get(name);
        const cb = b.get(name);
        return {
          name,
          spend_now: ca?.spend ?? 0,
          spend_prev: cb?.spend ?? 0,
          revenue_now: ca?.attRevenue ?? 0,
          revenue_prev: cb?.attRevenue ?? 0,
          roas_now: ca?.actualRoas ?? null,
          roas_prev: cb?.actualRoas ?? null,
          state: !cb ? "new" : !ca ? "stopped" : "both",
        };
      })
      .sort((p, q) => q.spend_now + q.spend_prev - (p.spend_now + p.spend_prev));
  }, [adRows, cmpA, cmpB]);

  /** Pulls every selected ad account for the current month, one request each —
   *  eight accounts in a single call would exceed the function's 60s ceiling. */
  async function syncFromMeta() {
    setSyncNote(null);
    setSyncing(tx(AD.syncing));
    try {
      const { data: cfg } = await supabase.rpc("fn_meta_ads_config");
      const c = (cfg ?? {}) as { has_token?: boolean; accounts?: { accounts?: { id: string; label: string; enabled: boolean }[] } };
      if (!c.has_token) {
        setSyncNote({ kind: "err", text: tx(AD.syncNotConnected) });
        setSyncing(null);
        return;
      }
      const targets = (c.accounts?.accounts ?? []).filter((a) => a.enabled);
      if (!targets.length) {
        setSyncNote({ kind: "err", text: tx(AD.syncNoAccounts) });
        setSyncing(null);
        return;
      }

      const done: string[] = [];
      const failed: string[] = [];
      for (const [i, acct] of targets.entries()) {
        setSyncing(`${tx(AD.syncing)} ${i + 1}/${targets.length} · ${acct.label}`);
        const res = await fetch("/api/meta-ads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync", accountId: acct.id }),
        });
        const j = await res.json().catch(() => ({}));
        if (res.ok) {
          const r = j.result as { label: string; adRows: number; spend: number };
          done.push(`${r.label}: ${formatNumber(r.adRows)} ${tx(AD.ads)} · ${formatMoney(r.spend, lang)}`);
        } else {
          failed.push(`${acct.label}: ${[j.error, j.hint].filter(Boolean).join(" — ")}`);
        }
      }
      setSyncNote({
        kind: failed.length ? "err" : "ok",
        text: [...done, ...failed].join(" | ") || tx(AD.syncDone),
      });
      await load();
    } catch (e) {
      setSyncNote({ kind: "err", text: e instanceof Error ? e.message : "sync failed" });
    }
    setSyncing(null);
  }

  // ------------------------------------------------------------- exports
  function exportWorkbook() {
    const wb = buildAdsWorkbook(filtered, settings, lang, blended as unknown as Record<string, number | null>);
    downloadWorkbook(wb, `ads-report-${win ? `${win.from}_${win.to}` : new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportCurrentCsv() {
    const strip = <T extends { rows: unknown }>(g: T) => {
      const { rows: _drop, ...rest } = g;
      return rest as Record<string, unknown>;
    };
    let data: Record<string, unknown>[];
    let name: string;
    if (tab === "campaigns") {
      data = campaignRows.map(strip);
      name = "ads-campaigns";
    } else if (tab === "adsets") {
      data = adsetRows.map(strip);
      name = "ads-adsets";
    } else if (tab === "books") {
      data = bookRows.map(strip);
      name = "ads-books";
    } else if (tab === "compare") {
      data = compareRows as unknown as Record<string, unknown>[];
      name = "ads-compare";
    } else if (tab === "gap") {
      data = gapRows.map((r) => ({ ...r, campaigns: (r.campaigns ?? []).join(" | ") }));
      name = "ads-gap-meta-vs-reality";
    } else {
      data = adRowsForExport(filtered, settings, bench, lang) as unknown as Record<string, unknown>[];
      name = "ads-detail";
    }
    if (!data.length) return;
    downloadCsv(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(data));
  }

  // ------------------------------------------------------------ helpers
  const money = (v: number | null | undefined) => formatMoney(v ?? 0, lang);
  const roasClass = (v: number | null) =>
    v === null
      ? "text-slate-400"
      : v >= settings.target_roas
      ? "text-emerald-600"
      : v >= be
      ? "text-teal-600"
      : v >= be * 0.5
      ? "text-amber-600"
      : "text-red-600";
  const num2 = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? "—" : `${v.toFixed(2)}${suffix}`);
  const num1 = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? "—" : `${v.toFixed(1)}${suffix}`);

  const sortedAds = useMemo(
    () =>
      apply(filtered, {
        ad: (r) => r.ad_name,
        book: (r) => r.book_label,
        spend: (r) => r.spend,
        cpm: (r) => r.cpm,
        ctr: (r) => r.ctr_all,
        clicks: (r) => r.link_clicks,
        atc: (r) => r.adds_to_cart,
        metaRoas: (r) => r.reported_roas,
        attRevenue: (r) => r.att_revenue,
        actualRoas: (r) => r.actual_roas,
        cpa: (r) => r.actual_cpa,
        score: (r) => verdictOf(r).score,
      }),
    [filtered, apply, verdictOf]
  );

  // ads that can honestly be ranked against each other
  const rankable = useMemo(
    () =>
      filtered
        .filter((r) => r.actual_roas !== null && (r.spend ?? 0) >= settings.min_spend)
        .sort((a, b) => (b.actual_roas ?? 0) - (a.actual_roas ?? 0)),
    [filtered, settings.min_spend]
  );

  const verdictMix = useMemo(() => {
    const counts = new Map<Verdict, number>();
    for (const r of filtered) {
      const v = verdictOf(r).verdict;
      counts.set(v, (counts.get(v) ?? 0) + (r.spend ?? 0));
    }
    return Array.from(counts.entries())
      .map(([v, spend]) => ({ name: VERDICT_META[v].label[lang], spend: Math.round(spend) }))
      .filter((d) => d.spend > 0);
  }, [filtered, verdictOf, lang]);

  const funnelStages = useMemo(
    () => [
      { key: "impr", label: tx(AD.stageImpr), value: agg.impressions },
      { key: "clicks", label: tx(AD.stageClicks), value: agg.clicks },
      { key: "lpv", label: tx(AD.stageLpv), value: agg.lpv },
      { key: "atc", label: tx(AD.stageAtc), value: agg.atc },
      { key: "ic", label: tx(AD.stageIc), value: agg.ic },
      { key: "purchase", label: tx(AD.stagePurchase), value: agg.metaPurchases },
    ],
    [agg, tx]
  );

  const periodChart = useMemo(
    () =>
      groupBy(adRows, (r) => r.period_key)
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((g) => ({
          name: g.key.split("_")[0],
          [tx(AD.spend)]: Math.round(g.spend),
          [tx(AD.attRevenue)]: Math.round(g.attRevenue),
          [tx(AD.metaValue)]: Math.round(g.metaValue),
        })),
    [adRows, tx]
  );

  const selDays = useMemo(() => {
    const chosen = periods.filter((p) => !selPeriods.length || selPeriods.includes(p.period_key));
    return Math.max(1, ...chosen.map((p) => p.days));
  }, [periods, selPeriods]);

  // the three account files share one reporting period, so fn_ads_periods
  // returns the same period_key three times — the filter offers it once
  const periodOptions = useMemo(() => {
    const seen = new Map<string, { label: string; accounts: number }>();
    for (const p of periods) {
      const cur = seen.get(p.period_key);
      if (cur) cur.accounts += 1;
      else seen.set(p.period_key, { label: p.period_label, accounts: 1 });
    }
    return Array.from(seen.entries()).map(([key, v]) => ({ key, ...v }));
  }, [periods]);

  if (loading) return <Spinner />;

  const hasData = periods.length > 0;
  // the ad-level filters don't apply to tabs that aggregate outside ad rows
  const showFilters = !["mapping", "imports", "compare", "lists"].includes(tab);

  return (
    <div>
      <PageHeader
        title={tx(AD.title)}
        subtitle={tx(AD.subtitle)}
        actions={
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => setSettingsOpen(true)}>
              <Settings2 size={16} />
              {tx(AD.settings)}
            </button>
            {hasData && (
              <>
                <button className="btn-secondary" onClick={exportCurrentCsv}>
                  <Download size={16} />
                  {tx(AD.exportCsv)}
                </button>
                <button className="btn-secondary" onClick={exportWorkbook}>
                  <FileSpreadsheet size={16} />
                  {tx(AD.exportReport)}
                </button>
              </>
            )}
            <button className="btn-secondary" onClick={() => setImportOpen(true)}>
              <UploadCloud size={16} />
              {tx(AD.import)}
            </button>
            <button className="btn-primary" onClick={syncFromMeta} disabled={syncing !== null}>
              <RefreshCw size={16} className={cn(syncing !== null && "animate-spin")} />
              {syncing ?? tx(AD.syncMeta)}
            </button>
          </div>
        }
      />

      {syncNote && (
        <div
          className={cn(
            "mb-5 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm",
            syncNote.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"
          )}
        >
          <span className="min-w-0 flex-1">{syncNote.text}</span>
          <button className="rounded p-0.5 opacity-60 hover:opacity-100" onClick={() => setSyncNote(null)}>
            <X size={15} />
          </button>
        </div>
      )}

      {loadError && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-semibold">{tx(AD.loadError)}</span>
          <span className="text-xs opacity-70" dir="ltr">{loadError}</span>
          <button className="btn-secondary !py-1 text-xs ms-auto" onClick={load}>
            {tx(AD.retry)}
          </button>
        </div>
      )}

      {!hasData ? (
        <div
          onClick={() => setImportOpen(true)}
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 p-12 text-center hover:border-brand-400 hover:bg-slate-50"
        >
          <UploadCloud className="h-12 w-12 text-brand-500" />
          <div className="font-semibold text-slate-700">{tx(AD.emptyTitle)}</div>
          <div className="max-w-lg text-sm text-slate-500">{tx(AD.emptyHint)}</div>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 w-fit">
            {TABS.map((item) => (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={cn(
                  "rounded-lg px-3.5 py-2 text-sm font-semibold transition",
                  tab === item.key ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
                )}
              >
                {tx(AD[item.label])}
              </button>
            ))}
          </div>

          {showFilters && (
            <div className="card mb-5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <MultiSelect
                  options={periodOptions.map((p) => p.key)}
                  values={selPeriods}
                  onChange={setSelPeriods}
                  placeholder={tx(AD.period)}
                  getLabel={(v) => {
                    const p = periodOptions.find((x) => x.key === v);
                    if (!p) return v;
                    return p.accounts > 1 ? `${p.label} · ${p.accounts} ${tx(AD.accounts)}` : p.label;
                  }}
                  className="min-w-[190px]"
                />
                <MultiSelect options={options.accounts} values={selAccounts} onChange={setSelAccounts} placeholder={tx(AD.account)} className="min-w-[140px]" />
                <MultiSelect options={options.campaigns} values={selCampaigns} onChange={setSelCampaigns} placeholder={tx(AD.campaign)} className="min-w-[160px]" />
                <MultiSelect options={options.adsets} values={selAdsets} onChange={setSelAdsets} placeholder={tx(AD.adset)} className="min-w-[150px]" />
                <MultiSelect options={options.ads} values={selAds} onChange={setSelAds} placeholder={tx(AD.ad)} className="min-w-[150px]" />
                <MultiSelect options={options.books} values={selBooks} onChange={setSelBooks} placeholder={tx(AD.book)} className="min-w-[150px]" />
                <MultiSelect options={options.statuses} values={selStatus} onChange={setSelStatus} placeholder={tx(AD.status)} className="min-w-[140px]" />
                <MultiSelect
                  options={Object.keys(VERDICT_META)}
                  values={selVerdicts}
                  onChange={setSelVerdicts}
                  placeholder={tx(AD.verdict)}
                  getLabel={(v) => VERDICT_META[v as Verdict].label[lang]}
                  className="min-w-[140px]"
                />
                <input className="input !py-1.5 w-[210px] text-sm" placeholder={tx(AD.search)} value={query} onChange={(e) => setQuery(e.target.value)} />
                <input
                  className="input !py-1.5 w-[120px] text-sm"
                  type="number"
                  min={0}
                  placeholder={tx(AD.minSpend)}
                  value={minSpend}
                  onChange={(e) => setMinSpend(e.target.value)}
                />
                {filtersActive && (
                  <button className="btn-secondary !py-1.5 text-xs" onClick={resetFilters}>
                    <X size={13} />
                    {tx(AD.reset)}
                  </button>
                )}
                <span className="ms-auto text-xs text-slate-500">
                  {tx(AD.showing)} {formatNumber(filtered.length)} / {formatNumber(inPeriod.length)} {tx(AD.ads)}
                </span>
              </div>
            </div>
          )}

          {showFilters && (
            <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
              <KpiCard
                label={tx(AD.spend)}
                value={money(agg.spend)}
                accent="red"
                sub={`${money(agg.spend / selDays)} / ${lang === "ar" ? "يوم" : "day"}`}
              />
              <KpiCard
                label={tx(AD.attRevenue)}
                value={money(agg.attRevenue)}
                accent="green"
                sub={`${formatNumber(Math.round(agg.attOrders))} ${lang === "ar" ? "طلب" : "orders"}`}
              />
              <KpiCard
                label={tx(AD.actualRoas)}
                value={num2(agg.actualRoas, "x")}
                accent={agg.actualRoas && agg.actualRoas >= settings.target_roas ? "green" : agg.actualRoas && agg.actualRoas >= be ? "amber" : "red"}
                sub={`${tx(AD.breakeven)} ${be.toFixed(2)}x`}
              />
              <KpiCard label={tx(AD.metaRoas)} value={num2(agg.metaRoas, "x")} accent="slate" sub={money(agg.metaValue)} />
              <KpiCard
                label={tx(AD.mer)}
                value={num2(blended?.mer ?? null, "x")}
                accent={(blended?.mer ?? 0) >= 4 ? "green" : "amber"}
                sub={blended ? `${money(blended.store_revenue)} ${lang === "ar" ? "إيراد المتجر" : "store revenue"}` : undefined}
              />
              <KpiCard
                label={tx(AD.blendedCac)}
                value={money(blended?.cac ?? 0)}
                accent="brand"
                sub={blended ? `${tx(AD.spendShare)} ${num1(blended.spend_share_of_revenue, "%")}` : undefined}
              />
            </div>
          )}

          {/* ==================================================== OVERVIEW */}
          {tab === "overview" && (
            <div className="space-y-6">
              {insights.length > 0 && (
                <div className="card p-5">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
                    <Lightbulb size={15} className="text-amber-500" />
                    {tx(AD.whatToDo)}
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {insights.map((ins) => (
                      <div
                        key={ins.code}
                        className={cn(
                          "rounded-xl border p-4",
                          ins.severity === "red"
                            ? "border-red-200 bg-red-50"
                            : ins.severity === "amber"
                            ? "border-amber-200 bg-amber-50"
                            : ins.severity === "good"
                            ? "border-emerald-200 bg-emerald-50"
                            : "border-slate-200 bg-slate-50"
                        )}
                      >
                        <div className="text-sm font-bold text-slate-800">{tx(ins.title)}</div>
                        <div className="mt-1 text-xs text-slate-600">{tx(ins.detail)}</div>
                        <div className="mt-2 text-xs font-semibold text-slate-700">→ {tx(ins.action)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-5 lg:grid-cols-3">
                <ChartCard title={tx(AD.spendVsRevenue)} className="lg:col-span-2">
                  <BarsChart
                    data={periodChart}
                    xKey="name"
                    series={[
                      { key: tx(AD.spend), name: tx(AD.spend), color: "#ef4444" },
                      { key: tx(AD.attRevenue), name: tx(AD.attRevenue), color: "#10b981" },
                      { key: tx(AD.metaValue), name: tx(AD.metaValue), color: "#cbd5e1" },
                    ]}
                    height={280}
                  />
                </ChartCard>
                <ChartCard title={tx(AD.verdictMix)}>
                  <DonutChart data={verdictMix} nameKey="name" valueKey="spend" height={280} />
                </ChartCard>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                {[
                  {
                    title: tx(AD.winners),
                    Icon: TrendingUp,
                    tone: "text-emerald-600",
                    // both lists ignore unmeasurable ads (no book mapped) and
                    // anything under the reading threshold — a 40 EGP ad with
                    // one lucky order would otherwise top the winners
                    list: rankable.sort((a, b) => (b.actual_roas ?? 0) - (a.actual_roas ?? 0)).slice(0, 6),
                  },
                  {
                    title: tx(AD.losers),
                    Icon: TrendingDown,
                    tone: "text-red-600",
                    list: [...rankable].reverse().slice(0, 6),
                  },
                ].map((box) => (
                  <div key={box.title} className="card p-5">
                    <h3 className={cn("mb-3 flex items-center gap-2 text-sm font-bold", box.tone)}>
                      <box.Icon size={15} />
                      {box.title}
                    </h3>
                    <table className="w-full text-sm">
                      <tbody>
                        {box.list.map((r) => (
                          <tr key={r.id} className="border-b border-slate-100 last:border-0">
                            <td className="py-2">
                              <div className="font-medium text-slate-800">{r.ad_name}</div>
                              <div className="text-[11px] text-slate-400">{r.book_label ?? r.campaign_name}</div>
                            </td>
                            <td className="py-2 text-end tabular-nums text-slate-500">{money(r.spend)}</td>
                            <td className={cn("py-2 text-end font-bold tabular-nums", roasClass(r.actual_roas))}>{num2(r.actual_roas, "x")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-xs leading-relaxed text-brand-900">
                <Info size={14} className="me-1.5 inline" />
                {tx(AD.attributionNote)} {tx(AD.levelNote)}
              </div>
            </div>
          )}

          {/* ========================================================= ADS */}
          {tab === "ads" && (
            <div className="card overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <SortTh label={tx(AD.ad)} k="ad" sort={sort} onToggle={toggle} />
                    <SortTh label={tx(AD.book)} k="book" sort={sort} onToggle={toggle} />
                    <SortTh label={tx(AD.spend)} k="spend" sort={sort} onToggle={toggle} />
                    <SortTh label={tx(AD.cpm)} k="cpm" sort={sort} onToggle={toggle} />
                    <SortTh label={tx(AD.ctr)} k="ctr" sort={sort} onToggle={toggle} />
                    <SortTh label={tx(AD.clicks)} k="clicks" sort={sort} onToggle={toggle} />
                    <SortTh label={tx(AD.atc)} k="atc" sort={sort} onToggle={toggle} />
                    <SortTh label={tx(AD.metaRoas)} k="metaRoas" sort={sort} onToggle={toggle} />
                    <SortTh label={tx(AD.attRevenue)} k="attRevenue" sort={sort} onToggle={toggle} />
                    <SortTh label={tx(AD.actualRoas)} k="actualRoas" sort={sort} onToggle={toggle} />
                    <SortTh label={tx(AD.cpa)} k="cpa" sort={sort} onToggle={toggle} />
                    <SortTh label={tx(AD.verdict)} k="score" sort={sort} onToggle={toggle} />
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAds.map((r) => {
                    const d = verdictOf(r);
                    const open = expanded === r.id;
                    return (
                      <Fragment key={r.id}>
                        <tr className={cn(open && "bg-slate-50")}>
                          <td className="!whitespace-normal max-w-[190px]">
                            <div className="font-medium">{r.ad_name ?? "—"}</div>
                            <div className="text-[11px] text-slate-400">
                              {r.campaign_name} · {r.adset_name}
                            </div>
                          </td>
                          <td className="!whitespace-normal max-w-[150px] text-xs">
                            {r.book_label ? (
                              <>
                                <div>{r.book_label}</div>
                                {/* a list-backed ad is measured on the whole
                                    list, so say so rather than let it read
                                    like a single book */}
                                {r.target_kind === "list" && (
                                  <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
                                    <ListTree size={9} />
                                    {formatNumber(r.list_items)} {tx(AD.listItems)}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-violet-500">{VERDICT_META.unmapped.label[lang]}</span>
                            )}
                          </td>
                          <td className="font-semibold">{money(r.spend)}</td>
                          <td className="text-slate-500">{num1(r.cpm)}</td>
                          <td className={cn(r.ctr_all !== null && r.ctr_all < bench.ctr * 0.7 && "font-semibold text-red-600")}>{num2(r.ctr_all, "%")}</td>
                          <td className="text-slate-500">{formatNumber(r.link_clicks)}</td>
                          <td className="text-slate-500">{formatNumber(r.adds_to_cart)}</td>
                          <td className="text-slate-400">{num2(r.reported_roas, "x")}</td>
                          <td className="font-semibold text-emerald-700">{money(r.att_revenue)}</td>
                          <td className={cn("font-bold", roasClass(r.actual_roas))}>{num2(r.actual_roas, "x")}</td>
                          <td>{money(r.actual_cpa)}</td>
                          <td>
                            <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-bold", VERDICT_META[d.verdict].className)}>
                              {VERDICT_META[d.verdict].label[lang]}
                            </span>
                          </td>
                          <td>
                            <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => setExpanded(open ? null : r.id)}>
                              <ChevronDown size={15} className={cn("transition", open && "rotate-180")} />
                            </button>
                          </td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={13} className="!whitespace-normal bg-slate-50 p-4">
                              <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
                                <div className="space-y-1.5 text-xs">
                                  {(
                                    [
                                      [tx(AD.impressions), formatNumber(r.impressions)],
                                      [tx(AD.reach), formatNumber(r.reach)],
                                      [tx(AD.frequency), num2(r.frequency)],
                                      [tx(AD.cpc), money(r.cpc)],
                                      [tx(AD.lpv), `${formatNumber(r.landing_page_views)} (${num1(r.lp_rate, "%")})`],
                                      [tx(AD.atc), `${formatNumber(r.adds_to_cart)} (${num1(r.atc_rate, "%")})`],
                                      [tx(AD.ic), `${formatNumber(r.checkouts_initiated)} (${num1(r.ic_rate, "%")})`],
                                      [tx(AD.metaPurchases), `${formatNumber(r.purchases)} (${num1(r.purchase_rate, "%")})`],
                                      [tx(AD.bookOrders), formatNumber(r.book_orders)],
                                      [tx(AD.bookDemand), money(r.book_revenue)],
                                      [tx(AD.share), num1((r.spend_share ?? 0) * 100, "%")],
                                      [tx(AD.cancelRate), num1(r.cancel_rate, "%")],
                                      [tx(AD.bookStock), r.book_stock === null ? "—" : formatNumber(r.book_stock)],
                                      [tx(AD.score), `${d.score}/100`],
                                    ] as [string, string][]
                                  ).map(([k, v]) => (
                                    <div key={k} className="flex justify-between gap-4 border-b border-slate-200/70 pb-1">
                                      <span className="text-slate-500">{k}</span>
                                      <span className="font-semibold text-slate-800">{v}</span>
                                    </div>
                                  ))}
                                </div>
                                <div className="space-y-2.5">
                                  {/* where this ad actually sends people */}
                                  {r.dest_url && (
                                    <a
                                      href={r.dest_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:border-brand-300 hover:text-brand-700"
                                      dir="ltr"
                                    >
                                      <ExternalLink size={12} className="shrink-0" />
                                      <span className="truncate">{r.dest_url}</span>
                                    </a>
                                  )}
                                  {d.reasons.length === 0 && (
                                    <div className="text-sm text-slate-500">
                                      {lang === "ar" ? "مفيش مشاكل واضحة في القمع." : "No obvious funnel problems."}
                                    </div>
                                  )}
                                  {d.reasons.map((reason) => (
                                    <div
                                      key={reason.code}
                                      className={cn(
                                        "rounded-lg border p-3",
                                        reason.severity === "red"
                                          ? "border-red-200 bg-red-50"
                                          : reason.severity === "amber"
                                          ? "border-amber-200 bg-amber-50"
                                          : reason.severity === "good"
                                          ? "border-emerald-200 bg-emerald-50"
                                          : "border-slate-200 bg-white"
                                      )}
                                    >
                                      <div className="text-sm font-bold text-slate-800">{tx(reason.title)}</div>
                                      <div className="mt-0.5 text-xs text-slate-600">{tx(reason.detail)}</div>
                                      <div className="mt-1.5 text-xs font-semibold text-slate-700">→ {tx(reason.action)}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ============================================ CAMPAIGNS / SETS */}
          {(tab === "campaigns" || tab === "adsets") && (
            <div className="card overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{tab === "campaigns" ? tx(AD.campaign) : tx(AD.adset)}</th>
                    <th>{tx(AD.ads)}</th>
                    <th>{tx(AD.spend)}</th>
                    <th>{tx(AD.cpm)}</th>
                    <th>{tx(AD.ctr)}</th>
                    <th>{tx(AD.clicks)}</th>
                    <th>{tx(AD.atc)}</th>
                    <th>{tx(AD.metaRoas)}</th>
                    <th>{tx(AD.attRevenue)}</th>
                    <th>{tx(AD.actualRoas)}</th>
                    <th>{tx(AD.cpa)}</th>
                  </tr>
                </thead>
                <tbody>
                  {(tab === "campaigns" ? campaignRows : adsetRows).map((g) => (
                    <tr key={g.key}>
                      <td className="!whitespace-normal max-w-[280px] font-medium">{g.key}</td>
                      <td className="text-slate-500">{g.rows.length}</td>
                      <td className="font-semibold">{money(g.spend)}</td>
                      <td className="text-slate-500">{num1(g.cpm)}</td>
                      <td>{num2(g.ctr, "%")}</td>
                      <td className="text-slate-500">{formatNumber(g.clicks)}</td>
                      <td className="text-slate-500">{formatNumber(g.atc)}</td>
                      <td className="text-slate-400">{num2(g.metaRoas, "x")}</td>
                      <td className="font-semibold text-emerald-700">{money(g.attRevenue)}</td>
                      <td className={cn("font-bold", roasClass(g.actualRoas))}>{num2(g.actualRoas, "x")}</td>
                      <td>{money(g.cpa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ======================================================= BOOKS */}
          {tab === "books" && (
            <div className="space-y-6">
              <div className="card overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{tx(AD.book)}</th>
                      <th>{tx(AD.ads)}</th>
                      <th>{tx(AD.spend)}</th>
                      <th>{tx(AD.bookOrders)}</th>
                      <th>{tx(AD.bookDemand)}</th>
                      <th>{tx(AD.actualRoas)}</th>
                      <th>{tx(AD.cpa)}</th>
                      <th>{tx(AD.cancelRate)}</th>
                      <th>{tx(AD.bookStock)}</th>
                      <th>{tx(AD.verdict)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookRows.map((g) => {
                      const roas = g.actualRoas;
                      const v: Verdict =
                        g.spend < settings.min_spend
                          ? "no_data"
                          : roas === null
                          ? "watch"
                          : roas >= settings.target_roas
                          ? "scale"
                          : roas >= be
                          ? "keep"
                          : roas >= be * 0.5
                          ? "fix"
                          : "kill";
                      return (
                        <tr key={g.key}>
                          <td className="!whitespace-normal max-w-[240px]">
                            <div className="font-medium">{g.key}</div>
                            {(g.skus?.length ?? 0) > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {(g.skus ?? []).slice(0, 3).map((sku) => (
                                  <button
                                    key={sku}
                                    dir="ltr"
                                    className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-brand-700 transition hover:bg-brand-100"
                                    onClick={() => setDrawerSku({ sku, name: g.key, stock: g.stock })}
                                  >
                                    {sku}
                                  </button>
                                ))}
                                {(g.skus?.length ?? 0) > 3 && (
                                  <span className="px-1 py-0.5 text-[10px] text-slate-400">+{(g.skus?.length ?? 0) - 3}</span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="text-slate-500">{g.adCount}</td>
                          <td className="font-semibold">{money(g.spend)}</td>
                          <td>{formatNumber(g.bookOrders)}</td>
                          <td className="font-semibold text-emerald-700">{money(g.bookRevenue)}</td>
                          <td className={cn("font-bold", roasClass(roas))}>{num2(roas, "x")}</td>
                          <td>{money(g.cpa)}</td>
                          <td className={cn((g.cancelRate ?? 0) > 15 && "font-semibold text-red-600")}>{num1(g.cancelRate, "%")}</td>
                          <td className={cn((g.stock ?? 1) <= 0 && "font-semibold text-red-600")}>{g.stock === null ? "—" : formatNumber(g.stock)}</td>
                          <td>
                            <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-bold", VERDICT_META[v].className)}>
                              {VERDICT_META[v].label[lang]}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="card p-5">
                <h3 className="text-sm font-bold text-slate-700">{tx(AD.booksOpportunity)}</h3>
                <p className="mt-1 text-xs text-slate-500">{tx(AD.booksOpportunityHint)}</p>
                <div className="mt-4 overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>{lang === "ar" ? "الكتاب" : "Book"}</th>
                        <th>SKU</th>
                        <th>{lang === "ar" ? "قطع مباعة" : "Units"}</th>
                        <th>{lang === "ar" ? "إيراد" : "Revenue"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unadvertised.map((p) => (
                        <tr
                          key={p.sku}
                          className="cursor-pointer"
                          onClick={() => setDrawerSku({ sku: p.sku, name: p.product_name })}
                        >
                          <td className="!whitespace-normal max-w-[320px] font-medium">{p.product_name}</td>
                          <td className="font-mono text-[11px] text-slate-400" dir="ltr">
                            {p.sku}
                          </td>
                          <td>{formatNumber(p.units)}</td>
                          <td className="font-semibold">{money(p.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= GAP */}
          {tab === "gap" &&
            (gapLoading ? (
              <Spinner />
            ) : (
              <div className="space-y-6">
                {(() => {
                  const g = {
                    metaValue: gapRows.reduce((s, r) => s + (r.meta_value ?? 0), 0),
                    metaPurch: gapRows.reduce((s, r) => s + (r.meta_purchases ?? 0), 0),
                    ga4Orders: gapRows.reduce((s, r) => s + (r.ga4_tracked_orders ?? 0), 0),
                    ga4Rev: gapRows.reduce((s, r) => s + (r.ga4_tracked_revenue ?? 0), 0),
                    storeRev: gapRows.reduce((s, r) => s + (r.store_revenue ?? 0), 0),
                    storeOrders: gapRows.reduce((s, r) => s + (r.store_orders ?? 0), 0),
                  };
                  const factor = g.storeRev > 0 ? g.metaValue / g.storeRev : null;
                  return (
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                      <KpiCard
                        label={tx(AD.gapMetaSays)}
                        value={money(g.metaValue)}
                        accent="slate"
                        sub={`${formatNumber(g.metaPurch)} ${tx(AD.gapClaimPurch)}`}
                      />
                      <KpiCard
                        label={tx(AD.gapGa4Says)}
                        value={money(g.ga4Rev)}
                        accent="brand"
                        sub={`${formatNumber(g.ga4Orders)} ${tx(AD.gapRealOrders)}`}
                      />
                      <KpiCard
                        label={tx(AD.gapReality)}
                        value={money(g.storeRev)}
                        accent="green"
                        sub={`${formatNumber(g.storeOrders)} ${tx(AD.gapRealOrders)}`}
                      />
                      <KpiCard
                        label={tx(AD.gapFactor)}
                        value={factor ? `×${factor.toFixed(2)}` : "—"}
                        accent={factor && factor > 1.5 ? "red" : "amber"}
                        sub={tx(AD.gapFactorHint)}
                      />
                    </div>
                  );
                })()}

                <div className="card p-5">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
                    <Info size={15} className="text-brand-500" />
                    {tx(AD.gapWhyTitle)}
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {[
                      { t: AD.gapReason1Title, d: AD.gapReason1 },
                      { t: AD.gapReason2Title, d: AD.gapReason2 },
                      { t: AD.gapReason3Title, d: AD.gapReason3 },
                      { t: AD.gapReason4Title, d: AD.gapReason4 },
                      { t: AD.gapReason5Title, d: AD.gapReason5 },
                    ].map((x0, i) => (
                      <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-sm font-bold text-slate-800">{tx(x0.t)}</div>
                        <div className="mt-1 text-xs leading-relaxed text-slate-600">{tx(x0.d)}</div>
                      </div>
                    ))}
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                      <div className="text-sm font-bold text-emerald-800">✓</div>
                      <div className="mt-1 text-xs leading-relaxed text-emerald-800">{tx(AD.gapHowToRead)}</div>
                    </div>
                  </div>
                </div>

                <ChartCard title={`${tx(AD.gapMetaSays)} / ${tx(AD.gapGa4Says)} / ${tx(AD.gapReality)}`}>
                  <BarsChart
                    data={[...gapRows]
                      .sort((a, b) => b.spend - a.spend)
                      .slice(0, 10)
                      .map((r) => ({
                        name: r.book_label.length > 22 ? r.book_label.slice(0, 22) + "…" : r.book_label,
                        [tx(AD.gapMetaSays)]: Math.round(r.meta_value),
                        [tx(AD.gapGa4Says)]: Math.round(r.ga4_tracked_revenue ?? 0),
                        [tx(AD.gapReality)]: Math.round(r.store_revenue),
                      }))}
                    xKey="name"
                    series={[
                      { key: tx(AD.gapMetaSays), name: tx(AD.gapMetaSays), color: "#94a3b8" },
                      { key: tx(AD.gapGa4Says), name: tx(AD.gapGa4Says), color: "#2b3990" },
                      { key: tx(AD.gapReality), name: tx(AD.gapReality), color: "#10b981" },
                    ]}
                    height={320}
                  />
                </ChartCard>

                <div className="card overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>{tx(AD.book)}</th>
                        <th>{tx(AD.spend)}</th>
                        <th>{tx(AD.gapClaimPurch)}</th>
                        <th>{tx(AD.gapMetaSays)}</th>
                        <th>{tx(AD.gapGa4Says)}</th>
                        <th>{tx(AD.gapRealOrders)}</th>
                        <th>{tx(AD.gapReality)}</th>
                        <th>{tx(AD.gapFactor)}</th>
                        <th>{tx(AD.gapOrganic)}</th>
                        <th>{tx(AD.verdict)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gapRows.map((r) => (
                        <tr key={r.book_label}>
                          <td className="!whitespace-normal max-w-[200px]">
                            <div className="font-medium">{r.book_label}</div>
                            <div className="text-[11px] text-slate-400">
                              {r.ads} {tx(AD.ads)} · {(r.campaigns ?? []).length} {tx(AD.gapCampaignsCol)}
                            </div>
                          </td>
                          <td className="font-semibold">{money(r.spend)}</td>
                          <td className="text-slate-500">
                            {formatNumber(r.meta_purchases)}
                            {r.purchases_vs_orders !== null && r.purchases_vs_orders > 1 && (
                              <span className="ms-1 font-bold text-red-600" dir="ltr">
                                ×{r.purchases_vs_orders.toFixed(1)}
                              </span>
                            )}
                          </td>
                          <td className="text-slate-500">{money(r.meta_value)}</td>
                          <td>
                            {r.ga4_tracked_orders != null ? (
                              <>
                                <span className="font-semibold text-brand-700">{formatNumber(r.ga4_tracked_orders)}</span>
                                <span className="ms-1 text-[11px] text-slate-400">{money(r.ga4_tracked_revenue ?? 0)}</span>
                              </>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="font-semibold">{formatNumber(r.store_orders)}</td>
                          <td className="font-semibold text-emerald-700">{money(r.store_revenue)}</td>
                          <td>
                            {r.claim_vs_reality !== null ? (
                              <span
                                className={cn(
                                  "font-bold tabular-nums",
                                  r.claim_vs_reality > 2 ? "text-red-600" : r.claim_vs_reality > 1.15 ? "text-amber-600" : "text-emerald-600"
                                )}
                                dir="ltr"
                              >
                                ×{r.claim_vs_reality.toFixed(2)}
                              </span>
                            ) : (
                              <span className="font-bold text-red-600">∞</span>
                            )}
                          </td>
                          <td className="text-slate-500">{r.gsc_clicks != null ? formatNumber(r.gsc_clicks) : "—"}</td>
                          <td>
                            <span
                              className={cn(
                                "inline-block rounded-full px-2.5 py-0.5 text-xs font-bold",
                                r.verdict === "impossible"
                                  ? "bg-red-100 text-red-700"
                                  : r.verdict === "inflated"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-emerald-100 text-emerald-700"
                              )}
                              title={r.verdict === "impossible" ? tx(AD.gapImpossibleHint) : undefined}
                            >
                              {r.verdict === "impossible"
                                ? tx(AD.gapVerdictImpossible)
                                : r.verdict === "inflated"
                                ? tx(AD.gapVerdictInflated)
                                : tx(AD.gapVerdictPlausible)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-2 text-xs leading-relaxed text-slate-500">
                  <p>
                    <Info size={13} className="me-1 inline" />
                    {tx(AD.gapGa4Note)}
                  </p>
                  <p>{tx(AD.gapOrganicHint)}</p>
                </div>
              </div>
            ))}

          {/* ====================================================== FUNNEL */}
          {tab === "funnel" && (
            <div className="space-y-6">
              <div className="card p-5">
                <h3 className="mb-4 text-sm font-bold text-slate-700">{tx(AD.funnelTitle)}</h3>
                <div className="space-y-2">
                  {funnelStages.map((s, i) => {
                    const prev = i > 0 ? funnelStages[i - 1].value : null;
                    const step = prev && prev > 0 ? (s.value / prev) * 100 : null;
                    const width = funnelStages[0].value > 0 ? Math.max((s.value / funnelStages[0].value) * 100, 0.4) : 0;
                    return (
                      <div key={s.key} className="flex items-center gap-3">
                        <div className="w-32 shrink-0 text-xs font-semibold text-slate-600">{s.label}</div>
                        <div className="h-8 flex-1 rounded-lg bg-slate-100">
                          <div
                            className="flex h-8 items-center justify-end rounded-lg bg-brand-500 px-2 text-[11px] font-bold text-white"
                            style={{ width: `${width}%` }}
                          >
                            {width > 12 ? formatNumber(s.value) : ""}
                          </div>
                        </div>
                        <div className="w-28 shrink-0 text-end text-xs">
                          {width <= 12 && <span className="me-2 text-slate-600">{formatNumber(s.value)}</span>}
                          {step !== null && (
                            <span className={cn("font-bold", step < 30 ? "text-red-600" : step < 60 ? "text-amber-600" : "text-emerald-600")}>
                              {step.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-4 text-xs leading-relaxed text-slate-500">{tx(AD.funnelNote)}</p>
              </div>

              <div className="card overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{tx(AD.ad)}</th>
                      <th>{tx(AD.spend)}</th>
                      <th>{tx(AD.ctr)}</th>
                      <th>{lang === "ar" ? "نقرة ← صفحة" : "Click → page"}</th>
                      <th>{lang === "ar" ? "صفحة ← سلة" : "Page → cart"}</th>
                      <th>{lang === "ar" ? "سلة ← دفع" : "Cart → checkout"}</th>
                      <th>{lang === "ar" ? "دفع ← شراء" : "Checkout → buy"}</th>
                      <th>{tx(AD.worstStage)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...filtered]
                      .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
                      .map((r) => {
                        const d = verdictOf(r);
                        const cell = (v: number | null, mark: number, k: string) => (
                          <td key={k} className={cn(v !== null && v < mark * 0.7 && "font-semibold text-red-600")}>
                            {num1(v, "%")}
                          </td>
                        );
                        return (
                          <tr key={r.id}>
                            <td className="!whitespace-normal max-w-[200px] font-medium">{r.ad_name}</td>
                            <td>{money(r.spend)}</td>
                            {cell(r.ctr_all, bench.ctr, "ctr")}
                            {cell(r.lp_rate, bench.lpRate, "lp")}
                            {cell(r.atc_rate, bench.atcRate, "atc")}
                            {cell(r.ic_rate, bench.icRate, "ic")}
                            {cell(r.purchase_rate, bench.purchaseRate, "pr")}
                            <td>
                              {d.bottleneck ? (
                                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-700">
                                  {tx(BOTTLENECK_LABEL[d.bottleneck])}
                                </span>
                              ) : (
                                <span className="text-emerald-600">✓</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ===================================================== COMPARE */}
          {tab === "compare" && (
            <div className="space-y-5">
              <div className="card flex flex-wrap items-end gap-4 p-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-500">{tx(AD.periodA)}</span>
                  <select className="input !py-1.5 text-sm" value={cmpA} onChange={(e) => setCmpA(e.target.value)}>
                    {periods.map((p) => (
                      <option key={p.import_id} value={p.period_key}>
                        {p.period_label} — {p.account_label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-500">{tx(AD.periodB)}</span>
                  <select className="input !py-1.5 text-sm" value={cmpB} onChange={(e) => setCmpB(e.target.value)}>
                    <option value="">—</option>
                    {periods.map((p) => (
                      <option key={p.import_id} value={p.period_key}>
                        {p.period_label} — {p.account_label}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn-secondary" onClick={exportCurrentCsv} disabled={!compareRows.length}>
                  <Download size={16} />
                  {tx(AD.exportCsv)}
                </button>
              </div>

              {!compareRows.length ? (
                <EmptyState message={tx(AD.comparePick)} />
              ) : (
                <div className="card overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>{tx(AD.ad)}</th>
                        <th>{tx(AD.spend)} A</th>
                        <th>{tx(AD.spend)} B</th>
                        <th>{tx(AD.attRevenue)} A</th>
                        <th>{tx(AD.attRevenue)} B</th>
                        <th>{tx(AD.actualRoas)} A</th>
                        <th>{tx(AD.actualRoas)} B</th>
                        <th>{tx(AD.change)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareRows.map((c) => {
                        const delta = c.roas_now !== null && c.roas_prev !== null ? c.roas_now - c.roas_prev : null;
                        return (
                          <tr key={c.name}>
                            <td className="!whitespace-normal max-w-[220px]">
                              <span className="font-medium">{c.name}</span>
                              {c.state !== "both" && (
                                <span
                                  className={cn(
                                    "ms-2 rounded-full px-2 py-0.5 text-[10px] font-bold",
                                    c.state === "new" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                                  )}
                                >
                                  {c.state === "new" ? tx(AD.newInPeriod) : tx(AD.stopped)}
                                </span>
                              )}
                            </td>
                            <td className="font-semibold">{money(c.spend_now)}</td>
                            <td className="text-slate-500">{money(c.spend_prev)}</td>
                            <td className="text-emerald-700">{money(c.revenue_now)}</td>
                            <td className="text-slate-500">{money(c.revenue_prev)}</td>
                            <td className={cn("font-bold", roasClass(c.roas_now))}>{num2(c.roas_now, "x")}</td>
                            <td className="text-slate-500">{num2(c.roas_prev, "x")}</td>
                            <td>
                              {delta === null ? (
                                "—"
                              ) : (
                                <span className={cn("font-bold", delta >= 0 ? "text-emerald-600" : "text-red-600")} dir="ltr">
                                  {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(2)}x
                                </span>
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
          )}

          {tab === "lists" && <AdsLists from={win?.from ?? null} to={win?.to ?? null} onChanged={load} />}

          {tab === "mapping" && (
            <AdsMapping from={win?.from ?? null} to={win?.to ?? null} ads={inPeriod} onChanged={load} />
          )}

          {/* ===================================================== IMPORTS */}
          {tab === "imports" && (
            <div className="space-y-4">
              <AdsBackfill onChanged={load} />
              <div className="card overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{tx(AD.account)}</th>
                    <th>{tx(AD.period)}</th>
                    <th>{tx(AD.rows)}</th>
                    <th>{tx(AD.spend)}</th>
                    <th>{tx(AD.metaPurchases)}</th>
                    <th>{tx(AD.file)}</th>
                    <th>{tx(AD.importedAt)}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p) => (
                    <tr key={p.import_id}>
                      <td className="font-semibold">{p.account_label}</td>
                      <td>{p.period_label}</td>
                      <td className="text-slate-500">
                        {formatNumber(p.ad_rows)} {tx(AD.ads)} / {formatNumber(p.row_count)}
                      </td>
                      <td className="font-semibold">{money(p.spend)}</td>
                      <td className="text-slate-500">{formatNumber(p.reported_purchases)}</td>
                      {/* file_name is the only thing separating an API pull
                          from a hand-uploaded sheet — `source` is 'meta' for
                          both, because both describe Meta data */}
                      <td className="max-w-[220px] truncate text-xs text-slate-400" dir="ltr">
                        <span
                          className={cn(
                            "me-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold",
                            p.file_name?.startsWith("Meta API")
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-700"
                          )}
                        >
                          {p.file_name?.startsWith("Meta API") ? "API" : tx(AD.sourceFile)}
                        </span>
                        {p.file_name ?? "—"}
                      </td>
                      <td className="text-xs text-slate-500">
                        {new Date(p.imported_at).toLocaleDateString("en-GB", { timeZone: "Africa/Cairo" })}
                        {p.imported_by_email && <div className="text-[11px] text-slate-400">{p.imported_by_email}</div>}
                      </td>
                      <td>
                        <button
                          className="rounded p-1 text-red-400 hover:bg-red-50"
                          title={tx(AD.deleteImport)}
                          onClick={async () => {
                            if (!await confirmDialog(tx(AD.deleteImportConfirm))) return;
                            await fetch("/api/ads", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "delete_import", importId: p.import_id }),
                            });
                            setSelPeriods([]);
                            await load();
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </>
      )}

      <AdsImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={load} existing={periods} />

      <ProductDrawer
        sku={drawerSku?.sku ?? null}
        name={drawerSku?.name}
        stock={drawerSku?.stock}
        onClose={() => setDrawerSku(null)}
      />

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={(s) => {
            setSettings(s);
            setSettingsOpen(false);
          }}
        />
      )}
    </div>
  );
}

function SettingsDialog({
  settings,
  onClose,
  onSaved,
}: {
  settings: AdSettings;
  onClose: () => void;
  onSaved: (s: AdSettings) => void;
}) {
  const { lang } = useLang();
  const tx = (v: { ar: string; en: string }) => v[lang];
  const [form, setForm] = useState<AdSettings>(settings);
  const [busy, setBusy] = useState(false);

  const fields: { key: keyof AdSettings; label: { ar: string; en: string }; step: number; hint?: { ar: string; en: string } }[] = [
    { key: "gross_margin_pct", label: AD.grossMargin, step: 1, hint: AD.grossMarginHint },
    { key: "target_roas", label: AD.targetRoas, step: 0.1 },
    { key: "min_spend", label: AD.minSpendSetting, step: 50 },
    { key: "frequency_cap", label: AD.frequencyCap, step: 0.1 },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="card my-12 w-full max-w-md p-6">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-bold text-slate-900">{tx(AD.settings)}</h2>
          <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4">
          {fields.map((f) => (
            <label key={f.key} className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-500">{tx(f.label)}</span>
              <input
                type="number"
                dir="ltr"
                step={f.step}
                className="input !py-1.5 text-sm"
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })}
              />
              {f.hint && <span className="mt-1 block text-[11px] text-slate-400">{tx(f.hint)}</span>}
            </label>
          ))}
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {tx(AD.breakeven)}: <b>{(100 / Math.max(form.gross_margin_pct, 1)).toFixed(2)}x</b>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            {tx(AD.cancel)}
          </button>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await fetch("/api/ads", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "settings", value: form }),
              });
              setBusy(false);
              if (res.ok) {
                const j = await res.json();
                onSaved(j.value as AdSettings);
              }
            }}
          >
            {tx(AD.save)}
          </button>
        </div>
      </div>
    </div>
  );
}
