import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listLinks,
  listSortedClicks,
  linkDailyClicks,
  linkMetrics,
  parseDestination,
  getUser,
  BitlyError,
  type BitlyCreds,
  type BitlyLink,
} from "./api";

export interface SyncOptions {
  days: number;
  /** Stop starting new per-link requests after this many ms — the route has a
   *  60s ceiling and a half-finished sync that reports honestly beats a 504. */
  budgetMs?: number;
  /** How many links get a day-by-day series / referrer + country breakdown. */
  detailTop?: number;
  metricsTop?: number;
}

export interface SyncResult {
  linksSeen: number;
  linksDetailed: number;
  clickRows: number;
  metricRows: number;
  from: string;
  to: string;
  truncated: boolean;
  warning?: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Runs a small pool of promises so one slow link can't stall the batch. */
async function pooled<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

export async function syncBitly(
  db: SupabaseClient,
  creds: BitlyCreds,
  groupGuid: string,
  opts: SyncOptions
): Promise<SyncResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 45_000;
  const detailTop = opts.detailTop ?? 60;
  const metricsTop = opts.metricsTop ?? 25;
  const days = Math.min(Math.max(opts.days, 1), 365);

  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86400000);

  // 1. the whole link catalogue, plus 2. bulk click totals in one request
  const [catalogue, sorted] = await Promise.all([
    listLinks(creds, groupGuid, 500),
    listSortedClicks(creds, groupGuid, days).catch((e) => {
      // free plans can refuse the bulk endpoint — carry on without totals
      if (e instanceof BitlyError && (e.status === 403 || e.status === 404)) {
        return { links: [] as BitlyLink[], clicks: new Map<string, number>() };
      }
      throw e;
    }),
  ]);

  const byId = new Map<string, BitlyLink>();
  for (const l of [...catalogue, ...sorted.links]) if (l?.id) byId.set(l.id, l);

  const rows = Array.from(byId.values()).map((l) => ({
    id: l.id,
    link: l.link ?? `https://${l.id}`,
    long_url: l.long_url ?? null,
    title: l.title ?? null,
    tags: l.tags ?? null,
    archived: !!l.archived,
    group_guid: groupGuid,
    bitly_created_at: l.created_at ?? null,
    ...parseDestination(l.long_url),
    total_clicks: sorted.clicks.get(l.id) ?? 0,
  }));

  if (rows.length) {
    const { error } = await db.rpc("fn_bitly_upsert_links", { p_rows: rows });
    if (error) throw new Error(`Saving links failed: ${error.message}`);
  }

  // 3. day-by-day series for the links that carry the traffic
  const ranked = [...rows].sort((a, b) => b.total_clicks - a.total_clicks);
  const detailTargets = ranked.filter((r) => r.total_clicks > 0).slice(0, detailTop);
  const truncatedAt = { hit: false };

  const clickRows: { bitlink_id: string; date: string; clicks: number }[] = [];
  await pooled(detailTargets, 4, async (r) => {
    if (Date.now() - started > budget) {
      truncatedAt.hit = true;
      return;
    }
    try {
      for (const d of await linkDailyClicks(creds, r.id, days)) {
        if (d.date) clickRows.push({ bitlink_id: r.id, date: d.date, clicks: d.clicks });
      }
    } catch (e) {
      if (e instanceof BitlyError && e.status === 429) truncatedAt.hit = true;
      else if (!(e instanceof BitlyError)) throw e;
    }
  });

  if (clickRows.length) {
    const { error } = await db.rpc("fn_bitly_upsert_clicks", { p_rows: clickRows });
    if (error) throw new Error(`Saving clicks failed: ${error.message}`);
  }

  // 4. where those clicks came from
  const metricRows: {
    bitlink_id: string;
    kind: string;
    value: string;
    clicks: number;
    period_start: string;
    period_end: string;
  }[] = [];
  await pooled(detailTargets.slice(0, metricsTop), 3, async (r) => {
    if (Date.now() - started > budget) {
      truncatedAt.hit = true;
      return;
    }
    for (const kind of ["referrers", "countries"] as const) {
      try {
        for (const m of await linkMetrics(creds, r.id, kind, days)) {
          metricRows.push({
            bitlink_id: r.id,
            kind: kind === "referrers" ? "referrer" : "country",
            value: m.value,
            clicks: m.clicks,
            period_start: iso(from),
            period_end: iso(to),
          });
        }
      } catch (e) {
        if (e instanceof BitlyError && e.status === 429) truncatedAt.hit = true;
        else if (!(e instanceof BitlyError)) throw e;
      }
    }
  });

  if (metricRows.length) {
    const { error } = await db.rpc("fn_bitly_upsert_metrics", { p_rows: metricRows });
    if (error) throw new Error(`Saving metrics failed: ${error.message}`);
  }

  const untagged = rows.filter((r) => !r.utm_campaign).length;
  return {
    linksSeen: rows.length,
    linksDetailed: detailTargets.length,
    clickRows: clickRows.length,
    metricRows: metricRows.length,
    from: iso(from),
    to: iso(to),
    truncated: truncatedAt.hit,
    warning:
      untagged === rows.length && rows.length > 0
        ? "None of your links carry a utm_campaign, so they can't be matched to campaigns yet"
        : undefined,
  };
}

/** Resolves the group to sync: the configured one, else the account default. */
export async function resolveGroup(creds: BitlyCreds): Promise<string> {
  if (creds.group_guid) return creds.group_guid;
  const user = await getUser(creds);
  if (!user.default_group_guid) throw new BitlyError("Bitly account has no default group", 400);
  return user.default_group_guid;
}
