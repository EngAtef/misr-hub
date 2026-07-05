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

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full step-by-step guide (Supabase + Vercel, ~15 minutes).
