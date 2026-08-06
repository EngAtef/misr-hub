// Meta Marketing API — reading ad performance straight from the source, so
// the Ads Center no longer depends on hand-exported spreadsheets.
//
// Separate from src/lib/marketing/meta.ts, which does Page/IG publishing and
// boosting on an older Graph version. This module only ever READS.

export const GRAPH_VERSION = "v26.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

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
  if (code === 17 || code === 4) return "Meta rate limit hit — wait a few minutes and try again";
  if (code === 803) return "That object exists but this token can't see it — check asset assignment";
  return undefined;
}

async function graph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH}/${path}?${qs}`, { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as T & GraphErrorBody;
  if (!res.ok || json.error) {
    const e = json.error;
    throw new MetaError(
      e?.error_user_msg || e?.message || `Meta API error (${res.status})`,
      res.status,
      e?.code,
      e?.error_subcode,
      hintFor(e?.code, e?.error_subcode)
    );
  }
  return json;
}

/** Follows `paging.next` cursors, with a hard page cap so a runaway account
 *  can't spin forever inside a 60s serverless function. */
async function graphAll<T>(path: string, token: string, params: Record<string, string>, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const r = await graph<{ data: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      path,
      token,
      after ? { ...params, after } : params
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
  }>(act, token, { fields: "id,account_id,name,currency,timezone_name,account_status,business{name}" });
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
  }>("me/adaccounts", token, {
    fields: "id,account_id,name,currency,timezone_name,account_status,business{name}",
    limit: "100",
  });
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
  opts: { since: string; until: string; level: InsightLevel; limit?: number; maxPages?: number }
): Promise<RawInsightRow[]> {
  const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  return graphAll<RawInsightRow>(
    `${act}/insights`,
    token,
    {
      level: opts.level,
      fields: INSIGHT_FIELDS,
      time_range: JSON.stringify({ since: opts.since, until: opts.until }),
      limit: String(opts.limit ?? 200),
    },
    opts.maxPages ?? 25
  );
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
