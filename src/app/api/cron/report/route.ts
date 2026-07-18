import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// Daily performance email, triggered by Vercel Cron (see vercel.json).
// Requires env vars: RESEND_API_KEY, REPORT_RECIPIENTS (comma-separated),
// optional REPORT_FROM (defaults to onboarding@resend.dev for testing)
// and CRON_SECRET (recommended; Vercel sends it automatically).

interface Kpis {
  total_orders: number;
  gross_revenue: number;
  delivered_orders: number;
  cancelled_orders: number;
  returned_orders: number;
  cod_amount: number;
  online_paid_amount: number;
  avg_order_value: number;
  unique_customers: number;
}

const fmt = (n: number) => new Intl.NumberFormat("en-EG", { maximumFractionDigits: 0 }).format(n);
const money = (n: number) => `${fmt(n)} EGP`;

function trend(current: number, previous: number): string {
  if (!previous) return "";
  const pct = ((current - previous) / previous) * 100;
  const arrow = pct >= 0 ? "▲" : "▼";
  const color = pct >= 0 ? "#059669" : "#dc2626";
  return `<span style="color:${color};font-size:12px"> ${arrow} ${Math.abs(pct).toFixed(1)}%</span>`;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // 30-day retention for the silent user-activity log, independent of email config
  try {
    await createAdminClient().rpc("purge_old_activity");
  } catch {
    // never let retention cleanup break the report
  }

  const apiKey = process.env.RESEND_API_KEY;
  const recipients = (process.env.REPORT_RECIPIENTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!apiKey || !recipients.length) {
    return NextResponse.json({
      skipped: true,
      reason: "Set RESEND_API_KEY and REPORT_RECIPIENTS env vars to enable email reports",
    });
  }

  const admin = createAdminClient();
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 3600 * 1000).toISOString();

  const [currentRes, previousRes, cityRes, productRes] = await Promise.all([
    admin.rpc("fn_kpis", { p_from: daysAgo(7), p_to: now.toISOString() }),
    admin.rpc("fn_kpis", { p_from: daysAgo(14), p_to: daysAgo(7) }),
    admin.rpc("fn_breakdown", { p_dim: "city", p_from: daysAgo(7), p_to: now.toISOString(), p_limit: 5 }),
    admin.rpc("fn_top_products", { p_from: daysAgo(7), p_to: now.toISOString(), p_limit: 5 }),
  ]);

  const k = currentRes.data as Kpis;
  const prev = previousRes.data as Kpis;
  const cities = (cityRes.data ?? []) as { label: string; orders: number; revenue: number }[];
  const products = (productRes.data ?? []) as { product_name: string; quantity: number; revenue: number }[];

  if (!k) return NextResponse.json({ error: currentRes.error?.message ?? "no data" }, { status: 500 });

  // After-hours bot stats (best-effort — table exists since migration 027).
  let botRows = "";
  try {
    const { data: botEvents } = await admin
      .from("bot_events")
      .select("intent")
      .gte("created_at", daysAgo(7));
    const evs = (botEvents ?? []) as { intent: string }[];
    if (evs.length) {
      const count = (k2: string) => evs.filter((e) => e.intent === k2).length;
      const handled = evs.filter((e) => e.intent !== "greeting").length;
      const fallbacks = count("fallback");
      const handoffs = count("handoff") + count("cancel") + count("attachment");
      const pct = (n: number) => (handled ? `${Math.round((n / handled) * 100)}%` : "0%");
      const botRow = (label: string, value: string) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569">${label}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;text-align:right">${value}</td></tr>`;
      botRows =
        botRow("🤖 Bot: messages handled", String(handled)) +
        botRow("🤖 Bot: fallback rate", pct(fallbacks)) +
        botRow("🤖 Bot: handed to team", pct(handoffs));
    }
  } catch {
    // bot analytics are optional in this report
  }

  const dateStr = now.toISOString().slice(0, 10);
  const row = (label: string, value: string, t = "") =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569">${label}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;text-align:right">${value}${t}</td></tr>`;

  const html = `
  <div style="font-family:Segoe UI,Tahoma,Arial,sans-serif;max-width:560px;margin:0 auto;background:#f8fafc;padding:24px">
    <div style="background:#142857;border-radius:12px 12px 0 0;padding:20px 24px">
      <h1 style="color:#fff;font-size:20px;margin:0">Misr Hub — Weekly Performance</h1>
      <p style="color:#9db3e8;font-size:13px;margin:4px 0 0">Last 7 days vs previous 7 days · ${dateStr}</p>
    </div>
    <div style="background:#fff;border-radius:0 0 12px 12px;padding:8px 12px 20px">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${row("Orders", fmt(k.total_orders), trend(k.total_orders, prev?.total_orders))}
        ${row("Gross Revenue", money(k.gross_revenue), trend(k.gross_revenue, prev?.gross_revenue))}
        ${row("Delivered", fmt(k.delivered_orders), trend(k.delivered_orders, prev?.delivered_orders))}
        ${row("Cancelled", fmt(k.cancelled_orders), trend(k.cancelled_orders, prev?.cancelled_orders))}
        ${row("Returned", fmt(k.returned_orders), trend(k.returned_orders, prev?.returned_orders))}
        ${row("Avg Order Value", money(k.avg_order_value), trend(k.avg_order_value, prev?.avg_order_value))}
        ${row("COD Amount", money(k.cod_amount))}
        ${row("Online Paid", money(k.online_paid_amount))}
        ${row("Unique Customers", fmt(k.unique_customers), trend(k.unique_customers, prev?.unique_customers))}
        ${botRows}
      </table>
      <h3 style="font-size:14px;color:#142857;margin:20px 12px 8px">Top Cities (7 days)</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        ${cities.map((c) => row(c.label, `${fmt(c.orders)} orders · ${money(c.revenue)}`)).join("")}
      </table>
      <h3 style="font-size:14px;color:#142857;margin:20px 12px 8px">Top Products (7 days)</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        ${products.map((p) => row(p.product_name.slice(0, 45), `${fmt(p.quantity)} pcs`)).join("")}
      </table>
      <p style="font-size:11px;color:#94a3b8;margin:20px 12px 0">Automated report from Misr Hub. Open the dashboard for full analytics.</p>
    </div>
  </div>`;

  const sendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.REPORT_FROM ?? "Misr Hub <onboarding@resend.dev>",
      to: recipients,
      subject: `Misr Hub weekly report — ${fmt(k.total_orders)} orders, ${money(k.gross_revenue)} (${dateStr})`,
      html,
    }),
  });

  const sendData = await sendRes.json();
  if (!sendRes.ok) {
    return NextResponse.json({ error: sendData }, { status: 500 });
  }

  await admin.from("audit_log").insert({
    action: "email_report_sent",
    details: { recipients, orders: k.total_orders, revenue: k.gross_revenue },
  });

  return NextResponse.json({ ok: true, id: sendData.id, recipients });
}
