# Misr Hub — مصر هب

Internal operations, analytics & marketing platform for the online bookstore. Built with **Next.js 15 + Supabase (PostgreSQL) + Tailwind CSS**, deployed on **Vercel**.

Arabic-first (RTL) with a full English toggle.

## Features

| Module | Description |
|---|---|
| **Overview** | KPI cards (orders, revenue, delivery/cancellation/return rates, AOV) + daily trend, status/payment/city breakdowns |
| **Orders (OMS)** | Search & filter 20k+ orders (status, payment, city, date, phone, AWB), full order detail with items and complete status timeline, CSV export |
| **Analytics** | 7 dashboards: Sales, Delivery, Payments, Geography, Products, Returns & Cancellations, Team activity |
| **Smart Insights** | Automatic marketing / revenue / stock / social-ads / operations recommendations computed from your live data, plus an "orders needing attention" follow-up queue |
| **Campaigns** | Campaign manager (Facebook, Instagram, TikTok, SMS, WhatsApp…) with budget vs attributed revenue and ROAS, matched to orders via promo code or Campaign Id |
| **Customers (RFM)** | Automatic segmentation into Champions / Loyal / New / Promising / At-Risk / Hibernating with per-segment marketing playbook, contact-list CSV export, and one-click WhatsApp |
| **WhatsApp follow-up** | Prefilled Arabic/English WhatsApp messages (wa.me) per situation: stuck shipment, pending return, unshipped order, failed delivery — no API account needed |
| **Email reports** | Weekly performance email (Vercel Cron + Resend): KPIs with week-over-week trends, top cities & products |
| **Reports** | 10 ready reports with date range filters, every one exportable to CSV (Excel-compatible), plus full orders export |
| **Data Center** | Drag-and-drop OrderExport .xlsx import — parses 143 columns incl. products (split into items) and up to 29 status transitions per order. Re-imports update existing orders and never delete history. Upload log included |
| **Chatwoot after-hours bot** | Scripted (no-AI) support bot for the Chatwoot inbox: answers FAQ in Arabic/English outside working hours, collects details, hands off to the morning queue — see below |
| **Users** | Role-based access: **Admin** (everything + users + audit), **Manager** (upload + all reports), **Viewer** (read-only) |
| **Audit Log** | Every import, export, and user change is recorded |

## Architecture

```
Next.js (Vercel)  ──►  Supabase PostgreSQL
  ├─ Browser: reads via RLS-protected anon key (SELECT only)
  ├─ API routes: bulk import / user admin / CSV export via service role
  └─ Analytics: SQL functions (fn_kpis, fn_breakdown, fn_top_products, ...)
```

- **Security**: Row Level Security on every table. The browser can only read; all writes go through authenticated API routes. Only active users with a role can see any data.
- **Data model**: `orders` (one row per order) + `order_items` (split from pipe-separated product columns) + `order_events` (full status history) + `campaigns`, `uploads`, `audit_log`, `profiles`.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in your Supabase keys
npm run dev
```

## Chatwoot after-hours bot

A scripted support bot for the Chatwoot inbox at `support-nmgdp.tech`. Outside working hours it
answers the common questions (shipping, payment, returns, tracking, categories, hours, bulk)
from a fixed script, collects the customer's details, and hands the conversation to the human
queue for the morning. **No AI, no per-message fees, and it never invents an answer** — anything
outside the script gets a "here's the menu" fallback or a handoff.

### Endpoints

| Route | Purpose |
|---|---|
| `POST /api/chatwoot/<WEBHOOK_TOKEN>` | Chatwoot Agent Bot webhook (403 on wrong token, 503 until configured) |
| `GET /api/chatwoot/health` | `{ok, within_hours, configured}` — no auth |

### Configuration — Settings → Chatwoot After-Hours Bot (in the app)

Everything is managed from the app (admin only), no env vars or redeploys needed:
connection (Chatwoot URL, account ID, bot agent access token), a webhook-URL generator,
enabled / after-hours-only toggles, working days & hours, and the full reply script.
Settings are stored in `app_settings` (`chatwoot_bot` + `chatwoot_bot_script`); the
unauthenticated webhook reads them through `fn_chatwoot_bot_config`, a token-gated
SECURITY DEFINER function (migration 025), so no service-role key is involved.

Setup: create a dedicated agent in Chatwoot (e.g. "Nahdet Misr Bot"), paste its access
token in the card, Generate the webhook URL, Save, Test connection — then add that URL in
Chatwoot under Settings → Integrations → Webhooks with events **Conversation Created** +
**Message Created**.

Env vars (`CHATWOOT_URL`, `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_BOT_TOKEN`, `WEBHOOK_TOKEN`,
`AFTER_HOURS_ONLY`, `WORK_TIMEZONE/DAYS/START/END`) still work as a fallback when no
in-app settings are saved.

### Editing the reply script (support team)

Settings → Chatwoot After-Hours Bot → **Reply script**: edit the greeting, fallback,
handoff, footer, keywords, and per-topic answers, or add a whole new topic — changes apply
on Save, no deploy. Only differences from the defaults are stored; "Reset script to
defaults" clears them. The built-in defaults live in
[`src/lib/chatwoot-bot/script.ts`](./src/lib/chatwoot-bot/script.ts).

Rules baked into the design: no live order/stock lookups, never guess a shipping price,
never ask for card details or OTP, and logs contain conversation ids + intent names only
(never message content, names, or phone numbers).

### Tests

```bash
npm run test:bot   # 59 tests — routing acceptance table + webhook behaviour (no extra deps)
```

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full step-by-step guide (Supabase + Vercel, ~15 minutes).
