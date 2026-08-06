import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatMoney(value: number | null | undefined, lang: "ar" | "en" = "ar"): string {
  if (value === null || value === undefined || isNaN(value)) return "—";
  const formatted = new Intl.NumberFormat("en-EG", { maximumFractionDigits: 0 }).format(value);
  return lang === "ar" ? `${formatted} ج.م` : `EGP ${formatted}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return "—";
  return new Intl.NumberFormat("en-EG", { maximumFractionDigits: 1 }).format(value);
}

// Strips characters that have meaning inside a PostgREST or()/ilike filter
// so a crafted search string can't break out and query other columns.
export function sanitizeSearch(input: string): string {
  return input.replace(/[,()*%\\:]/g, " ").trim().slice(0, 80);
}

export function formatPercent(part: number, total: number): string {
  if (!total) return "0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

// Order timestamps are stored as the Egypt-local wall-clock time in UTC form
// (the exports carry no timezone), so display them in UTC to avoid a +2/+3h shift.
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

// Fixed platform status values -> Arabic labels (fallback: raw value)
export const STATUS_AR: Record<string, string> = {
  Delivered: "تم التوصيل",
  Cancelled: "ملغي",
  Returned: "مرتجع",
  "Return Sent To Erp": "مرتجع (تم للـERP)",
  "Return Request": "طلب إرجاع",
  Confirmed: "مؤكد",
  Placed: "جديد",
  Shipped: "تم الشحن",
  "Out For Delivery": "خرج للتوصيل",
  "Picked by courier": "استلمه المندوب",
  "Delivery Failed": "فشل التوصيل",
  "Send To Erp": "أُرسل للـERP",
  "Cash On Delivery": "الدفع عند الاستلام",
  "Debit or Credit Card": "بطاقة بنكية",
  "Credit card and installment": "بطاقة + تقسيط",
  "Installment with Valu": "تقسيط Valu",
};

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!rows.length) return "";
  const cols = columns ?? Object.keys(rows[0]);
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    // CSV-injection guard: a cell starting with = + - @ (or tab/CR) can run
    // as a formula in Excel/Sheets. Prefix with ' to neutralize it.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(",")];
  for (const row of rows) {
    lines.push(cols.map((c) => escape(row[c])).join(","));
  }
  return "﻿" + lines.join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const STATUS_COLORS: Record<string, string> = {
  Delivered: "bg-emerald-100 text-emerald-800",
  Cancelled: "bg-red-100 text-red-700",
  Returned: "bg-orange-100 text-orange-800",
  "Return Sent To Erp": "bg-orange-100 text-orange-800",
  "Return Request": "bg-amber-100 text-amber-800",
  Confirmed: "bg-blue-100 text-blue-800",
  Placed: "bg-slate-100 text-slate-700",
  Shipped: "bg-indigo-100 text-indigo-800",
  "Out For Delivery": "bg-cyan-100 text-cyan-800",
  "Picked by courier": "bg-violet-100 text-violet-800",
  "Delivery Failed": "bg-rose-100 text-rose-800",
  "Send To Erp": "bg-slate-100 text-slate-700",
};

export const CHART_COLORS = [
  "#1b6ef5",
  "#fcaf17",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#ec4899",
  "#84cc16",
  "#64748b",
];
