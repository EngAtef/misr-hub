// Staying inside Meta's rate limits, by their own rules.
//
// The Marketing API doesn't publish a simple "N calls per minute". It scores
// each ad account on three axes over a rolling hour — number of calls, CPU
// time, wall time — and reports all three back as percentages of the ceiling
// on every response. Meta's guidance is explicit that the way to avoid a block
// is to READ those percentages and slow down before hitting 100, because once
// you're throttled every further request extends the lockout.
//
//   https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
//
// So this module keeps a per-account view of the last headers we saw and makes
// the caller wait when the account is getting warm. It is deliberately
// pessimistic: an ads report that arrives ten minutes late costs nothing, an
// hour-long block costs a day of data.

/** Percentages at or above this make us pause before the next call. */
const WARN_PCT = 60;
/** At or above this we stop the account for the rest of the run. */
const STOP_PCT = 85;
/** Floor between two calls on the same ad account, milliseconds. */
const MIN_GAP_MS = 350;
/** How long to pause when an account is in the warm band. */
const COOL_MS = 4_000;

export interface UsageSnapshot {
  callCount: number;
  totalCpuTime: number;
  totalTime: number;
  /** Minutes Meta says we must wait. Non-zero means we are already throttled. */
  regainMinutes: number;
  tier?: string;
  at: number;
}

export interface ThrottleReport {
  account: string;
  usage: UsageSnapshot;
  waits: number;
  waitedMs: number;
}

const usage = new Map<string, UsageSnapshot>();
const lastCallAt = new Map<string, number>();
const blockedUntil = new Map<string, number>();
const waited = new Map<string, { waits: number; ms: number }>();

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Meta's own phrasing: "the more calls you make while throttled, the longer
 *  it takes to recover". A blocked account is skipped, not retried. */
export class RateLimitedError extends Error {
  constructor(readonly account: string, readonly minutes: number) {
    super(
      minutes > 0
        ? `Meta rate-limited ${account} — it needs about ${minutes} more minute(s) before it will answer again`
        : `Meta rate-limited ${account}`
    );
    this.name = "RateLimitedError";
  }
}

function highest(u: UsageSnapshot): number {
  return Math.max(u.callCount, u.totalCpuTime, u.totalTime);
}

/**
 * X-Business-Use-Case-Usage is keyed by business/account id and holds one
 * entry per rate-limit type; we care about ads_insights and ads_management.
 * X-App-Usage and X-Ad-Account-Usage are the older, coarser headers — read as
 * a fallback so we still throttle on accounts that only report those.
 */
export function recordUsage(account: string, headers: Headers): UsageSnapshot | null {
  const bare = account.replace(/^act_/, "");
  let snap: UsageSnapshot | null = null;

  const buc = headers.get("x-business-use-case-usage");
  if (buc) {
    try {
      const parsed = JSON.parse(buc) as Record<
        string,
        {
          type?: string;
          call_count?: number;
          total_cputime?: number;
          total_time?: number;
          estimated_time_to_regain_access?: number;
          ads_api_access_tier?: string;
        }[]
      >;
      // prefer this account's own entry, but any entry in the payload is still
      // a signal worth obeying
      const entries = parsed[bare] ?? parsed[account] ?? Object.values(parsed).flat();
      for (const e of Array.isArray(entries) ? entries : []) {
        const s: UsageSnapshot = {
          callCount: Number(e.call_count ?? 0),
          totalCpuTime: Number(e.total_cputime ?? 0),
          totalTime: Number(e.total_time ?? 0),
          regainMinutes: Number(e.estimated_time_to_regain_access ?? 0),
          tier: e.ads_api_access_tier,
          at: Date.now(),
        };
        if (!snap || highest(s) > highest(snap)) snap = s;
      }
    } catch {
      /* a malformed header must never break a working sync */
    }
  }

  if (!snap) {
    const app = headers.get("x-app-usage");
    if (app) {
      try {
        const a = JSON.parse(app) as { call_count?: number; total_cputime?: number; total_time?: number };
        snap = {
          callCount: Number(a.call_count ?? 0),
          totalCpuTime: Number(a.total_cputime ?? 0),
          totalTime: Number(a.total_time ?? 0),
          regainMinutes: 0,
          at: Date.now(),
        };
      } catch {
        /* ignore */
      }
    }
  }

  const acct = headers.get("x-ad-account-usage");
  if (acct) {
    try {
      const a = JSON.parse(acct) as { acc_id_util_pct?: number; ads_api_access_tier?: string };
      const pct = Number(a.acc_id_util_pct ?? 0);
      if (!snap) snap = { callCount: pct, totalCpuTime: 0, totalTime: 0, regainMinutes: 0, at: Date.now() };
      else snap.callCount = Math.max(snap.callCount, pct);
      snap.tier = snap.tier ?? a.ads_api_access_tier;
    } catch {
      /* ignore */
    }
  }

  if (!snap) return null;
  usage.set(account, snap);

  if (snap.regainMinutes > 0) {
    blockedUntil.set(account, Date.now() + snap.regainMinutes * 60_000);
  } else if (highest(snap) >= STOP_PCT) {
    // Meta hasn't blocked us yet, but we are close enough that the next heavy
    // query could tip it. Sit the account out rather than find out.
    blockedUntil.set(account, Date.now() + 10 * 60_000);
  }
  return snap;
}

/** Called before every request. Spaces calls out, waits through the warm band,
 *  and refuses outright once the account is blocked. */
export async function beforeCall(account: string): Promise<void> {
  const until = blockedUntil.get(account) ?? 0;
  if (until > Date.now()) {
    throw new RateLimitedError(account, Math.ceil((until - Date.now()) / 60_000));
  }

  const last = lastCallAt.get(account) ?? 0;
  const gap = Date.now() - last;
  if (gap < MIN_GAP_MS) await pause(account, MIN_GAP_MS - gap);

  const u = usage.get(account);
  if (u && highest(u) >= WARN_PCT) {
    // linear back-off through the warm band: 60% waits 4s, 84% waits ~24s
    const over = (highest(u) - WARN_PCT) / (STOP_PCT - WARN_PCT);
    await pause(account, Math.round(COOL_MS * (1 + over * 5)));
  }

  lastCallAt.set(account, Date.now());
}

async function pause(account: string, ms: number) {
  const w = waited.get(account) ?? { waits: 0, ms: 0 };
  w.waits += 1;
  w.ms += ms;
  waited.set(account, w);
  await sleep(ms);
}

/** Marks an account as untouchable for `minutes` — used when Meta answers with
 *  a throttling error code rather than a header. */
export function blockAccount(account: string, minutes: number) {
  blockedUntil.set(account, Date.now() + Math.max(1, minutes) * 60_000);
}

export function isBlocked(account: string): boolean {
  return (blockedUntil.get(account) ?? 0) > Date.now();
}

export function usageReport(account: string): ThrottleReport | null {
  const u = usage.get(account);
  if (!u) return null;
  const w = waited.get(account) ?? { waits: 0, ms: 0 };
  return { account, usage: u, waits: w.waits, waitedMs: w.ms };
}

/** Serverless instances are reused, so the maps persist between requests —
 *  which is exactly what we want for rate limiting. Only the wait counters are
 *  per-run bookkeeping and get cleared. */
export function resetRunCounters() {
  waited.clear();
}
