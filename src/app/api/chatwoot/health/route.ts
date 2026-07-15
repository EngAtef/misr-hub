import { NextResponse } from "next/server";
import { withinHours } from "@/lib/chatwoot-bot/engine";
import { getBotConfig, isConfigured } from "@/lib/chatwoot-bot/config";

// Health check for the after-hours bot. No auth — returns no secrets.
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = getBotConfig();
  return NextResponse.json({
    ok: true,
    within_hours: withinHours(cfg.hours),
    configured: isConfigured(cfg),
  });
}
