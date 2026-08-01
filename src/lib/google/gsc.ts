import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken, getServiceAccount, monthRange, type GoogleSA } from "./ga4";

// Google Search Console client. Reuses the GA4 card's service account; the
// property URL comes from the Settings "Search Console" card (app_settings
// key "gsc", field site_url) or the GSC_SITE_URL env var. GSC data lags
// ~2-3 days, which the monthly re-sync window already covers.

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export interface GscConfig {
  siteUrl: string;
  sa: GoogleSA;
}

export async function getGscConfig(supabase: SupabaseClient): Promise<GscConfig | null> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "gsc").maybeSingle();
  const v = (data?.value ?? {}) as { site_url?: string };
  const siteUrl = v.site_url?.trim() || process.env.GSC_SITE_URL;
  if (!siteUrl) return null;
  const sa = await getServiceAccount(supabase);
  if (!sa) return null;
  return { siteUrl, sa };
}

interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

async function gscQuery(
  cfg: GscConfig,
  month: string,
  dimensions: string[],
  rowLimit: number
): Promise<GscRow[]> {
  const range = monthRange(month);
  if (!range) return [];
  const token = await getAccessToken(cfg.sa, GSC_SCOPE);
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(cfg.siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions,
        rowLimit,
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`GSC query failed: ${data.error?.message ?? res.status}`);
  }
  return (data.rows as GscRow[]) ?? [];
}

export interface GscSyncResult {
  daily: number;
  queries: number;
  pages: number;
}

export async function syncGscMonth(
  cfg: GscConfig,
  supabase: SupabaseClient,
  month: string
): Promise<GscSyncResult> {
  const [daily, queries, pages] = await Promise.all([
    gscQuery(cfg, month, ["date"], 40),
    gscQuery(cfg, month, ["query"], 1000),
    gscQuery(cfg, month, ["page"], 1000),
  ]);

  const dailyRows = daily
    .filter((r) => r.keys[0])
    .map((r) => ({
      date: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }));
  if (dailyRows.length) {
    const { error } = await supabase.from("gsc_daily").upsert(dailyRows, { onConflict: "date" });
    if (error) throw new Error(`gsc_daily: ${error.message}`);
  }

  const monthly: [string, string, GscRow[]][] = [
    ["gsc_queries", "query", queries],
    ["gsc_pages", "page", pages],
  ];
  for (const [table, keyColumn, rows] of monthly) {
    const seen = new Set<string>();
    const mapped = rows
      .filter((r) => {
        const k = r.keys[0]?.trim();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((r) => ({
        period_month: month,
        [keyColumn]: r.keys[0].trim(),
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
      }));
    if (!mapped.length) continue;
    await supabase.from(table).delete().eq("period_month", month);
    for (let i = 0; i < mapped.length; i += 1000) {
      const { error } = await supabase.from(table).insert(mapped.slice(i, i + 1000));
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  }

  return { daily: dailyRows.length, queries: queries.length, pages: pages.length };
}
