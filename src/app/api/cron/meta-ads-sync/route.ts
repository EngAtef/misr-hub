import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncAccount, monthWindow } from "@/lib/meta-ads/sync";
import { runBackfillStep } from "@/lib/meta-ads/backfill";
import { RateLimitedError } from "@/lib/meta-ads/throttle";

export const maxDuration = 60;

interface MappedAccount {
  id: string;
  label: string;
  enabled: boolean;
}

/**
 * Twice-daily refresh from the Meta Marketing API — 09:00 and 21:00 Cairo.
 *
 * Re-syncing the same account + period refreshes that period in place, so
 * running twice a day simply keeps the open month current: spend and
 * conversions both keep moving for days after the fact as Meta finalises
 * attribution. In the first three days of a month the previous month is
 * refreshed too, for the same reason.
 *
 * Whatever time is left goes to draining the history backfill queue, so a
 * backfill someone started in the browser finishes on its own even if they
 * closed the tab.
 *
 * Runs through the service-role client because a cron has no session; the
 * whole route is gated on CRON_SECRET instead.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const isVercelCron = request.headers.get("x-vercel-cron") !== null;
  if (secret && !isVercelCron && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  const started = Date.now();

  // ?mode=backfill spends the whole budget draining the history queue instead
  // of refreshing the open month first. Vercel's scheduled call never passes
  // it, so the twice-daily behaviour is unchanged — this is for finishing a
  // backfill quickly without holding a browser tab open.
  const backfillOnly = request.nextUrl.searchParams.get("mode") === "backfill";

  const [{ data: metaRow }, { data: mapRow }] = await Promise.all([
    db.from("app_settings").select("value").eq("key", "meta").maybeSingle(),
    db.from("app_settings").select("value").eq("key", "meta_ads").maybeSingle(),
  ]);

  const ads = (mapRow?.value ?? {}) as { access_token?: string; accounts?: MappedAccount[]; enabled?: boolean };
  // an operator who switched the integration off expects the scheduled job to
  // stop too, not just the buttons
  if (ads.enabled === false) {
    return NextResponse.json({ ok: false, skipped: "integration disabled" });
  }
  const token = ads.access_token || ((metaRow?.value ?? {}) as { access_token?: string }).access_token || "";
  const accounts = (ads.accounts ?? []).filter((a) => a.enabled);

  if (!token || !accounts.length) {
    return NextResponse.json({ ok: false, skipped: !token ? "no token" : "no accounts selected" });
  }

  // Meta keeps restating a month for a few days, so at the turn of the month
  // the one that just closed still needs a last look.
  const now = new Date();
  const windows = [monthWindow(now)];
  if (now.getUTCDate() <= 3) {
    windows.push(monthWindow(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))));
  }

  const results: Record<string, unknown>[] = [];
  let rateLimited = false;

  for (const { since, until } of backfillOnly ? [] : windows) {
    for (const account of accounts) {
      // leave headroom so a slow account can't take the whole run down with it
      if (rateLimited || Date.now() - started > 35_000) {
        results.push({ account: account.label, period: `${since}..${until}`, skipped: "time budget" });
        continue;
      }
      try {
        const r = await syncAccount(db, token, { id: account.id, label: account.label }, since, until);
        results.push({
          account: r.label,
          period: `${since}..${until}`,
          rows: r.rows,
          adRows: r.adRows,
          spend: r.spend,
          withLinks: r.withLinks,
          superseded: r.superseded,
        });
      } catch (e) {
        if (e instanceof RateLimitedError) rateLimited = true;
        results.push({
          account: account.label,
          period: `${since}..${until}`,
          error: e instanceof Error ? e.message : "failed",
        });
      }
    }
  }

  // anything left in the history queue gets whatever time remains
  let backfill: unknown = null;
  const remaining = 52_000 - (Date.now() - started);
  if (!rateLimited && remaining > 18_000) {
    try {
      backfill = await runBackfillStep(db, token, { budgetMs: remaining });
    } catch (e) {
      backfill = { error: e instanceof Error ? e.message : "backfill step failed" };
    }
  }

  // ads whose destination now resolves to a known custom list get connected
  // without anyone touching the mapping screen. Last, so it sees the rows this
  // run just wrote.
  let linked: unknown = null;
  try {
    const { data } = await db.rpc("fn_ads_autolink");
    linked = data;
  } catch {
    /* autolink is a convenience, never a reason to fail the run */
  }

  const { data: progress } = await db.rpc("fn_ads_backfill_progress");
  return NextResponse.json({ ok: true, mode: backfillOnly ? "backfill" : "refresh", windows, results, backfill, linked, progress });
}
