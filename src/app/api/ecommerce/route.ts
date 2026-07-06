import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api-auth";

export const maxDuration = 30;

// Stores + tests the Super Commerce (or other platform) API connection.
// The API key authenticates requests to the store's platform so the app can
// pull orders/products/inventory automatically instead of manual Excel uploads.

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const db = user.supabase;

  if (body.action === "save") {
    const value = {
      platform: body.platform ?? "super_commerce",
      base_url: (body.base_url ?? "").trim().replace(/\/$/, ""),
      api_key: body.api_key ?? "",
      has_key: Boolean(body.api_key),
    };
    const { error } = await db
      .from("app_settings")
      .upsert({ key: "ecommerce", value, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "test") {
    const { data } = await db.from("app_settings").select("value").eq("key", "ecommerce").single();
    const cfg = (data?.value ?? {}) as { base_url?: string; api_key?: string };
    if (!cfg.base_url) {
      return NextResponse.json({ ok: false, message: "Set the API base URL first." });
    }
    try {
      const res = await fetch(cfg.base_url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${cfg.api_key ?? ""}`,
          Accept: "application/json",
        },
      });
      const text = await res.text();
      return NextResponse.json({
        ok: res.ok,
        status: res.status,
        message: res.ok ? "Connection reachable." : `Server responded ${res.status}.`,
        preview: text.slice(0, 300),
      });
    } catch (e) {
      return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "Request failed" });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
