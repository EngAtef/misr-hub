import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadWaConfig,
  consentSignal,
  phoneNorm,
  sendText,
  OPT_IN_REPLY_AR,
  OPT_OUT_REPLY_AR,
  type WaConfig,
} from "@/lib/whatsapp/cloud";

export const maxDuration = 30;

// Meta → us. Two jobs:
//   statuses  — sent / delivered / read / failed per message id, written back
//               to wa_sends so the campaign counters are real
//   messages  — customer replies: logged to wa_inbound for the page, and a
//               short "إلغاء" / "نعم" flips consent immediately with a
//               confirmation reply (allowed: the customer just opened a
//               24h service window by writing to us)
// Always answers 200 once the payload was parsed — Meta retries on anything
// else and we would double-process.

// GET = Meta's one-time verification handshake when the callback URL is saved
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const db = createAdminClient();
  const cfg = await loadWaConfig(db);
  const expected = cfg?.verifyToken;
  if (p.get("hub.mode") === "subscribe" && expected && p.get("hub.verify_token") === expected) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "verification failed" }, { status: 403 });
}

const STATUS_RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4, skipped: 0 };

interface StatusEvent {
  id: string;
  status: string;
  timestamp?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
}

interface InboundMessage {
  from: string;
  id: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  context?: { id?: string };
}

interface ChangeValue {
  messaging_product?: string;
  statuses?: StatusEvent[];
  messages?: InboundMessage[];
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const db = createAdminClient();
  const cfg = await loadWaConfig(db);
  if (!cfg) return NextResponse.json({ error: "whatsapp not configured" }, { status: 503 });

  // Signature check is only possible once the App Secret is saved in Settings.
  if (cfg.appSecret) {
    const header = request.headers.get("x-hub-signature-256") ?? "";
    const expected = "sha256=" + createHmac("sha256", cfg.appSecret).update(raw).digest("hex");
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: "bad signature" }, { status: 401 });
    }
  }

  let payload: { entry?: { changes?: { field?: string; value?: ChangeValue }[] }[] } = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ ok: true, ignored: "not json" });
  }

  const log = (m: string) => console.log(`[whatsapp] ${m}`);
  let statuses = 0;
  let inbound = 0;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      if (change.field === "message_template_status_update") {
        log(`template status update: ${JSON.stringify(value).slice(0, 200)}`);
        continue;
      }
      if (change.field !== "messages") continue;

      for (const st of value.statuses ?? []) {
        statuses += 1;
        await applyStatus(db, st, log);
      }

      const names = new Map<string, string>();
      for (const c of value.contacts ?? []) if (c.wa_id && c.profile?.name) names.set(c.wa_id, c.profile.name);

      for (const msg of value.messages ?? []) {
        inbound += 1;
        await applyInbound(db, cfg, msg, names.get(msg.from) ?? null, log);
      }
    }
  }

  return NextResponse.json({ ok: true, statuses, inbound });
}

async function applyStatus(db: ReturnType<typeof createAdminClient>, st: StatusEvent, log: (m: string) => void) {
  if (!st.id || !st.status) return;
  const status = ["sent", "delivered", "read", "failed"].includes(st.status) ? st.status : null;
  if (!status) return;

  const { data: row } = await db.from("wa_sends").select("id, status").eq("wamid", st.id).maybeSingle();
  if (!row) return; // a message we did not send (test console, another tool)

  // never downgrade: a late "delivered" after "read" must not overwrite it
  if ((STATUS_RANK[row.status] ?? 0) >= STATUS_RANK[status] && status !== "failed") return;

  const err = st.errors?.[0];
  const error = status === "failed" && err
    ? `${err.code ?? ""} ${err.title ?? err.message ?? ""}${err.error_data?.details ? ` — ${err.error_data.details}` : ""}`.trim()
    : null;

  const { error: upErr } = await db
    .from("wa_sends")
    .update({ status, ...(error ? { error } : {}), updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (upErr) log(`status update failed id=${row.id}: ${upErr.message}`);
}

async function applyInbound(
  db: ReturnType<typeof createAdminClient>,
  cfg: WaConfig,
  msg: InboundMessage,
  name: string | null,
  log: (m: string) => void
) {
  const from = msg.from ?? "";
  const pn = phoneNorm(from);
  if (!pn) return;

  const body =
    msg.text?.body ??
    msg.button?.text ??
    msg.interactive?.button_reply?.title ??
    msg.interactive?.list_reply?.title ??
    null;

  // which campaign message did they reply to?
  let campaignId: string | null = null;
  if (msg.context?.id) {
    const { data } = await db.from("wa_sends").select("campaign_id").eq("wamid", msg.context.id).maybeSingle();
    campaignId = (data?.campaign_id as string | null) ?? null;
  }

  const { error: insErr } = await db.from("wa_inbound").insert({
    wamid: msg.id,
    phone_norm: pn,
    wa_from: from,
    name,
    kind: msg.type ?? null,
    body,
    context_wamid: msg.context?.id ?? null,
    campaign_id: campaignId,
    received_at: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString(),
  });
  if (insErr) {
    // duplicate wamid = Meta retry; we already handled it
    if (insErr.code === "23505") return;
    log(`inbound insert failed: ${insErr.message}`);
  }

  const signal = consentSignal(body);
  if (signal === "out") {
    await db.from("wa_opt_outs").upsert({ phone_norm: pn, source: "whatsapp", note: body?.slice(0, 80) ?? null }, { onConflict: "phone_norm" });
    await db.from("wa_opt_ins").delete().eq("phone_norm", pn);
    try {
      await sendText(cfg, from, OPT_OUT_REPLY_AR);
    } catch (e) {
      log(`opt-out reply failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
  } else if (signal === "in") {
    await db.from("wa_opt_ins").upsert({ phone_norm: pn, source: "whatsapp", name }, { onConflict: "phone_norm" });
    await db.from("wa_opt_outs").delete().eq("phone_norm", pn);
    try {
      await sendText(cfg, from, OPT_IN_REPLY_AR);
    } catch (e) {
      log(`opt-in reply failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }
}
