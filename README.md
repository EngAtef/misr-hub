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

### Environment variables (Vercel → Settings → Environment Variables)

| Var | Example / default |
|---|---|
| `CHATWOOT_URL` | `https://support-nmgdp.tech` (default) |
| `CHATWOOT_ACCOUNT_ID` | `5` (default) |
| `CHATWOOT_BOT_TOKEN` | the Agent Bot's access token — **required** |
| `WEBHOOK_TOKEN` | random secret (`openssl rand -hex 16`) — **required**, also goes in the bot's webhook URL |
| `AFTER_HOURS_ONLY` | `true` (default) — inside working hours the bot stays silent and routes to humans |
| `WORK_TIMEZONE` / `WORK_DAYS` / `WORK_START` / `WORK_END` | `Africa/Cairo` / `sun,mon,tue,wed,thu` / `9` / `18` |

Chatwoot-side setup (create the Agent Bot, connect the inbox, business hours, pre-chat form)
is documented in the ops guide `CHATWOOT_SETUP.md` — point the bot's `outgoing_url` at
`https://<your-vercel-domain>/api/chatwoot/<WEBHOOK_TOKEN>`.

### Editing the reply script (support team)

All customer-facing text and keywords live in **one file**:
[`src/lib/chatwoot-bot/script.ts`](./src/lib/chatwoot-bot/script.ts). Fix wording or add a
keyword there, commit, deploy — routing code never needs to change. Adding a new question
type = adding one entry to `INTENTS` with a unique menu digit, keywords, and ar/en text.

Rules baked into the design: no live order/stock lookups, never guess a shipping price,
never ask for card details or OTP, and logs contain conversation ids + intent names only
(never message content, names, or phone numbers).

### Tests

```bash
npm run test:bot   # 59 tests — routing acceptance table + webhook behaviour (no extra deps)
```

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full step-by-step guide (Supabase + Vercel, ~15 minutes).
