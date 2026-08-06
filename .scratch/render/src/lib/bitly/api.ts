// Bitly v4 API client.
//
// Bitly rate-limits per endpoint and the free plan is stingy, so the sync is
// built around the ONE bulk endpoint that returns click counts for a whole
// group (`/groups/{guid}/bitlinks/clicks`) and only spends per-link requests
// on the handful of links that actually matter.

const BASE = "https://api-ssl.bitly.com/v4";

export interface BitlyCreds {
  access_token?: string;
  group_guid?: string;
}

// Explicit fields rather than constructor parameter properties: the repo runs
// tests through `node --experimental-strip-types`, which rejects those.
export class BitlyError extends Error {
  status: number;
  hint?: string;
  constructor(message: string, status: number, hint?: string) {
    super(message);
    this.name = "BitlyError";
    this.status = status;
    this.hint = hint;
  }
}

async function call<T>(creds: BitlyCreds, path: string, params?: Record<string, string | number>): Promise<T> {
  if (!creds.access_token) throw new BitlyError("No Bitly access token configured", 401);
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${creds.access_token}`, Accept: "application/json" },
    cache: "no-store",
  });

  if (res.status === 429) {
    // Bitly returns the reset epoch, not a delay
    const reset = res.headers.get("x-ratelimit-reset");
    throw new BitlyError(
      "Bitly rate limit reached",
      429,
      reset ? `Resets at ${new Date(Number(reset) * 1000).toISOString()}` : "Try again in an hour"
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let detail = body.slice(0, 300);
    try {
      const j = JSON.parse(body) as { message?: string; description?: string };
      detail = j.description || j.message || detail;
    } catch {
      /* keep the raw body */
    }
    throw new BitlyError(
      `Bitly ${res.status}: ${detail}`,
      res.status,
      res.status === 403
        ? "The token is valid but the plan or group doesn't allow this endpoint"
        : res.status === 401
        ? "The access token was rejected — generate a new one in Bitly settings"
        : undefined
    );
  }
  return (await res.json()) as T;
}

// ------------------------------------------------------------------ shapes

export interface BitlyUser {
  login: string;
  name: string;
  email?: string;
  default_group_guid: string;
}

export interface BitlyGroup {
  guid: string;
  name: string;
  organization_guid: string;
}

export interface BitlyLink {
  id: string; // "bit.ly/3abcDEF"
  link: string; // "https://bit.ly/3abcDEF"
  long_url: string;
  title?: string;
  archived?: boolean;
  created_at?: string;
  tags?: string[];
}

interface Paginated<T> {
  links: T[];
  pagination?: { next?: string; search_after?: string; size?: number };
}

export async function getUser(creds: BitlyCreds) {
  return call<BitlyUser>(creds, "/user");
}

export async function getGroups(creds: BitlyCreds) {
  const r = await call<{ groups: BitlyGroup[] }>(creds, "/groups");
  return r.groups ?? [];
}

/** Every bitlink in the group. Cursor-paginated via `search_after`. */
export async function listLinks(creds: BitlyCreds, groupGuid: string, max = 500): Promise<BitlyLink[]> {
  const out: BitlyLink[] = [];
  let searchAfter: string | undefined;
  while (out.length < max) {
    const page: Paginated<BitlyLink> = await call(creds, `/groups/${groupGuid}/bitlinks`, {
      size: 50,
      ...(searchAfter ? { search_after: searchAfter } : {}),
    });
    const links = page.links ?? [];
    out.push(...links);
    searchAfter = page.pagination?.search_after;
    if (!searchAfter || links.length === 0) break;
  }
  return out.slice(0, max);
}

/** Bulk click counts for the group — one request instead of one per link. */
export async function listSortedClicks(
  creds: BitlyCreds,
  groupGuid: string,
  days: number,
  size = 250
): Promise<{ links: BitlyLink[]; clicks: Map<string, number> }> {
  const r = await call<{ links: BitlyLink[]; sorted_links: { id: string; clicks: number }[] }>(
    creds,
    `/groups/${groupGuid}/bitlinks/clicks`,
    { unit: "day", units: days, size }
  );
  const clicks = new Map<string, number>();
  for (const s of r.sorted_links ?? []) clicks.set(s.id, s.clicks ?? 0);
  return { links: r.links ?? [], clicks };
}

/** Day-by-day series for one link. */
export async function linkDailyClicks(creds: BitlyCreds, bitlink: string, days: number) {
  const r = await call<{ link_clicks: { date: string; clicks: number }[] }>(
    creds,
    `/bitlinks/${encodeURIComponent(bitlink)}/clicks`,
    { unit: "day", units: days }
  );
  return (r.link_clicks ?? []).map((d) => ({ date: (d.date ?? "").slice(0, 10), clicks: d.clicks ?? 0 }));
}

export async function linkMetrics(creds: BitlyCreds, bitlink: string, kind: "referrers" | "countries", days: number) {
  const r = await call<{ metrics: { value: string; clicks: number }[] }>(
    creds,
    `/bitlinks/${encodeURIComponent(bitlink)}/${kind}`,
    { unit: "day", units: days, size: 25 }
  );
  return (r.metrics ?? []).map((m) => ({ value: m.value || "direct", clicks: m.clicks ?? 0 }));
}

// ------------------------------------------------------------------ parsing

export interface ParsedDest {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  dest_host: string | null;
  dest_path: string | null;
}

/** Pulls the UTM tags out of a bitlink's destination — this is what joins a
 *  short link to a Meta campaign, a GA4 session and an order. */
export function parseDestination(longUrl: string | null | undefined): ParsedDest {
  const empty: ParsedDest = {
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    dest_host: null,
    dest_path: null,
  };
  if (!longUrl) return empty;
  try {
    const u = new URL(longUrl);
    const q = (k: string) => {
      const v = u.searchParams.get(k);
      return v && v.trim() ? decodeURIComponent(v.trim()) : null;
    };
    return {
      utm_source: q("utm_source"),
      utm_medium: q("utm_medium"),
      utm_campaign: q("utm_campaign"),
      utm_content: q("utm_content"),
      utm_term: q("utm_term"),
      dest_host: u.hostname,
      dest_path: u.pathname,
    };
  } catch {
    return empty;
  }
}
