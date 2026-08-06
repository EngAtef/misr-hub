"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, RefreshCw, Plug, ExternalLink, AlertTriangle, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { AD } from "@/lib/ads/strings";
import { Spinner, KpiCard, ChartCard } from "@/components/ui";
import { TrendChart, BarsChart } from "@/components/charts";
import { formatMoney, formatNumber, toCsv, downloadCsv, cn } from "@/lib/utils";

interface Overview {
  total_clicks: number;
  links_total: number;
  links_with_clicks: number;
  links_tagged: number;
  last_sync: string | null;
  daily: { date: string; clicks: number }[];
  top_links: { id: string; link: string; title: string | null; long_url: string | null; utm_campaign: string | null; utm_content: string | null; clicks: number }[];
  referrers: { value: string; clicks: number }[];
  countries: { value: string; clicks: number }[];
}

interface ChainRow {
  campaign_name: string;
  bitlinks: number;
  spend: number;
  meta_clicks: number;
  meta_landing_views: number;
  bitly_clicks: number;
  ga4_sessions: number;
  ga4_orders: number;
  store_revenue: number;
  bitly_vs_meta: number | null;
  ga4_vs_bitly: number | null;
  verdict: "healthy" | "clicks_lost" | "landing_lost" | "no_link" | "no_meta_clicks";
}

/**
 * Bitly sits between what Meta charged for and what the site received, so it's
 * the only number in the chain that neither ad platform controls.
 */
export function AdsLinks({ from, to }: { from: string | null; to: string | null }) {
  const { lang } = useLang();
  const tx = useCallback((v: { ar: string; en: string }) => v[lang], [lang]);
  const supabase = useMemo(() => createClient(), []);

  const [connected, setConnected] = useState<boolean | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [chain, setChain] = useState<ChainRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"test" | "sync" | null>(null);
  const [days, setDays] = useState(60);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [cfg, ov, ch] = await Promise.all([
      supabase.rpc("fn_bitly_config"),
      from && to ? supabase.rpc("fn_bitly_overview", { p_from: from, p_to: to }) : Promise.resolve({ data: null }),
      from && to ? supabase.rpc("fn_bitly_vs_ads", { p_from: from, p_to: to }) : Promise.resolve({ data: [] }),
    ]);
    setConnected(Boolean((cfg.data as { access_token?: string } | null)?.access_token));
    setOverview((ov.data as Overview) ?? null);
    setChain((ch.data as ChainRow[]) ?? []);
    setLoading(false);
  }, [supabase, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: "test" | "sync") {
    setBusy(action);
    setNote(null);
    try {
      const res = await fetch("/api/bitly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, days }),
      });
      const j = await res.json();
      if (!res.ok) {
        setNote({ kind: "err", text: [j.error, j.hint].filter(Boolean).join(" — ") });
      } else if (action === "test") {
        setNote({ kind: "ok", text: `${j.name || j.login} · ${j.group_guid}` });
        setConnected(true);
      } else {
        const r = j.result as { linksSeen: number; clickRows: number; truncated: boolean; warning?: string };
        setNote({
          kind: "ok",
          text: [
            `${formatNumber(r.linksSeen)} ${tx(AD.bitlyLinks)} · ${formatNumber(r.clickRows)} rows`,
            r.truncated ? tx(AD.bitlyTruncated) : null,
            r.warning,
          ]
            .filter(Boolean)
            .join(" · "),
        });
        await load();
      }
    } catch (e) {
      setNote({ kind: "err", text: e instanceof Error ? e.message : "failed" });
    }
    setBusy(null);
  }

  if (loading) return <Spinner />;

  if (!connected) {
    return (
      <div className="card flex flex-col items-center gap-3 p-12 text-center">
        <Plug className="h-10 w-10 text-brand-500" />
        <div className="font-semibold text-slate-700">{tx(AD.bitlyNotConnected)}</div>
        <p className="max-w-xl text-sm text-slate-500">{tx(AD.bitlyNotConnectedHint)}</p>
        <p className="max-w-xl text-xs text-slate-400">{tx(AD.bitlyIntro)}</p>
        <a className="btn-primary mt-2" href="/settings">
          <Plug size={16} />
          {tx(AD.bitlyOpenSettings)}
        </a>
      </div>
    );
  }

  const verdictMeta: Record<ChainRow["verdict"], { label: string; cls: string }> = {
    healthy: { label: tx(AD.bitlyVerdictHealthy), cls: "bg-emerald-100 text-emerald-700" },
    clicks_lost: { label: tx(AD.bitlyVerdictClicksLost), cls: "bg-red-100 text-red-700" },
    landing_lost: { label: tx(AD.bitlyVerdictLandingLost), cls: "bg-amber-100 text-amber-700" },
    no_link: { label: tx(AD.bitlyVerdictNoLink), cls: "bg-slate-100 text-slate-500" },
    no_meta_clicks: { label: tx(AD.bitlyVerdictNoClicks), cls: "bg-slate-100 text-slate-500" },
  };

  const matched = chain.filter((c) => c.verdict !== "no_link");

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[240px] flex-1">
          <div className="text-sm font-bold text-slate-700">{tx(AD.bitlyTitle)}</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{tx(AD.bitlyIntro)}</p>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-500">{tx(AD.bitlyDays)}</span>
          <input
            type="number"
            dir="ltr"
            min={1}
            max={365}
            className="input !py-1.5 w-24 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </label>
        <button className="btn-secondary" onClick={() => run("test")} disabled={busy !== null}>
          <Plug size={16} />
          {tx(AD.bitlyTest)}
        </button>
        <button className="btn-primary" onClick={() => run("sync")} disabled={busy !== null}>
          <RefreshCw size={16} className={cn(busy === "sync" && "animate-spin")} />
          {busy === "sync" ? tx(AD.bitlySyncing) : tx(AD.bitlySync)}
        </button>
      </div>

      {note && (
        <div
          className={cn(
            "rounded-lg border px-4 py-2.5 text-sm",
            note.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"
          )}
        >
          {note.text}
        </div>
      )}

      {!overview || overview.links_total === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-500">{tx(AD.bitlyNoData)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <KpiCard label={tx(AD.bitlyClicks)} value={formatNumber(overview.total_clicks)} accent="brand" />
            <KpiCard
              label={tx(AD.bitlyLinks)}
              value={formatNumber(overview.links_total)}
              accent="slate"
              sub={`${formatNumber(overview.links_with_clicks)} active`}
            />
            <KpiCard
              label={tx(AD.bitlyTagged)}
              value={`${formatNumber(overview.links_tagged)} / ${formatNumber(overview.links_total)}`}
              accent={overview.links_tagged === 0 ? "red" : overview.links_tagged < overview.links_total ? "amber" : "green"}
              sub={tx(AD.bitlyTaggedHint)}
            />
            <KpiCard
              label={tx(AD.bitlyLastSync)}
              value={overview.last_sync ? new Date(overview.last_sync).toLocaleDateString("en-GB") : "—"}
              accent="slate"
            />
          </div>

          {overview.daily.length > 0 && (
            <ChartCard title={tx(AD.bitlyClicks)}>
              <TrendChart
                data={overview.daily}
                xKey="date"
                series={[{ key: "clicks", name: tx(AD.bitlyClicks), color: "#2b3990" }]}
                height={240}
              />
            </ChartCard>
          )}

          {matched.length > 0 && (
            <div className="card p-5">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-slate-700">{tx(AD.bitlyChain)}</h3>
                <button
                  className="btn-secondary !py-1 text-xs ms-auto"
                  onClick={() =>
                    downloadCsv(`bitly-chain-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(chain as unknown as Record<string, unknown>[]))
                  }
                >
                  <Download size={13} />
                  CSV
                </button>
              </div>
              <p className="mb-4 text-xs leading-relaxed text-slate-500">{tx(AD.bitlyChainHint)}</p>
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{tx(AD.campaign)}</th>
                      <th>{tx(AD.spend)}</th>
                      <th>{tx(AD.clicks)} (Meta)</th>
                      <th>{tx(AD.bitlyClicks)}</th>
                      <th>Bitly ÷ Meta</th>
                      <th>GA4</th>
                      <th>GA4 ÷ Bitly</th>
                      <th>{tx(AD.storeRevenue)}</th>
                      <th>{tx(AD.verdict)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matched.map((c) => (
                      <tr key={c.campaign_name}>
                        <td className="!whitespace-normal max-w-[240px] font-medium">{c.campaign_name}</td>
                        <td>{formatMoney(c.spend, lang)}</td>
                        <td className="text-slate-500">{formatNumber(c.meta_clicks)}</td>
                        <td className="font-semibold text-brand-700">{formatNumber(c.bitly_clicks)}</td>
                        <td>
                          {c.bitly_vs_meta !== null ? (
                            <span
                              className={cn("font-bold tabular-nums", c.bitly_vs_meta < 0.5 ? "text-red-600" : c.bitly_vs_meta < 0.8 ? "text-amber-600" : "text-emerald-600")}
                              dir="ltr"
                            >
                              {(c.bitly_vs_meta * 100).toFixed(0)}%
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="text-slate-500">{formatNumber(c.ga4_sessions)}</td>
                        <td>
                          {c.ga4_vs_bitly !== null ? (
                            <span
                              className={cn("font-bold tabular-nums", c.ga4_vs_bitly < 0.6 ? "text-red-600" : "text-emerald-600")}
                              dir="ltr"
                            >
                              {(c.ga4_vs_bitly * 100).toFixed(0)}%
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="font-semibold text-emerald-700">{formatMoney(c.store_revenue, lang)}</td>
                        <td>
                          <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-bold", verdictMeta[c.verdict].cls)}>
                            {verdictMeta[c.verdict].label}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            {overview.referrers.length > 0 && (
              <ChartCard title={tx(AD.bitlyReferrers)}>
                <BarsChart
                  data={overview.referrers.map((r) => ({ name: r.value, clicks: r.clicks }))}
                  xKey="name"
                  series={[{ key: "clicks", name: tx(AD.bitlyClicks), color: "#4e7f76" }]}
                  layout="vertical"
                  height={280}
                />
              </ChartCard>
            )}
            {overview.countries.length > 0 && (
              <ChartCard title={tx(AD.bitlyCountries)}>
                <BarsChart
                  data={overview.countries.map((r) => ({ name: r.value, clicks: r.clicks }))}
                  xKey="name"
                  series={[{ key: "clicks", name: tx(AD.bitlyClicks), color: "#2b3990" }]}
                  layout="vertical"
                  height={280}
                />
              </ChartCard>
            )}
          </div>

          <div className="card overflow-x-auto">
            <div className="p-5 pb-0 text-sm font-bold text-slate-700">{tx(AD.bitlyTopLinks)}</div>
            <table className="table-base mt-3">
              <thead>
                <tr>
                  <th>{tx(AD.bitlyLinks)}</th>
                  <th>{tx(AD.bitlyDest)}</th>
                  <th>{tx(AD.campaign)}</th>
                  <th>{tx(AD.ad)}</th>
                  <th>{tx(AD.bitlyClicks)}</th>
                </tr>
              </thead>
              <tbody>
                {overview.top_links.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <a
                        href={l.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        dir="ltr"
                        className="inline-flex items-center gap-1 font-mono text-xs text-brand-700 hover:underline"
                      >
                        <Link2 size={12} />
                        {l.id}
                      </a>
                      {l.title && <div className="text-[11px] text-slate-400">{l.title}</div>}
                    </td>
                    <td className="max-w-[280px] truncate text-xs text-slate-500" dir="ltr" title={l.long_url ?? ""}>
                      {l.long_url ? (
                        <a href={l.long_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                          {l.long_url.replace(/^https?:\/\//, "").slice(0, 60)}
                          <ExternalLink size={10} />
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="!whitespace-normal max-w-[180px] text-xs">
                      {l.utm_campaign ?? (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <AlertTriangle size={11} />
                          —
                        </span>
                      )}
                    </td>
                    <td className="!whitespace-normal max-w-[150px] text-xs text-slate-500">{l.utm_content ?? "—"}</td>
                    <td className="font-semibold">{formatNumber(l.clicks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
