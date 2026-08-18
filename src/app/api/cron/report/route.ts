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
  // migration 114 — Σ order weight (all orders / excluding cancelled+returned) and per-order avg
  total_weight_kg?: number;
  net_weight_kg?: number;
  avg_weight_kg?: number | null;
}

const fmt = (n: number) => new Intl.NumberFormat("en-EG", { maximumFractionDigits: 0 }).format(n);
const money = (n: number) => `${fmt(n)} EGP`;
const kg = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : n >= 1000
      ? `${new Intl.NumberFormat("en-EG", { maximumFractionDigits: 2 }).format(n / 1000)} t`
      : `${new Intl.NumberFormat("en-EG", { maximumFractionDigits: n < 10 ? 2 : 1 }).format(n)} kg`;

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

  // Team activity digest — who did what over the last 7 days (best-effort).
  let teamRows = "";
  try {
    const { data: activity } = await admin
      .from("user_activity")
      .select("user_email, kind, page, created_at")
      .gte("created_at", daysAgo(7))
      .not("user_email", "is", null)
      .limit(50000);
    const acts = (activity ?? []) as { user_email: string; kind: string; page: string | null; created_at: string }[];
    const byUser = new Map<string, { days: Set<string>; visits: number; clicks: number; actions: number; pages: Map<string, number> }>();
    for (const a of acts) {
      let u = byUser.get(a.user_email);
      if (!u) {
        u = { days: new Set(), visits: 0, clicks: 0, actions: 0, pages: new Map() };
        byUser.set(a.user_email, u);
      }
      u.days.add(a.created_at.slice(0, 10));
      if (a.kind === "visit") {
        u.visits++;
        if (a.page) u.pages.set(a.page, (u.pages.get(a.page) ?? 0) + 1);
      } else if (a.kind === "click") u.clicks++;
      else u.actions++;
    }
    teamRows = [...byUser.entries()]
      .sort((a, b) => b[1].visits + b[1].clicks - (a[1].visits + a[1].clicks))
      .map(([email, u]) => {
        const top = [...u.pages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p).join(", ");
        return `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569">${email}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right">${u.days.size} active days · ${fmt(u.visits)} visits · ${fmt(u.actions)} actions${top ? `<br><span style="color:#94a3b8">${top}</span>` : ""}</td></tr>`;
      })
      .join("");
  } catch {
    // digest is optional in this report
  }

  // Abandoned-cart recovery digest (best-effort — tables exist since 039).
  // New carts this week, the recovery scoreboard, and the top reachable
  // carts by value so the team has a ready call list.
  let abandonedSection = "";
  try {
    const weekAgo = daysAgo(7);
    const [{ data: weekCarts }, { data: weekRecovered }, { data: callList }] = await Promise.all([
      admin.from("abandoned_carts").select("cart_value, weight_kg").eq("is_anomaly", false).gte("created_at", weekAgo),
      admin.from("abandoned_carts").select("recovered_value, cart_value, weight_kg").eq("is_anomaly", false).eq("recall_status", "recovered").gte("recovered_at", weekAgo),
      admin
        .from("abandoned_carts")
        .select("full_name, phone, cart_value, products_count, created_at")
        .eq("is_anomaly", false)
        .in("recall_status", ["new"])
        .not("phone_norm", "is", null)
        .gte("created_at", daysAgo(14))
        .order("cart_value", { ascending: false })
        .limit(10),
    ]);
    const wc = (weekCarts ?? []) as { cart_value: number | null; weight_kg: number | null }[];
    const wr = (weekRecovered ?? []) as { recovered_value: number | null; cart_value: number | null; weight_kg: number | null }[];
    const cl = (callList ?? []) as { full_name: string | null; phone: string | null; cart_value: number | null; products_count: number | null; created_at: string }[];
    const sum = (xs: (number | null)[]) => xs.reduce((s: number, v) => s + (v ?? 0), 0);
    if (wc.length || cl.length) {
      const rowA = (label: string, value: string) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569">${label}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;text-align:right">${value}</td></tr>`;
      abandonedSection = `
      <h3 style="font-size:14px;color:#142857;margin:20px 12px 8px">🛒 Abandoned Carts (7 days)</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        ${rowA("New abandoned carts", `${fmt(wc.length)} · ${money(sum(wc.map((x) => x.cart_value)))} · ${kg(sum(wc.map((x) => x.weight_kg)))}`)}
        ${rowA("Recovered this week", `${fmt(wr.length)} · ${money(sum(wr.map((x) => x.recovered_value ?? x.cart_value)))} · ${kg(sum(wr.map((x) => x.weight_kg)))}`)}
      </table>
      ${cl.length ? `<h3 style="font-size:14px;color:#142857;margin:20px 12px 8px">📞 Top carts to call (last 14 days, uncontacted)</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        ${cl.map((c) => rowA(`${(c.full_name ?? "—").slice(0, 30)} <span style="color:#94a3b8">${c.phone ?? ""}</span>`, `${money(c.cart_value ?? 0)} · ${fmt(c.products_count ?? 0)} items`)).join("")}
      </table>` : ""}`;
    }
  } catch {
    // abandoned digest is optional in this report
  }

  // refresh smart-alert notifications alongside the weekly email
  try {
    await admin.rpc("sync_alert_notifications");
  } catch {
    // best-effort
  }

  // Website traffic digest + smart alarms (best-effort — GA4 sync since 055/059)
  let trafficSection = "";
  try {
    const from7 = daysAgo(7).slice(0, 10);
    const [{ data: gaDays }, { data: alarmsData }] = await Promise.all([
      admin.from("ga4_daily").select("sessions, purchases").gte("date", from7),
      admin.rpc("fn_traffic_alarms"),
    ]);
    const gd = (gaDays ?? []) as { sessions: number | null; purchases: number | null }[];
    const sessions = gd.reduce((s, r) => s + (r.sessions ?? 0), 0);
    const ga4Purchases = gd.reduce((s, r) => s + (r.purchases ?? 0), 0);
    const alarms = (alarmsData ?? []) as { kind: string; severity: string; data: Record<string, string | number> }[];
    const alarmText: Record<string, (d: Record<string, string | number>) => string> = {
      dead_spend: (d) => `Campaign "${d.name}" spent ${money(Number(d.spend))} with 0 matched orders (10d)`,
      low_roas: (d) => `Campaign "${d.name}" losing: ${money(Number(d.spend))} spend vs ${money(Number(d.revenue))} revenue`,
      traffic_anomaly: (d) => `Traffic anomaly: ${fmt(Number(d.yesterday))} sessions yesterday vs usual ${fmt(Number(d.avg))}`,
      oos_traffic: (d) => `"${d.name}" out of stock with ${fmt(Number(d.views))} views this month`,
      conversion_collapse: (d) => `"${d.name}" conversion fell to ${d.cur}% (was ${d.prev}%)`,
      checkout_leak: (d) => `Checkout leak: ${d.recent}% completion vs usual ${d.prior}%`,
      rank_drop: (d) => `Google rank for "${d.query}" fell ${d.prev} → ${d.cur}`,
      rank_win: (d) => `"${d.query}" reached Google page 1 (${d.prev} → ${d.cur})`,
      city_delivery: (d) => `Delivery rate in ${d.city} dropped to ${d.cur}% (was ${d.prev}%)`,
      pace_driver: (d) => `Revenue pace behind last month (${money(Number(d.r_cur))} vs ${money(Number(d.r_prev))})`,
    };
    const sev = (s: string) => (s === "red" ? "#dc2626" : s === "amber" ? "#d97706" : "#2563eb");
    const rowT = (label: string, value: string) =>
      `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569">${label}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;text-align:right">${value}</td></tr>`;
    if (sessions > 0 || alarms.length) {
      trafficSection = `
      <h3 style="font-size:14px;color:#142857;margin:20px 12px 8px">🌐 Website Traffic (7 days)</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        ${rowT("Sessions", fmt(sessions))}
        ${rowT("GA4 purchases", fmt(ga4Purchases))}
        ${rowT("Conversion rate", sessions ? `${((ga4Purchases / sessions) * 100).toFixed(2)}%` : "—")}
      </table>
      ${alarms.length ? `<h3 style="font-size:14px;color:#142857;margin:20px 12px 8px">🚨 Smart Alarms</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        ${alarms.slice(0, 8).map((a) => `<tr><td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;color:${sev(a.severity)};font-size:12.5px">${(alarmText[a.kind] ?? (() => a.kind))(a.data)}</td></tr>`).join("")}
      </table>` : ""}`;
    }
  } catch {
    // traffic digest is optional in this report
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
        ${row("Shipped Weight", kg(k.net_weight_kg), trend(k.net_weight_kg ?? 0, prev?.net_weight_kg ?? 0))}
        ${row("Avg Order Weight", kg(k.avg_weight_kg), trend(k.avg_weight_kg ?? 0, prev?.avg_weight_kg ?? 0))}
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
      ${trafficSection}
      ${abandonedSection}
      ${teamRows ? `<h3 style="font-size:14px;color:#142857;margin:20px 12px 8px">Team Activity (7 days)</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">${teamRows}</table>` : ""}
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
      subject: `Misr Hub weekly report — ${fmt(k.total_orders)} orders, ${money(k.gross_revenue)}, ${kg(k.net_weight_kg)} (${dateStr})`,
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
