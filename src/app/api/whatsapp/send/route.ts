import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getApiUser } from "@/lib/supabase/api-auth";
import { loadWaConfig, sendTemplate, renderComponents, GraphError } from "@/lib/whatsapp/cloud";

export const maxDuration = 60;

// The campaign worker. Drains one batch of queued sends for the oldest
// live campaign and returns how much is left, so whoever called it (the
// page's progress loop, or pg_cron's fn_wa_send_kick every minute) knows
// whether to call again. Idempotent: a row is claimed by being updated to
// 'sent' with its wamid, and Meta's webhook moves it on from there.
//
// Auth: the cron secret (pg_net) or a signed-in admin/manager (the page).

const BUDGET_MS = 50_000;
const CONCURRENCY = 3;

async function authorized(request: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) return true;
  const user = await getApiUser(request);
  return !!user && (user.role === "admin" || user.role === "manager");
}

interface SendRow {
  id: number;
  wa_to: string;
  name: string | null;
}

async function drain(batch: number) {
  const started = Date.now();
  const db = createAdminClient();
  const cfg = await loadWaConfig(db);
  if (!cfg) return { skipped: "not configured" };
  if (!cfg.enabled) return { skipped: "disabled" };

  const { data: campaign } = await db
    .from("wa_campaigns")
    .select("id, name, template_name, template_lang, components, status")
    .in("status", ["queued", "sending"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!campaign) return { idle: true };

  const { data: rows } = await db
    .from("wa_sends")
    .select("id, wa_to, name")
    .eq("campaign_id", campaign.id)
    .eq("status", "queued")
    .order("id", { ascending: true })
    .limit(Math.max(1, Math.min(batch, 500)));
  const queue = (rows ?? []) as SendRow[];

  if (!queue.length) {
    await db
      .from("wa_campaigns")
      .update({ status: "done", finished_at: new Date().toISOString() })
      .eq("id", campaign.id);
    return { campaign_id: campaign.id, processed: 0, sent: 0, failed: 0, remaining: 0, done: true };
  }

  if (campaign.status === "queued") {
    await db
      .from("wa_campaigns")
      .update({ status: "sending", started_at: new Date().toISOString(), last_error: null })
      .eq("id", campaign.id);
  }

  let sent = 0;
  let failed = 0;
  let processed = 0;
  let throttled: string | null = null;
  let cursor = 0;

  const worker = async () => {
    while (cursor < queue.length && !throttled && Date.now() - started < BUDGET_MS) {
      const row = queue[cursor++];
      const components = renderComponents(campaign.components, row.name);
      try {
        const wamid = await sendTemplate(cfg, row.wa_to, campaign.template_name, campaign.template_lang, components);
        await db
          .from("wa_sends")
          .update({ status: "sent", wamid: wamid || null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", row.id)
          .eq("status", "queued");
        sent += 1;
      } catch (e) {
        if (e instanceof GraphError && e.throttled) {
          throttled = `${e.code ?? e.status}: ${e.message}`;
          break; // leave this row (and the rest) queued for the next pass
        }
        const error = e instanceof GraphError
          ? `${e.code ?? e.status}: ${e.message}${e.details ? ` — ${e.details}` : ""}`
          : e instanceof Error ? e.message : "send failed";
        await db
          .from("wa_sends")
          .update({ status: "failed", error: error.slice(0, 500), updated_at: new Date().toISOString() })
          .eq("id", row.id)
          .eq("status", "queued");
        failed += 1;
      }
      processed += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  const { count } = await db
    .from("wa_sends")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .eq("status", "queued");
  const remaining = count ?? 0;

  if (throttled) {
    await db.from("wa_campaigns").update({ last_error: throttled }).eq("id", campaign.id);
  } else if (remaining === 0) {
    await db
      .from("wa_campaigns")
      .update({ status: "done", finished_at: new Date().toISOString() })
      .eq("id", campaign.id);
  }

  return { campaign_id: campaign.id, processed, sent, failed, remaining, throttled, done: remaining === 0 && !throttled };
}

export async function POST(request: NextRequest) {
  if (!(await authorized(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let batch = 150;
  try {
    const body = await request.json();
    if (body && Number.isFinite(Number(body.batch))) batch = Number(body.batch);
  } catch {
    // no body — default batch
  }
  try {
    return NextResponse.json(await drain(batch));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "worker failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!(await authorized(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const batch = Number(request.nextUrl.searchParams.get("batch") ?? 150) || 150;
  try {
    return NextResponse.json(await drain(batch));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "worker failed" }, { status: 500 });
  }
}
