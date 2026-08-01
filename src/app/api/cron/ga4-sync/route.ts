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

export const maxDuration = 60;

// Pulls GA4 pages / transactions / items straight from the Data API into the
// same tables the manual Data Center import fills. Runs daily via Vercel Cron
// (GET) and on demand from the Traffic page (POST, admin/manager only).
// Optional query param: ?backfill=6 re-syncs the last 6 calendar months.

function monthsFromRequest(request: NextRequest): string[] {
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
  const results: Ga4SyncResult[] = [];
  for (const month of months) {
    results.push(await syncGa4Month(cfg, supabase, month));
  }
  return NextResponse.json({ ok: true, results });
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
