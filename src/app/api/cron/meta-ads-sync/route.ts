import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncAccount, monthWindow } from "@/lib/meta-ads/sync";

export const maxDuration = 60;

interface MappedAccount {
  id: string;
  label: string;
  enabled: boolean;
}

/**
 * Nightly refresh of the current month from the Meta Marketing API.
 *
 * Re-syncing the same account + period refreshes that period in place (that's
 * what fn_ads_import does), so running every night simply keeps the open month
 * current — spend and conversions both move for days after the fact as Meta
 * finalises attribution.
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

  const [{ data: metaRow }, { data: mapRow }] = await Promise.all([
    db.from("app_settings").select("value").eq("key", "meta").maybeSingle(),
    db.from("app_settings").select("value").eq("key", "meta_ads").maybeSingle(),
  ]);

  const token = ((metaRow?.value ?? {}) as { access_token?: string }).access_token ?? "";
  const accounts = (((mapRow?.value ?? {}) as { accounts?: MappedAccount[] }).accounts ?? []).filter((a) => a.enabled);

  if (!token || !accounts.length) {
    return NextResponse.json({ ok: false, skipped: !token ? "no token" : "no accounts selected" });
  }

  const { since, until } = monthWindow();
  const started = Date.now();
  const results: Record<string, unknown>[] = [];

  for (const account of accounts) {
    // leave headroom so a slow account can't take the whole run down with it
    if (Date.now() - started > 45_000) {
      results.push({ account: account.label, skipped: "time budget" });
      continue;
    }
    try {
      const r = await syncAccount(db, token, { id: account.id, label: account.label }, since, until);
      results.push({ account: r.label, rows: r.rows, adRows: r.adRows, spend: r.spend, withLinks: r.withLinks });
    } catch (e) {
      results.push({ account: account.label, error: e instanceof Error ? e.message : "failed" });
    }
  }

  // ads whose destination now resolves to a known custom list get connected
  // without anyone touching the mapping screen
  let linked: unknown = null;
  try {
    const { data } = await db.rpc("fn_ads_autolink");
    linked = data;
  } catch {
    /* autolink is a convenience, never a reason to fail the run */
  }

  return NextResponse.json({ ok: true, period: { since, until }, results, linked });
}
