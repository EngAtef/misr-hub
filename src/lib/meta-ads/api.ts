// Meta Marketing API — reading ad performance straight from the source, so
// the Ads Center no longer depends on hand-exported spreadsheets.
//
// Separate from src/lib/marketing/meta.ts, which does Page/IG publishing and
// boosting on an older Graph version. This module only ever READS.

import { createHmac } from "crypto";
import { beforeCall, recordUsage, blockAccount, RateLimitedError, sleep } from "./throttle";

export const GRAPH_VERSION = "v26.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Meta refuses any window whose start is more than 37 months back. Ask for
 *  more and the whole call fails with code 3018 — so the backfill has to know
 *  this number rather than discover it. A month of margin keeps a long-running
 *  backfill from tripping over the boundary as it moves. */
export const MAX_LOOKBACK_MONTHS = 36;

/**
 * Errors worth retrying: transient platform hiccups and the throttling family.
 * Everything else (bad token, missing permission, malformed request) will fail
 * identically forever, and Meta counts user errors against the rate limit — so
 * retrying them actively makes a block more likely.
 */
const RETRYABLE = new Set([1, 2, 4, 17, 32, 341, 613, 80000, 80001, 80003, 80004, 80005, 80006, 80008, 80014]);
/** These specifically mean "you are being throttled", not "try again soon". */
const THROTTLE_CODES = new Set([4, 17, 32, 613, 80000, 80001, 80003, 80004, 80005, 80006, 80008, 80014]);
const MAX_ATTEMPTS = 4;

/** Everything the puller needs is read-only; ads_management is only required
 *  if you also want to pause/boost ads from the app. */
export const REQUIRED_SCOPES = ["ads_read"] as const;
export const OPTIONAL_SCOPES = ["ads_management", "business_management", "read_insights"] as const;

export class MetaError extends Error {
  status: number;
  code?: number;
  subcode?: number;
  hint?: string;
  constructor(message: string, status: number, code?: number, subcode?: number, hint?: string) {
    super(message);
    this.name = "MetaError";
    this.status = status;
    this.code = code;
    this.subcode = subcode;
    this.hint = hint;
  }
}

interface GraphErrorBody {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number; error_user_msg?: string };
}

function hintFor(code?: number, subcode?: number): string | undefined {
  if (code === 190) return "The token is invalid or expired — generate a new System User token";
  if (code === 200 || code === 10) return "The token is missing a permission (ads_read) or the ad account isn't assigned to this System User";
  if (code === 100 && subcode === 33) return "The ad account ID isn't visible to this token — assign the account to the System User in Business Settings";
  if (code === 3018) return `Meta only serves the last ${MAX_LOOKBACK_MONTHS + 1} months of insights — older periods can't be pulled at all`;
  if (code === 1 && subcode === 99) return "The window asked Meta for too much at once — it is retried in smaller pieces";
  if (THROTTLE_CODES.has(code ?? -1)) return "Meta rate limit — the sync backs off on its own and resumes where it stopped";
  if (code === 803) return "That object exists but this token can't see it — check asset assignment";
  return undefined;
}

/**
 * appsecret_proof signs every call with the app secret, so a stolen token is
 * useless without it. Meta recommends it for server-side calls and lets an app
 * REQUIRE it. Optional here: set META_APP_SECRET and it switches itself on.
 */
function appSecretProof(token: string): string | null {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(token).digest("hex");
}

interface GraphOpts {
  /** The ad account this call is billed to, for rate-limit accounting. */
  account?: string;
  attempt?: number;
}

/**
 * One Graph call, wrapped in everything that keeps Meta happy: pacing before
 * the request, usage accounting after it, and bounded exponential back-off
 * with jitter on the errors that are actually worth retrying.
 */
async function graph<T>(
  path: string,
  token: string,
  params: Record<string, string> = {},
  opts: GraphOpts = {}
): Promise<T> {
  const account = opts.account ?? "app";
  const attempt = opts.attempt ?? 1;

  await beforeCall(account);

  const proof = appSecretProof(token);
  const qs = new URLSearchParams({ ...params, access_token: token, ...(proof ? { appsecret_proof: proof } : {}) });

  let res: Response;
  try {
    res = await fetch(`${GRAPH}/${path}?${qs}`, {
      cache: "no-store",
      // identifying the caller is a courtesy Meta asks for and makes their
      // side of a support conversation possible
      headers: { "User-Agent": "misr-hub/1.0 (+ads-center)" },
    });
  } catch (networkError) {
    if (attempt < MAX_ATTEMPTS) {
      await sleep(backoffMs(attempt));
      return graph<T>(path, token, params, { ...opts, attempt: attempt + 1 });
    }
    throw new MetaError(
      networkError instanceof Error ? networkError.message : "Could not reach Meta",
      503,
      undefined,
      undefined,
      "Network error talking to graph.facebook.com"
    );
  }

  recordUsage(account, res.headers);

  const json = (await res.json().catch(() => ({}))) as T & GraphErrorBody;
  if (res.ok && !json.error) return json;

  const e = json.error;
  const code = e?.code;
  const subcode = e?.error_subcode;

  if (THROTTLE_CODES.has(code ?? -1)) {
    // Meta is explicit that calling again while throttled lengthens the
    // lockout, so the account is parked and the job requeued instead.
    blockAccount(account, 15);
    throw new RateLimitedError(account, 15);
  }

  const canRetry = RETRYABLE.has(code ?? -1) || res.status === 429 || res.status >= 500;
  if (canRetry && attempt < MAX_ATTEMPTS) {
    await sleep(backoffMs(attempt));
    return graph<T>(path, token, params, { ...opts, attempt: attempt + 1 });
  }

  throw new MetaError(
    e?.error_user_msg || e?.message || `Meta API error (${res.status})`,
    res.status,
    code,
    subcode,
    hintFor(code, subcode)
  );
}

/** Exponential with full jitter — a fleet of retries that all fire on the same
 *  schedule is just a smaller thundering herd. */
function backoffMs(attempt: number): number {
  const base = Math.min(30_000, 1_000 * 2 ** attempt);
  return Math.round(base / 2 + Math.random() * (base / 2));
}

/** True when the failure means "this window was too big", which is fixed by
 *  asking for less rather than by waiting. Meta signals it as code 1 /
 *  subcode 99, and sometimes only in the message text. */
export function isTooMuchData(e: unknown): boolean {
  if (!(e instanceof MetaError)) return false;
  if (e.code === 1 && e.subcode === 99) return true;
  return /reduce the amount of data|too much data|please reduce/i.test(e.message);
}

/** Follows `paging.next` cursors, with a hard page cap so a runaway account
 *  can't spin forever inside a 60s serverless function. */
async function graphAll<T>(
  path: string,
  token: string,
  params: Record<string, string>,
  maxPages = 20,
  account?: string
): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const r = await graph<{ data: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      path,
      token,
      after ? { ...params, after } : params,
      { account }
    );
    out.push(...(r.data ?? []));
    if (!r.paging?.next) break;
    after = r.paging.cursors?.after;
    if (!after) break;
  }
  return out;
}

// ------------------------------------------------------------------ token

export interface TokenInfo {
  appId: string;
  appName?: string;
  type: string;
  isValid: boolean;
  /** 0 = never expires, which is what a System User token should be. */
  expiresAt: number;
  scopes: string[];
  userId?: string;
}

/** debug_token tells us the scopes and expiry without needing another call.
 *  A token can debug itself, so no separate app token is required. */
export async function debugToken(token: string): Promise<TokenInfo> {
  const r = await graph<{
    data?: {
      app_id?: string;
      application?: string;
      type?: string;
      is_valid?: boolean;
      expires_at?: number;
      data_access_expires_at?: number;
      scopes?: string[];
      user_id?: string;
    };
  }>("debug_token", token, { input_token: token });
  const d = r.data ?? {};
  return {
    appId: d.app_id ?? "",
    appName: d.application,
    type: d.type ?? "UNKNOWN",
    isValid: d.is_valid !== false,
    expiresAt: d.expires_at ?? 0,
    scopes: d.scopes ?? [],
    userId: d.user_id,
  };
}

// ------------------------------------------------------------- ad accounts

export interface AdAccount {
  id: string; // "act_1234567890"
  account_id: string; // "1234567890"
  name: string;
  currency: string;
  timezone_name: string;
  /** 1 = active; anything else means the account can't spend. */
  account_status: number;
  business_name?: string;
}

/**
 * Reads ONE ad account directly. Enumerating `me/adaccounts` needs
 * business_management (it walks the business's asset graph), but fetching an
 * account you've been granted needs only ads_read — so this is the escape
 * hatch when the broader permission isn't on the token.
 */
export async function getAdAccount(token: string, id: string): Promise<AdAccount> {
  const act = id.trim().startsWith("act_") ? id.trim() : `act_${id.trim().replace(/\D/g, "")}`;
  const a = await graph<{
    id: string;
    account_id: string;
    name?: string;
    currency?: string;
    timezone_name?: string;
    account_status?: number;
    business?: { name?: string };
  }>(act, token, { fields: "id,account_id,name,currency,timezone_name,account_status,business{name}" }, { account: act });
  return {
    id: a.id,
    account_id: a.account_id,
    name: a.name || a.id,
    currency: a.currency || "",
    timezone_name: a.timezone_name || "",
    account_status: a.account_status ?? 0,
    business_name: a.business?.name,
  };
}

/** Resolves a list of ids, keeping per-id failures instead of failing the lot. */
export async function resolveAdAccounts(
  token: string,
  ids: string[]
): Promise<{ accounts: AdAccount[]; failures: { id: string; error: string }[] }> {
  const accounts: AdAccount[] = [];
  const failures: { id: string; error: string }[] = [];
  for (const id of ids.slice(0, 30)) {
    try {
      accounts.push(await getAdAccount(token, id));
    } catch (e) {
      failures.push({
        id,
        error: e instanceof MetaError ? `${e.message}${e.hint ? ` — ${e.hint}` : ""}` : String(e),
      });
    }
  }
  return { accounts, failures };
}

export async function listAdAccounts(token: string): Promise<AdAccount[]> {
  const rows = await graphAll<{
    id: string;
    account_id: string;
    name?: string;
    currency?: string;
    timezone_name?: string;
    account_status?: number;
    business?: { name?: string };
  }>(
    "me/adaccounts",
    token,
    { fields: "id,account_id,name,currency,timezone_name,account_status,business{name}", limit: "100" },
    20,
    "me"
  );
  return rows.map((a) => ({
    id: a.id,
    account_id: a.account_id,
    name: a.name || a.id,
    currency: a.currency || "",
    timezone_name: a.timezone_name || "",
    account_status: a.account_status ?? 0,
    business_name: a.business?.name,
  }));
}

// ---------------------------------------------------------------- insights

export interface InsightAction {
  action_type: string;
  value: string;
}

export interface RawInsightRow {
  campaign_name?: string;
  adset_name?: string;
  ad_name?: string;
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  date_start?: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  inline_link_clicks?: string;
  ctr?: string;
  cpm?: string;
  actions?: InsightAction[];
  action_values?: InsightAction[];
  cost_per_action_type?: InsightAction[];
}

export const INSIGHT_FIELDS = [
  "campaign_name",
  "adset_name",
  "ad_name",
  "campaign_id",
  "adset_id",
  "ad_id",
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "ctr",
  "cpm",
  "actions",
  "action_values",
  "cost_per_action_type",
].join(",");

export type InsightLevel = "account" | "campaign" | "adset" | "ad";

export async function fetchInsights(
  token: string,
  accountId: string,
  opts: {
    since: string;
    until: string;
    level: InsightLevel;
    limit?: number;
    maxPages?: number;
    /** Splits the answer into one row per calendar month inside the range.
     *  Meta charges a multi-month query almost exactly what it charges a
     *  one-month query, so this is how a backfill stays cheap. */
    monthly?: boolean;
  }
): Promise<RawInsightRow[]> {
  const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  return graphAll<RawInsightRow>(
    `${act}/insights`,
    token,
    {
      level: opts.level,
      fields: INSIGHT_FIELDS,
      time_range: JSON.stringify({ since: opts.since, until: opts.until }),
      limit: String(opts.limit ?? 400),
      ...(opts.monthly ? { time_increment: "monthly" } : {}),
    },
    opts.maxPages ?? 25,
    act
  );
}

/**
 * fetchInsights, but backing off on page size when Meta complains that the
 * request is too heavy.
 *
 * The obvious alternative — halving the date range — is wrong here: the same
 * ad appears in both halves with partial spend, so the two responses would
 * have to be merged ad-by-ad, and every non-additive column (frequency, CTR,
 * CPM, cost per purchase) would have to be recomputed. Asking for fewer rows
 * per page costs an extra round trip and changes no number at all.
 */
export async function fetchInsightsAdaptive(
  token: string,
  accountId: string,
  opts: { since: string; until: string; level: InsightLevel; monthly?: boolean }
): Promise<RawInsightRow[]> {
  const pageSizes = [400, 100, 25];
  for (let i = 0; i < pageSizes.length; i++) {
    try {
      return await fetchInsights(token, accountId, {
        ...opts,
        limit: pageSizes[i],
        maxPages: Math.ceil(4000 / pageSizes[i]),
      });
    } catch (e) {
      if (i === pageSizes.length - 1 || !isTooMuchData(e)) throw e;
    }
  }
  return [];
}

/**
 * A deliberately tiny insights call used by the connection test: proves the
 * token can actually READ performance (not just list the account) and reports
 * which action types this account really emits — pixel setups differ, so the
 * only trustworthy way to map "purchases" is to look at live data rather than
 * assume a name.
 */
export async function probeInsights(
  token: string,
  accountId: string,
  since: string,
  until: string
): Promise<{ rows: number; actionTypes: string[]; sampleSpend: number }> {
  const rows = await fetchInsights(token, accountId, { since, until, level: "ad", limit: 25, maxPages: 1 });
  const types = new Set<string>();
  let spend = 0;
  for (const r of rows) {
    spend += Number(r.spend ?? 0);
    for (const a of r.actions ?? []) types.add(a.action_type);
  }
  return { rows: rows.length, actionTypes: Array.from(types).sort(), sampleSpend: Math.round(spend * 100) / 100 };
}

/** Pulls a named action out of the actions/action_values arrays, trying each
 *  candidate type in order — pixel-based accounts report `offsite_conversion.
 *  fb_pixel_purchase`, Conversions-API ones report `omni_purchase`. */
export function pickAction(list: InsightAction[] | undefined, candidates: string[]): number | null {
  if (!list?.length) return null;
  for (const type of candidates) {
    const hit = list.find((a) => a.action_type === type);
    if (hit) {
      const n = Number(hit.value);
      if (!isNaN(n)) return n;
    }
  }
  return null;
}

export const ACTION_CANDIDATES = {
  purchase: ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"],
  landingPageView: ["landing_page_view", "omni_landing_page_view"],
  addToCart: ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"],
  initiateCheckout: ["omni_initiated_checkout", "initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout"],
} as const;
