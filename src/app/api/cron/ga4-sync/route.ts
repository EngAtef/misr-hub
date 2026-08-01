import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getApiUser } from "@/lib/supabase/api-auth";
import {
  getGa4Config,
  defaultSyncMonths,
  backfillMonths,
  syncGa4Month,
  type Ga4SyncResult,
} from "@/lib/google/ga4";
import { getGscConfig, syncGscMonth, type GscSyncResult } from "@/lib/google/gsc";

export const maxDuration = 60;

// Pulls GA4 pages / transactions / items straight from the Data API into the
// same tables the manual Data Center import fills. Runs daily via Vercel Cron
// (GET) and on demand from the Traffic page (POST, admin/manager only).
// Optional query params: ?backfill=6 re-syncs the last 6 calendar months;
// ?months=2026-03-01,2026-04-01 syncs exactly those months (used by the
// Traffic page to backfill history one month per request, avoiding timeouts).

function monthsFromRequest(request: NextRequest): string[] {
  const explicit = (request.nextUrl.searchParams.get("months") ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => /^\d{4}-\d{2}-01$/.test(m));
  if (explicit.length) return explicit.slice(0, 12);
  const backfill = Number(request.nextUrl.searchParams.get("backfill"));
  if (Number.isInteger(backfill) && backfill > 0) return backfillMonths(Math.min(backfill, 36));
  return defaultSyncMonths();
}

async function runSync(supabase: SupabaseClient, months: string[]) {
  const cfg = await getGa4Config(supabase);
  if (!cfg) {
    return NextResponse.json(
      {
        error: "not_configured",
        message:
          "Configure GA4 in Settings: property ID + full service-account JSON (or the GA4_* env vars).",
      },
      { status: 400 }
    );
  }
  const gscCfg = await getGscConfig(supabase);
  const results: (Ga4SyncResult & { gsc?: GscSyncResult | string })[] = [];
  for (const month of months) {
    const r: Ga4SyncResult & { gsc?: GscSyncResult | string } = await syncGa4Month(cfg, supabase, month);
    if (gscCfg) {
      // Search Console is additive — a failure there must not block GA4 data
      r.gsc = await syncGscMonth(gscCfg, supabase, month).catch((e) => String(e));
    }
    results.push(r);
  }
  return NextResponse.json({ ok: true, results, gsc_configured: !!gscCfg });
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      {
        error: "no_service_key",
        message:
          "Scheduled sync needs the SUPABASE_SERVICE_ROLE_KEY env var. The manual Sync button on the Traffic page works without it.",
      },
      { status: 400 }
    );
  }
  try {
    return await runSync(createAdminClient(), monthsFromRequest(request));
  } catch (e) {
    return NextResponse.json({ error: "sync_failed", message: String(e) }, { status: 500 });
  }
}

// Manual sync from the Traffic page — runs under the caller's own session, so
// RLS write policies (admin/manager) apply and no service key is needed.
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user || !["admin", "manager"].includes(user.role)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return await runSync(user.supabase, monthsFromRequest(request));
  } catch (e) {
    return NextResponse.json({ error: "sync_failed", message: String(e) }, { status: 500 });
  }
}
