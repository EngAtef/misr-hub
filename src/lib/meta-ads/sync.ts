import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchInsightsAdaptive,
  pickAction,
  ACTION_CANDIDATES,
  MetaError,
  MAX_LOOKBACK_MONTHS,
  type RawInsightRow,
  type InsightLevel,
} from "./api";
import { beforeCall, recordUsage, RateLimitedError, usageReport, type ThrottleReport } from "./throttle";

/**
 * Pulls one ad account × one period straight into the same tables the
 * spreadsheet import fills, via the same fn_ads_import RPC — so live data and
 * any hand-imported history share one model, and re-syncing a period refreshes
 * it in place rather than duplicating it.
 *
 * One account-month per call: several accounts × three levels × paging would
 * blow the function's time ceiling, so callers loop and show progress.
 */

export interface SyncAccountResult {
  accountId: string;
  label: string;
  since: string;
  until: string;
  /** Calendar months written — a range job produces one import per month. */
  months: number;
  rows: number;
  adRows: number;
  spend: number;
  withLinks: number;
  superseded?: number;
  throttle?: ThrottleReport | null;
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

export interface AdMeta {
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

/**
 * Ad-level status and destination aren't part of the Insights response, so
 * they're fetched separately and joined on ad_id.
 *
 * By ID, not by listing the account. Walking /act_X/ads measured 37-44s for
 * one account — on its own more than the whole function is allowed — because
 * it returns every ad ever created (1,440 on the culture account) with its
 * creative attached. Filtering by effective_status barely helped and a large
 * page size made Meta refuse outright.
 *
 * The insights response has already named the handful of ads that actually
 * ran in the window, so ask for exactly those: one request per 40 ads, which
 * for a live month is one or two calls instead of eight pages.
 */
/** Meta caps a filter list; 50 ids per request keeps every response small and
 *  well under the "reduce the amount of data" threshold. */
const AD_META_BATCH = 50;

export async function fetchAdMeta(token: string, accountId: string, adIds: string[]): Promise<Map<string, AdMeta>> {
  const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const out = new Map<string, AdMeta>();
  const ids = Array.from(new Set(adIds.filter(Boolean)));
  if (!ids.length) return out;

  for (let i = 0; i < ids.length; i += AD_META_BATCH) {
    const batch = ids.slice(i, i + AD_META_BATCH);
    const url = new URL(`https://graph.facebook.com/v26.0/${act}/ads`);
    url.searchParams.set("fields", "id,effective_status,creative{link_url,object_story_spec,asset_feed_spec}");
    url.searchParams.set("limit", String(AD_META_BATCH));
    // The v26 `ids=` shortcut is gone (deprecated, returns 500), and listing
    // the account returns every ad ever created — 1,440 on the culture
    // account, 44 seconds. Filtering the edge to the ads we already know ran
    // is the same answer in about two.
    url.searchParams.set("filtering", JSON.stringify([{ field: "ad.id", operator: "IN", value: batch }]));
    url.searchParams.set("access_token", token);

    await beforeCall(act);
    const res = await fetch(url, { cache: "no-store", headers: { "User-Agent": "misr-hub/1.0 (+ads-center)" } });
    recordUsage(act, res.headers);
    const json = (await res.json().catch(() => ({}))) as {
      data?: { id: string; effective_status?: string; creative?: CreativeShape }[];
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

/** One calendar month's worth of rows, as Meta bucketed them. */
interface MonthBucket {
  since: string;
  until: string;
  rows: ImportRow[];
  adRows: number;
  spend: number;
}

function bucketByMonth(
  rows: RawInsightRow[],
  level: InsightLevel,
  meta: Map<string, AdMeta>,
  into: Map<string, MonthBucket>
) {
  for (const r of rows) {
    // With time_increment=monthly, Meta stamps every row with the bucket it
    // belongs to — including a date_stop clipped to today for the open month,
    // which is exactly the period the import should carry.
    const since = r.date_start;
    const until = r.date_stop;
    if (!since || !until) continue;
    const key = `${since}_${until}`;
    let b = into.get(key);
    if (!b) {
      b = { since, until, rows: [], adRows: 0, spend: 0 };
      into.set(key, b);
    }
    const row = toImportRow(r, level, meta);
    b.rows.push(row);
    if (level === "ad") {
      b.adRows += 1;
      b.spend += row.spend ?? 0;
    }
  }
}

/**
 * Pulls a whole range in one pass and writes one import per calendar month.
 *
 * Asking Meta for three months at time_increment=monthly costs almost exactly
 * what asking for one month costs — measured on the busiest account, a full
 * year came back for the same 1% of the hourly call budget as a single month.
 * Since the rate limit is what blocks an integration, fetching wide and
 * splitting locally is both faster and dramatically safer than looping month
 * by month.
 */
export async function syncRange(
  db: SupabaseClient,
  token: string,
  account: { id: string; label: string },
  since: string,
  until: string
): Promise<SyncAccountResult> {
  const act = account.id.startsWith("act_") ? account.id : `act_${account.id}`;

  // ad level first: if the account ran nothing in the range, the other two
  // levels are guaranteed empty too and asking for them is pure waste
  const adRows = await fetchInsightsAdaptive(token, account.id, { since, until, level: "ad", monthly: true });

  let meta = new Map<string, AdMeta>();
  if (adRows.length && shouldFetchAdMeta(until)) {
    try {
      meta = await fetchAdMeta(
        token,
        account.id,
        adRows.map((r) => r.ad_id).filter((x): x is string => !!x)
      );
    } catch (e) {
      // links are a bonus, not a requirement — but a rate-limit block is not
      // something to swallow, the caller needs to stop
      if (e instanceof RateLimitedError) throw e;
    }
  }

  // Sequential, not Promise.all: two concurrent insights queries on the same
  // ad account race past the pacing in throttle.ts and land on the same hourly
  // budget at once. Meta's guidance is to spread calls out, not fan them out.
  const campaignRows = adRows.length
    ? await fetchInsightsAdaptive(token, account.id, { since, until, level: "campaign", monthly: true })
    : [];
  const adsetRows = adRows.length
    ? await fetchInsightsAdaptive(token, account.id, { since, until, level: "adset", monthly: true })
    : [];

  const buckets = new Map<string, MonthBucket>();
  bucketByMonth(campaignRows, "campaign", meta, buckets);
  bucketByMonth(adsetRows, "adset", meta, buckets);
  bucketByMonth(adRows, "ad", meta, buckets);

  const result: SyncAccountResult = {
    accountId: account.id,
    label: account.label,
    since,
    until,
    months: buckets.size,
    rows: 0,
    adRows: adRows.length,
    spend: 0,
    withLinks: 0,
    superseded: 0,
    throttle: usageReport(act),
  };

  for (const b of [...buckets.values()].sort((x, y) => x.since.localeCompare(y.since))) {
    result.rows += b.rows.length;
    result.spend += b.spend;
    result.withLinks += b.rows.filter((r) => r.level === "ad" && r.dest_url).length;

    // The open month gets re-pulled under a later end date every run, which
    // lands BESIDE the earlier copy rather than replacing it (fn_ads_import
    // keys on the exact period) — and fn_ads_insights selects on overlap, so
    // both copies would be counted. Clear the overlapping ones first.
    const { data: superseded } = await db.rpc("fn_ads_import_supersede", {
      p_account: account.label,
      p_start: b.since,
      p_end: b.until,
    });
    result.superseded = (result.superseded ?? 0) + Number(superseded ?? 0);

    const { error } = await db.rpc("fn_ads_import", {
      p_account: account.label,
      p_start: b.since,
      p_end: b.until,
      p_file: `Meta API · ${account.id}`,
      p_rows: b.rows,
    });
    if (error) throw new MetaError(`Saving ${account.label} ${b.since} failed: ${error.message}`, 500);
  }

  result.spend = Math.round(result.spend * 100) / 100;
  return result;
}

/** The open-month refresh the cron runs — one month, same machinery. */
export const syncAccount = syncRange;

// ----------------------------------------------------------------- windows

const iso = (x: Date) => x.toISOString().slice(0, 10);

/**
 * Delivery status and destination URL describe an ad as it is RIGHT NOW —
 * Meta has no history for either. Attaching today's status to a quarter from
 * 2024 says nothing true, and the autolink they feed only matters for ads
 * currently running.
 *
 * So historical jobs skip it entirely and carry null — an honest blank rather
 * than today's status stamped onto a closed quarter.
 */
export function shouldFetchAdMeta(until: string, now = new Date()): boolean {
  const monthStart = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  return until >= monthStart;
}

/** Calendar month containing `d`, clipped to today — Meta rejects future dates. */
export function monthWindow(d = new Date()): { since: string; until: string } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  const today = new Date();
  return { since: iso(start), until: iso(end > today ? today : end) };
}

/**
 * The oldest date Meta will still answer for. Its limit is 37 months; asking
 * for a start beyond that fails the entire call with code 3018, so the plan
 * has to stop one month short rather than discover the wall halfway through.
 */
export function earliestPullableDate(d = new Date()): string {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - MAX_LOOKBACK_MONTHS, 1));
  return iso(start);
}
