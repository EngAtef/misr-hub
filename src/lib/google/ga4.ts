import { createSign } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTxId, type Ga4Row, type Ga4Transaction, type Ga4Item } from "@/lib/import/parse-ga4";

// GA4 Data API client using a Google service account. Fills the same tables
// as the manual Data Center CSV import, so the Traffic page and
// reconciliation work unchanged.
//
// Credentials come from the Settings page "Google Analytics 4 (API)" card
// (app_settings key "ga4_api": property_id + pasted service-account JSON),
// with env vars GA4_PROPERTY_ID / GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY
// as a fallback.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export interface GoogleSA {
  email: string;
  privateKey: string;
}

export interface Ga4Config extends GoogleSA {
  propertyId: string;
}

// The service account pasted in the Settings "Google Analytics 4 (API)" card
// is shared by every Google integration (GA4 + Search Console).
export async function getServiceAccount(supabase: SupabaseClient): Promise<GoogleSA | null> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "ga4_api").maybeSingle();
  const v = (data?.value ?? {}) as { service_account_json?: string };

  let email = process.env.GOOGLE_SA_EMAIL;
  let privateKey = process.env.GOOGLE_SA_PRIVATE_KEY;
  if (v.service_account_json) {
    try {
      const sa = JSON.parse(v.service_account_json) as { client_email?: string; private_key?: string };
      if (sa.client_email && sa.private_key) {
        email = sa.client_email;
        privateKey = sa.private_key;
      }
    } catch {
      // malformed paste — fall back to env vars if present
    }
  }
  privateKey = privateKey?.replace(/\\n/g, "\n");
  if (!email || !privateKey) return null;
  return { email, privateKey };
}

export async function getGa4Config(supabase: SupabaseClient): Promise<Ga4Config | null> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "ga4_api").maybeSingle();
  const v = (data?.value ?? {}) as { property_id?: string };

  let propertyId = v.property_id?.trim() || process.env.GA4_PROPERTY_ID || "";
  // tolerate "properties/123456789" or a pasted label — keep the digits
  propertyId = propertyId.replace(/\D/g, "") || propertyId;

  const sa = await getServiceAccount(supabase);
  if (!propertyId || !sa) return null;
  return { propertyId, ...sa };
}

const tokenCache = new Map<string, { token: string; exp: number }>();

const b64url = (s: string) => Buffer.from(s).toString("base64url");

export async function getAccessToken(sa: GoogleSA, scope = ANALYTICS_SCOPE): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cacheKey = `${sa.email}|${scope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.exp - 120 > now) return cached.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: sa.email, scope, aud: TOKEN_URL, iat: now, exp: now + 3600 })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(sa.privateKey).toString("base64url");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Google auth failed: ${data.error_description ?? data.error ?? res.status}`);
  }
  tokenCache.set(cacheKey, { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) });
  return data.access_token;
}

interface ReportRow {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

async function runReport(
  cfg: Ga4Config,
  body: Record<string, unknown>
): Promise<ReportRow[]> {
  const token = await getAccessToken(cfg);
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${cfg.propertyId}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, limit: "250000" }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`GA4 report failed: ${data.error?.message ?? res.status}`);
  }
  return (data.rows as ReportRow[]) ?? [];
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// month is "YYYY-MM-01"; the range is clamped to COMPLETE days only — the
// last day we ask GA4/GSC for is yesterday (UTC). A partial "today" pulled at
// 05:00 next to live orders always read as a gap on every page, so it is
// simply never stored; the 17:00 pull then finalises yesterday.
export function monthRange(month: string): { startDate: string; endDate: string } | null {
  const start = new Date(`${month}T00:00:00Z`);
  const now = new Date();
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  if (start.getTime() > yesterday.getTime()) return null;
  const monthEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const end = monthEnd.getTime() < yesterday.getTime() ? monthEnd : yesterday;
  return { startDate: month, endDate: end.toISOString().slice(0, 10) };
}

export async function fetchGa4Pages(cfg: Ga4Config, month: string): Promise<Ga4Row[]> {
  const range = monthRange(month);
  if (!range) return [];
  const rows = await runReport(cfg, {
    dateRanges: [range],
    dimensions: [{ name: "pagePath" }],
    metrics: [
      { name: "screenPageViews" },
      { name: "activeUsers" },
      { name: "screenPageViewsPerUser" },
      { name: "eventCount" },
      { name: "addToCarts" },
      { name: "keyEvents" },
      { name: "totalRevenue" },
      { name: "bounceRate" },
      { name: "engagementRate" },
      { name: "userEngagementDuration" },
    ],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
  });
  return rows
    .filter((r) => r.dimensionValues[0]?.value)
    .map((r) => {
      const m = r.metricValues;
      const users = num(m[1]?.value);
      const engagementSecs = num(m[9]?.value);
      return {
        period_month: month,
        page_path: r.dimensionValues[0].value,
        views: num(m[0]?.value),
        active_users: users,
        views_per_user: num(m[2]?.value),
        avg_engagement_secs:
          engagementSecs != null && users ? Math.round(engagementSecs / users) : null,
        event_count: num(m[3]?.value),
        add_to_carts: num(m[4]?.value),
        key_events: num(m[5]?.value),
        total_revenue: num(m[6]?.value),
        bounce_rate: num(m[7]?.value),
        engagement_rate: num(m[8]?.value),
      };
    });
}

// Transactions with their session source/medium/campaign so orders can be
// attributed to channels. A transaction occasionally spans two attribution
// rows; the row with the most purchases wins.
export type Ga4TxAttributed = Ga4Transaction & {
  source: string | null;
  medium: string | null;
  campaign: string | null;
};

export async function fetchGa4Transactions(cfg: Ga4Config, month: string): Promise<Ga4TxAttributed[]> {
  const range = monthRange(month);
  if (!range) return [];
  const rows = await runReport(cfg, {
    dateRanges: [range],
    dimensions: [
      { name: "transactionId" },
      { name: "sessionSource" },
      { name: "sessionMedium" },
      { name: "sessionCampaignName" },
    ],
    metrics: [{ name: "ecommercePurchases" }, { name: "purchaseRevenue" }],
    orderBys: [{ metric: { metricName: "ecommercePurchases" }, desc: true }],
  });
  const seen = new Set<string>();
  const out: Ga4TxAttributed[] = [];
  for (const r of rows) {
    const raw = r.dimensionValues[0]?.value?.trim();
    if (!raw || raw === "(not set)" || raw === "0") continue;
    const id = normalizeTxId(raw);
    if (!id || id === "0" || seen.has(id)) continue;
    seen.add(id);
    out.push({
      transaction_id: id,
      period_month: month,
      purchases: num(r.metricValues[0]?.value),
      revenue: num(r.metricValues[1]?.value),
      source: r.dimensionValues[1]?.value ?? null,
      medium: r.dimensionValues[2]?.value ?? null,
      campaign: r.dimensionValues[3]?.value ?? null,
    });
  }
  return out;
}

const ga4Date = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;

export interface Ga4DailyRow {
  date: string;
  sessions: number | null;
  active_users: number | null;
  views: number | null;
  add_to_carts: number | null;
  checkouts: number | null;
  purchases: number | null;
  revenue: number | null;
  imported_at?: string;
}

export async function fetchGa4Daily(cfg: Ga4Config, month: string): Promise<Ga4DailyRow[]> {
  const range = monthRange(month);
  if (!range) return [];
  const rows = await runReport(cfg, {
    dateRanges: [range],
    dimensions: [{ name: "date" }],
    metrics: [
      { name: "sessions" },
      { name: "activeUsers" },
      { name: "screenPageViews" },
      { name: "addToCarts" },
      { name: "checkouts" },
      { name: "ecommercePurchases" },
      { name: "purchaseRevenue" },
    ],
  });
  return rows
    .filter((r) => /^\d{8}$/.test(r.dimensionValues[0]?.value ?? ""))
    .map((r) => ({
      date: ga4Date(r.dimensionValues[0].value),
      sessions: num(r.metricValues[0]?.value),
      active_users: num(r.metricValues[1]?.value),
      views: num(r.metricValues[2]?.value),
      add_to_carts: num(r.metricValues[3]?.value),
      checkouts: num(r.metricValues[4]?.value),
      purchases: num(r.metricValues[5]?.value),
      revenue: num(r.metricValues[6]?.value),
      // upserts don't touch a column default, so stamp explicitly — this is
      // what the GAPS freshness panel reads as "last sync"
      imported_at: new Date().toISOString(),
    }));
}

export interface Ga4SourceRow {
  date: string;
  source: string;
  medium: string;
  campaign: string;
  sessions: number | null;
  active_users: number | null;
  add_to_carts: number | null;
  purchases: number | null;
  revenue: number | null;
}

export async function fetchGa4Sources(cfg: Ga4Config, month: string): Promise<Ga4SourceRow[]> {
  const range = monthRange(month);
  if (!range) return [];
  const rows = await runReport(cfg, {
    dateRanges: [range],
    dimensions: [
      { name: "date" },
      { name: "sessionSource" },
      { name: "sessionMedium" },
      { name: "sessionCampaignName" },
    ],
    metrics: [
      { name: "sessions" },
      { name: "activeUsers" },
      { name: "addToCarts" },
      { name: "ecommercePurchases" },
      { name: "purchaseRevenue" },
    ],
  });
  const seen = new Set<string>();
  const out: Ga4SourceRow[] = [];
  for (const r of rows) {
    if (!/^\d{8}$/.test(r.dimensionValues[0]?.value ?? "")) continue;
    const row: Ga4SourceRow = {
      date: ga4Date(r.dimensionValues[0].value),
      source: r.dimensionValues[1]?.value ?? "",
      medium: r.dimensionValues[2]?.value ?? "",
      campaign: r.dimensionValues[3]?.value ?? "",
      sessions: num(r.metricValues[0]?.value),
      active_users: num(r.metricValues[1]?.value),
      add_to_carts: num(r.metricValues[2]?.value),
      purchases: num(r.metricValues[3]?.value),
      revenue: num(r.metricValues[4]?.value),
    };
    const key = `${row.date}|${row.source}|${row.medium}|${row.campaign}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export async function fetchGa4Items(cfg: Ga4Config, month: string): Promise<Ga4Item[]> {
  const range = monthRange(month);
  if (!range) return [];
  const rows = await runReport(cfg, {
    dateRanges: [range],
    dimensions: [{ name: "itemName" }],
    metrics: [
      { name: "itemsViewed" },
      { name: "itemsAddedToCart" },
      { name: "itemsPurchased" },
      { name: "itemRevenue" },
    ],
  });
  const seen = new Set<string>();
  const out: Ga4Item[] = [];
  for (const r of rows) {
    const name = r.dimensionValues[0]?.value?.trim();
    if (!name || name === "(not set)" || seen.has(name)) continue;
    seen.add(name);
    out.push({
      period_month: month,
      item_name: name,
      items_viewed: num(r.metricValues[0]?.value),
      items_added: num(r.metricValues[1]?.value),
      items_purchased: num(r.metricValues[2]?.value),
      item_revenue: num(r.metricValues[3]?.value),
    });
  }
  return out;
}

// ---- monthly audience reports (phase 2) ----

interface MonthlyRow {
  period_month: string;
  [k: string]: string | number | null;
}

async function fetchMonthlyReport(
  cfg: Ga4Config,
  month: string,
  dimension: string,
  keyColumn: string,
  metrics: { api: string; column: string }[],
  skipValues: string[] = ["(not set)"]
): Promise<MonthlyRow[]> {
  const range = monthRange(month);
  if (!range) return [];
  const rows = await runReport(cfg, {
    dateRanges: [range],
    dimensions: [{ name: dimension }],
    metrics: metrics.map((m) => ({ name: m.api })),
  });
  const seen = new Set<string>();
  const out: MonthlyRow[] = [];
  for (const r of rows) {
    const key = r.dimensionValues[0]?.value?.trim();
    if (!key || skipValues.includes(key) || seen.has(key)) continue;
    seen.add(key);
    const row: MonthlyRow = { period_month: month, [keyColumn]: key };
    metrics.forEach((m, i) => {
      row[m.column] = num(r.metricValues[i]?.value);
    });
    out.push(row);
  }
  return out;
}

const SESSION_ECOM_METRICS = [
  { api: "sessions", column: "sessions" },
  { api: "activeUsers", column: "active_users" },
  { api: "addToCarts", column: "add_to_carts" },
  { api: "ecommercePurchases", column: "purchases" },
  { api: "purchaseRevenue", column: "revenue" },
];

export const fetchGa4SearchTerms = (cfg: Ga4Config, month: string) =>
  fetchMonthlyReport(cfg, month, "searchTerm", "term", [
    { api: "sessions", column: "sessions" },
    { api: "eventCount", column: "searches" },
  ]);

export const fetchGa4Cities = (cfg: Ga4Config, month: string) =>
  fetchMonthlyReport(cfg, month, "city", "city", SESSION_ECOM_METRICS);

export const fetchGa4Devices = (cfg: Ga4Config, month: string) =>
  fetchMonthlyReport(cfg, month, "deviceCategory", "device", SESSION_ECOM_METRICS);

export const fetchGa4Landing = (cfg: Ga4Config, month: string) =>
  fetchMonthlyReport(cfg, month, "landingPage", "landing_page", [
    { api: "sessions", column: "sessions" },
    { api: "activeUsers", column: "active_users" },
    { api: "bounceRate", column: "bounce_rate" },
    { api: "ecommercePurchases", column: "purchases" },
    { api: "purchaseRevenue", column: "revenue" },
  ]);

export interface Ga4HourRow {
  period_month: string;
  dow: number;
  hour: number;
  sessions: number | null;
  purchases: number | null;
}

export async function fetchGa4Hours(cfg: Ga4Config, month: string): Promise<Ga4HourRow[]> {
  const range = monthRange(month);
  if (!range) return [];
  const rows = await runReport(cfg, {
    dateRanges: [range],
    dimensions: [{ name: "dayOfWeek" }, { name: "hour" }],
    metrics: [{ name: "sessions" }, { name: "ecommercePurchases" }],
  });
  const seen = new Set<string>();
  const out: Ga4HourRow[] = [];
  for (const r of rows) {
    const dow = Number(r.dimensionValues[0]?.value);
    const hour = Number(r.dimensionValues[1]?.value);
    if (!Number.isInteger(dow) || !Number.isInteger(hour)) continue;
    const key = `${dow}|${hour}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      period_month: month,
      dow,
      hour,
      sessions: num(r.metricValues[0]?.value),
      purchases: num(r.metricValues[1]?.value),
    });
  }
  return out;
}

// Current month plus the previous one — GA4 data can lag ~48h, so re-syncing
// the previous month for a few days after month end keeps it accurate.
export function defaultSyncMonths(): string[] {
  const now = new Date();
  const cur = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return [prev.toISOString().slice(0, 10), cur.toISOString().slice(0, 10)];
}

export function backfillMonths(count: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 10));
  }
  return out;
}

export interface Ga4SyncResult {
  month: string;
  pages: number;
  transactions: number;
  items: number;
  daily: number;
  sources: number;
  audience: number;
}

// Mirrors the manual Data Center import exactly: pages/items replace the
// month's rows, transactions upsert by id (merged across all uploads).
// Daily metrics and traffic sources upsert on their natural keys.
export async function syncGa4Month(
  cfg: Ga4Config,
  supabase: SupabaseClient,
  month: string
): Promise<Ga4SyncResult> {
  // audience reports are non-critical — one failing (e.g. an incompatible
  // dimension on this property) must not break the core sync
  const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
  const [pages, transactions, items, daily, sources, searchTerms, cities, devices, landing, hours] =
    await Promise.all([
      fetchGa4Pages(cfg, month),
      fetchGa4Transactions(cfg, month),
      fetchGa4Items(cfg, month),
      fetchGa4Daily(cfg, month),
      fetchGa4Sources(cfg, month),
      safe(fetchGa4SearchTerms(cfg, month)),
      safe(fetchGa4Cities(cfg, month)),
      safe(fetchGa4Devices(cfg, month)),
      safe(fetchGa4Landing(cfg, month)),
      safe(fetchGa4Hours(cfg, month)),
    ]);

  if (pages.length) {
    await supabase.from("ga4_pages").delete().eq("period_month", month);
    for (let i = 0; i < pages.length; i += 500) {
      const { error } = await supabase.from("ga4_pages").insert(pages.slice(i, i + 500));
      if (error) throw new Error(`ga4_pages: ${error.message}`);
    }
  }

  for (let i = 0; i < transactions.length; i += 1000) {
    const { error } = await supabase
      .from("ga4_transactions")
      .upsert(transactions.slice(i, i + 1000), { onConflict: "transaction_id" });
    if (error) throw new Error(`ga4_transactions: ${error.message}`);
  }

  if (items.length) {
    await supabase.from("ga4_items").delete().eq("period_month", month);
    for (let i = 0; i < items.length; i += 1000) {
      const { error } = await supabase.from("ga4_items").insert(items.slice(i, i + 1000));
      if (error) throw new Error(`ga4_items: ${error.message}`);
    }
  }

  for (let i = 0; i < daily.length; i += 500) {
    const { error } = await supabase
      .from("ga4_daily")
      .upsert(daily.slice(i, i + 500), { onConflict: "date" });
    if (error) throw new Error(`ga4_daily: ${error.message}`);
  }

  for (let i = 0; i < sources.length; i += 1000) {
    const { error } = await supabase
      .from("ga4_sources")
      .upsert(sources.slice(i, i + 1000), { onConflict: "date,source,medium,campaign" });
    if (error) throw new Error(`ga4_sources: ${error.message}`);
  }

  const monthly: [string, (MonthlyRow | Ga4HourRow)[]][] = [
    ["ga4_search_terms", searchTerms],
    ["ga4_cities", cities],
    ["ga4_devices", devices],
    ["ga4_landing", landing.slice(0, 2000)],
    ["ga4_hours", hours],
  ];
  for (const [table, rows] of monthly) {
    if (!rows.length) continue;
    await supabase.from(table).delete().eq("period_month", month);
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await supabase.from(table).insert(rows.slice(i, i + 1000));
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  }

  return {
    month,
    pages: pages.length,
    transactions: transactions.length,
    items: items.length,
    daily: daily.length,
    sources: sources.length,
    audience: searchTerms.length + cities.length + devices.length + landing.length,
  };
}
