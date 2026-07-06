"use client";

import { cn, STATUS_COLORS, STATUS_AR } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  accent = "brand",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "brand" | "green" | "red" | "amber" | "slate";
}) {
  const accents: Record<string, string> = {
    brand: "border-s-brand-500",
    green: "border-s-emerald-500",
    red: "border-s-red-500",
    amber: "border-s-amber-500",
    slate: "border-s-slate-400",
  };
  return (
    <div className={cn("card p-4 border-s-4", accents[accent])}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string | null }) {
  const { lang } = useLang();
  if (!status) return <span className="text-slate-400">—</span>;
  const color = STATUS_COLORS[status] ?? "bg-slate-100 text-slate-700";
  const label = lang === "ar" ? (STATUS_AR[status] ?? status) : status;
  return (
    <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", color)}>
      {label}
    </span>
  );
}

export function ChartCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("card p-5", className)}>
      <h3 className="mb-4 text-sm font-bold text-slate-700">{title}</h3>
      {children}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" />
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="card p-12 text-center text-slate-500">{message}</div>;
}
