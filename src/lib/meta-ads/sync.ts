import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchInsights,
  pickAction,
  ACTION_CANDIDATES,
  MetaError,
  type RawInsightRow,
  type InsightLevel,
} from "./api";

/**
 * Pulls one ad account straight into the same tables the spreadsheet import
 * fills, via the same fn_ads_import RPC — so live data and hand-imported
 * history share one model, and re-syncing a period refreshes it in place
 * rather than duplicating it.
 *
 * One account per call: eight accounts × three levels × paging would blow the
 * 60s function ceiling, so the caller loops and shows progress.
 */

export interface SyncAccountResult {
  accountId: string;
  label: string;
  since: string;
  until: string;
  rows: number;
  adRows: number;
  spend: number;
  withLinks: number;
  importId?: string;
}

/** The row shape fn_ads_import destructures — identical to the file parser's. */
interface ImportRow {
  level: InsightLevel;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  reach: number | null;
  impressions: number | null;
  frequency: number | null;
  spend: number | null;
  cpm: number | null;
  link_clicks: number | null;
  ctr_all: number | null;
  landing_page_views: number | null;
  adds_to_cart: number | null;
  checkouts_initiated: number | null;
  purchases: number | null;
  conversion_value: number | null;
  cost_per_purchase: number | null;
  results_roas: number | null;
  delivery_status: string | null;
  dest_url: string | null;
}

const numOrNull = (v: string | undefined): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

interface AdMeta {
  status: string | null;
  destUrl: string | null;
}

interface CreativeShape {
  link_url?: string;
  object_story_spec?: {
    link_data?: { link?: string };
    video_data?: { call_to_action?: { value?: { link?: string } } };
  };
  asset_feed_spec?: { link_urls?: { website_url?: string }[] };
}

/** Meta hides the destination in a different place depending on the ad format,
 *  so try each. This is what lets fn_ads_autolink connect an ad to the custom
 *  list it points at without anyone mapping it by hand. */
function creativeLink(c: CreativeShape | undefined): string | null {
  if (!c) return null;
  return (
    c.link_url ||
    c.object_story_spec?.link_data?.link ||
    c.object_story_spec?.video_data?.call_to_action?.value?.link ||
    c.asset_feed_spec?.link_urls?.[0]?.website_url ||
    null
  );
}

/** Ad-level status and destination aren't part of the Insights response, so
 *  they come from the /ads edge and are joined on ad_id. */
async function fetchAdMeta(token: string, accountId: string): Promise<Map<string, AdMeta>> {
  const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const out = new Map<string, AdMeta>();
  const url = new URL(`https://graph.facebook.com/v26.0/${act}/ads`);
  url.searchParams.set("fields", "id,effective_status,creative{link_url,object_story_spec,asset_feed_spec}");
  url.searchParams.set("limit", "200");
  url.searchParams.set("access_token", token);

  let next: string | null = url.toString();
  for (let page = 0; page < 15 && next; page++) {
    const res = await fetch(next, { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as {
      data?: { id: string; effective_status?: string; creative?: CreativeShape }[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    // creative access can be restricted while insights still work — the sync
    // is still useful without links, so this failure is not fatal
    if (!res.ok || json.error) break;
    for (const ad of json.data ?? []) {
      out.set(ad.id, {
        status: ad.effective_status?.toLowerCase() ?? null,
        destUrl: creativeLink(ad.creative),
      });
    }
    next = json.paging?.next ?? null;
  }
  return out;
}

function toImportRow(r: RawInsightRow, level: InsightLevel, meta: Map<string, AdMeta>): ImportRow {
  const spend = numOrNull(r.spend);
  const purchases = pickAction(r.actions, [...ACTION_CANDIDATES.purchase]);
  const value = pickAction(r.action_values, [...ACTION_CANDIDATES.purchase]);
  const costPer = pickAction(r.cost_per_action_type, [...ACTION_CANDIDATES.purchase]);
  const adMeta = level === "ad" && r.ad_id ? meta.get(r.ad_id) : undefined;

  return {
    level,
    campaign_name: r.campaign_name ?? null,
    adset_name: level === "campaign" ? null : r.adset_name ?? null,
    ad_name: level === "ad" ? r.ad_name ?? null : null,
    reach: numOrNull(r.reach),
    impressions: numOrNull(r.impressions),
    frequency: numOrNull(r.frequency),
    spend,
    cpm: numOrNull(r.cpm),
    // the spreadsheet's "Link clicks" column is inline_link_clicks, not the
    // all-inclusive `clicks` field
    link_clicks: numOrNull(r.inline_link_clicks),
    ctr_all: numOrNull(r.ctr),
    landing_page_views: pickAction(r.actions, [...ACTION_CANDIDATES.landingPageView]),
    adds_to_cart: pickAction(r.actions, [...ACTION_CANDIDATES.addToCart]),
    checkouts_initiated: pickAction(r.actions, [...ACTION_CANDIDATES.initiateCheckout]),
    purchases,
    conversion_value: value,
    cost_per_purchase: costPer ?? (spend && purchases ? Math.round((spend / purchases) * 10000) / 10000 : null),
    // Meta returns purchase_roas as its own edge; deriving it keeps one source
    results_roas: value && spend ? Math.round((value / spend) * 10000) / 10000 : null,
    delivery_status: adMeta?.status ?? null,
    dest_url: adMeta?.destUrl ?? null,
  };
}

export async function syncAccount(
  db: SupabaseClient,
  token: string,
  account: { id: string; label: string },
  since: string,
  until: string
): Promise<SyncAccountResult> {
  // ad-level first: if the account has nothing in the window, skip the rest
  const adRows = await fetchInsights(token, account.id, { since, until, level: "ad" });

  let meta = new Map<string, AdMeta>();
  if (adRows.length) {
    try {
      meta = await fetchAdMeta(token, account.id);
    } catch {
      // links are a bonus, not a requirement
    }
  }

  const [campaignRows, adsetRows] = adRows.length
    ? await Promise.all([
        fetchInsights(token, account.id, { since, until, level: "campaign" }),
        fetchInsights(token, account.id, { since, until, level: "adset" }),
      ])
    : [[], []];

  const rows: ImportRow[] = [
    ...campaignRows.map((r) => toImportRow(r, "campaign", meta)),
    ...adsetRows.map((r) => toImportRow(r, "adset", meta)),
    ...adRows.map((r) => toImportRow(r, "ad", meta)),
  ];

  const result: SyncAccountResult = {
    accountId: account.id,
    label: account.label,
    since,
    until,
    rows: rows.length,
    adRows: adRows.length,
    spend: Math.round(rows.filter((r) => r.level === "ad").reduce((s, r) => s + (r.spend ?? 0), 0) * 100) / 100,
    withLinks: rows.filter((r) => r.level === "ad" && r.dest_url).length,
  };

  if (!rows.length) return result;

  const { data, error } = await db.rpc("fn_ads_import", {
    p_account: account.label,
    p_start: since,
    p_end: until,
    p_file: `Meta API · ${account.id}`,
    p_rows: rows,
  });
  if (error) throw new MetaError(`Saving ${account.label} failed: ${error.message}`, 500);
  result.importId = (data as { import_id?: string } | null)?.import_id;
  return result;
}

/** Calendar month containing `d`, clipped to today — Meta rejects future dates. */
export function monthWindow(d = new Date()): { since: string; until: string } {
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  const today = new Date();
  return { since: iso(start), until: iso(end > today ? today : end) };
}
