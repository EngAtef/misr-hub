import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api-auth";

export const maxDuration = 30;

// Admin-only helper for the Settings → Chatwoot Bot card: verifies the
// saved bot token against the Chatwoot server. Settings themselves are
// saved directly to app_settings from the client (admin RLS), same as the
// other integration cards.

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();

  if (body.action === "test") {
    const { data } = await user.supabase
      .from("app_settings")
      .select("value")
      .eq("key", "chatwoot_bot")
      .maybeSingle();
    const cfg = (data?.value ?? {}) as {
      chatwoot_url?: string;
      account_id?: string;
      bot_token?: string;
    };
    const baseUrl = (cfg.chatwoot_url || "https://support.nmgdp.tech").replace(/\/$/, "");
    const accountId = cfg.account_id || "5";
    if (!cfg.bot_token) {
      return NextResponse.json({ ok: false, message: "Save the bot access token first." });
    }
    try {
      const profileRes = await fetch(`${baseUrl}/api/v1/profile`, {
        headers: { api_access_token: cfg.bot_token },
        signal: AbortSignal.timeout(10_000),
      });
      if (!profileRes.ok) {
        return NextResponse.json({
          ok: false,
          message: `Token rejected by ${baseUrl} (HTTP ${profileRes.status}). Check the access token.`,
        });
      }
      const profile = (await profileRes.json()) as { name?: string; email?: string };

      const accountRes = await fetch(`${baseUrl}/api/v1/accounts/${accountId}/labels`, {
        headers: { api_access_token: cfg.bot_token },
        signal: AbortSignal.timeout(10_000),
      });
      if (!accountRes.ok) {
        return NextResponse.json({
          ok: false,
          message: `Token is valid (${profile.name ?? profile.email ?? "agent"}) but has no access to account ${accountId} (HTTP ${accountRes.status}). Check the Account ID or add the agent to the account.`,
        });
      }
      return NextResponse.json({
        ok: true,
        message: `Connected as ${profile.name ?? profile.email ?? "agent"} on account ${accountId}.`,
      });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        message: e instanceof Error ? e.message : "Request failed",
      });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
