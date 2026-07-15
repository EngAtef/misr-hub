import { NextResponse } from "next/server";
import { withinHours } from "@/lib/chatwoot-bot/engine";
import { getBotHealth } from "@/lib/chatwoot-bot/config";

// Health check for the after-hours bot. No auth — returns no secrets.
export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getBotHealth();
  return NextResponse.json({
    ok: true,
    within_hours: withinHours(health.hours),
    configured: health.configured,
    enabled: health.enabled,
    after_hours_only: health.afterHoursOnly,
    source: health.source,
  });
}
