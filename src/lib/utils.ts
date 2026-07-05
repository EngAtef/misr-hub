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

export function formatPercent(part: number, total: number): string {
  if (!total) return "0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
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
  });
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!rows.length) return "";
  const cols = columns ?? Object.keys(rows[0]);
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
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
