import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getApiUser } from "@/lib/supabase/api-auth";
import {
  loadWaConfig,
  getPhoneInfo,
  listTemplates,
  sendTemplate,
  renderComponents,
  GraphError,
  phoneNorm,
} from "@/lib/whatsapp/cloud";

export const maxDuration = 30;

// Signed-in helpers for the WhatsApp page:
//   status     — number info + template list + what the webhook needs
//   send_test  — one template message to one number (logged in wa_sends
//                with no campaign, so delivery/read still come back)

function describe(e: unknown): string {
  if (e instanceof GraphError) return `${e.code ?? e.status}: ${e.message}${e.details ? ` — ${e.details}` : ""}`;
  return e instanceof Error ? e.message : "request failed";
}

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "manager") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const db = createAdminClient();
  const cfg = await loadWaConfig(db);
  const origin = request.nextUrl.origin;

  if (body.action === "status") {
    if (!cfg) {
      return NextResponse.json({ configured: false, webhook_url: `${origin}/api/whatsapp/webhook` });
    }
    const out: Record<string, unknown> = {
      configured: true,
      enabled: cfg.enabled,
      has_waba: !!cfg.wabaId,
      has_app_secret: !!cfg.appSecret,
      verify_token: cfg.verifyToken,
      webhook_url: `${origin}/api/whatsapp/webhook`,
    };
    try {
      out.phone = await getPhoneInfo(cfg);
    } catch (e) {
      out.phone_error = describe(e);
    }
    try {
      out.templates = await listTemplates(cfg);
    } catch (e) {
      out.templates_error = describe(e);
    }
    return NextResponse.json(out);
  }

  if (body.action === "send_test") {
    if (!cfg) return NextResponse.json({ ok: false, message: "Save the WhatsApp settings first." });
    if (!cfg.enabled) return NextResponse.json({ ok: false, message: "The WhatsApp integration is switched off in Settings." });
    const digits = String(body.to ?? "").replace(/\D/g, "");
    const to = digits.startsWith("0") && digits.length === 11 ? "2" + digits : digits.length === 10 ? "20" + digits : digits;
    if (to.length < 11) return NextResponse.json({ ok: false, message: "Enter a valid mobile number." });
    const template = String(body.template ?? "").trim();
    const lang = String(body.lang ?? "ar").trim() || "ar";
    if (!template) return NextResponse.json({ ok: false, message: "Pick a template." });
    const components = renderComponents(body.components ?? [], String(body.name ?? "") || null);
    try {
      const wamid = await sendTemplate(cfg, to, template, lang, components);
      await db.from("wa_sends").insert({
        campaign_id: null,
        phone_norm: phoneNorm(to),
        wa_to: to,
        name: String(body.name ?? "") || null,
        status: "sent",
        wamid: wamid || null,
        sent_at: new Date().toISOString(),
      });
      return NextResponse.json({ ok: true, wamid });
    } catch (e) {
      return NextResponse.json({ ok: false, message: describe(e) });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
