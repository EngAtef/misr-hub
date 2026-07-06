"use client";

import { useEffect, useMemo, useState } from "react";
import { Target, TrendingUp, Users, MousePointerClick, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";
import { formatMoney, formatNumber, cn } from "@/lib/utils";

interface TargetRow {
  period_month: string;
  quarter: string | null;
  label: string | null;
  total_target: number;
  kids_target: number;
  cultural_target: number;
  actual_revenue: number;
  actual_orders: number;
  progress_pct: number;
  aov: number;
  conv_rate: number;
}

function monthName(iso: string, lang: "ar" | "en") {
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { month: "long", year: "numeric" });
}

export default function TargetsPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TargetRow | null>(null);

  useEffect(() => {
    supabase.rpc("fn_targets_overview").then(({ data }) => {
      const list = (data as TargetRow[]) ?? [];
      setRows(list);
      // default-select the current month if present, else the last one with actuals
      const now = new Date();
      const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const cur = list.find((r) => r.period_month.startsWith(curKey));
      setSelected(cur ?? list.find((r) => r.actual_revenue > 0) ?? list[0] ?? null);
      setLoading(false);
    });
  }, [supabase]);

  const annual = useMemo(() => {
    const target = rows.reduce((s, r) => s + r.total_target, 0);
    const actual = rows.reduce((s, r) => s + r.actual_revenue, 0);
    return { target, actual, pct: target > 0 ? (actual / target) * 100 : 0 };
  }, [rows]);

  if (loading) return <div><PageHeader title={t("targets")} /><Spinner /></div>;
  if (!rows.length) return <div><PageHeader title={t("targets")} /><EmptyState message={t("noData")} /></div>;

  return (
    <div>
      <PageHeader title={t("targets")} subtitle={t("targetsSubtitle")} />

      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-slate-700">{t("targetYear")} (Jul 2025 – Jun 2026)</h3>
          <span className={cn("text-sm font-bold", annual.pct >= 70 ? "text-emerald-600" : annual.pct >= 40 ? "text-amber-600" : "text-red-600")}>
            {annual.pct.toFixed(1)}%
          </span>
        </div>
        <ProgressBar pct={annual.pct} />
        <div className="mt-2 flex justify-between text-sm text-slate-600">
          <span>{t("achieved")}: <b>{formatMoney(annual.actual, lang)}</b></span>
          <span>{t("monthlyTarget")}: <b>{formatMoney(annual.target, lang)}</b></span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 mb-8">
        {rows.map((r) => {
          const status = r.progress_pct >= 70 ? "onTrack" : r.progress_pct >= 40 ? "behind" : "behind";
          return (
            <div
              key={r.period_month}
              className={cn("card p-4 cursor-pointer transition hover:shadow-md", selected?.period_month === r.period_month && "ring-2 ring-brand-400")}
              onClick={() => setSelected(r)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold">{monthName(r.period_month, lang)}</div>
                  <div className="text-[11px] text-slate-400">{r.quarter} · {r.label}</div>
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold",
                  r.progress_pct >= 70 ? "bg-emerald-100 text-emerald-700" : r.progress_pct >= 40 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700")}>
                  {r.progress_pct}%
                </span>
              </div>
              <div className="mt-3"><ProgressBar pct={r.progress_pct} /></div>
              <div className="mt-2 flex justify-between text-xs text-slate-600">
                <span>{formatMoney(r.actual_revenue, lang)}</span>
                <span className="text-slate-400">/ {formatMoney(r.total_target, lang)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {selected && <StepsToAchieve row={selected} />}
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.min(pct, 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function StepsToAchieve({ row }: { row: TargetRow }) {
  const { t, lang } = useLang();

  const now = new Date();
  const monthStart = new Date(row.period_month);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const daysInMonth = monthEnd.getDate();
  const isCurrent = now.getFullYear() === monthStart.getFullYear() && now.getMonth() === monthStart.getMonth();
  const isPast = monthEnd < now;
  const daysRemaining = isCurrent ? Math.max(daysInMonth - now.getDate(), 1) : isPast ? 0 : daysInMonth;

  const remaining = Math.max(row.total_target - row.actual_revenue, 0);
  const aov = row.aov || 550;
  const neededOrders = Math.ceil(remaining / aov);
  const neededDaily = daysRemaining > 0 ? Math.ceil(neededOrders / daysRemaining) : neededOrders;
  const requiredTraffic = Math.ceil(neededOrders / (row.conv_rate || 0.015));
  // implied ad budget assuming a conservative 3x ROAS on the paid-driven share (~50% of remaining)
  const impliedBudget = Math.round((remaining * 0.5) / 3);

  const steps: { icon: React.ElementType; label: string; value: string; hint: string }[] = [
    {
      icon: Target,
      label: t("remainingToTarget"),
      value: formatMoney(remaining, lang),
      hint: `${row.progress_pct}% ${t("achieved")}`,
    },
    {
      icon: Users,
      label: t("neededOrders"),
      value: formatNumber(neededOrders),
      hint: `${t("avgOrderValue")}: ${formatMoney(aov, lang)}`,
    },
    {
      icon: TrendingUp,
      label: t("neededDaily"),
      value: `${formatNumber(neededDaily)} ${t("ordersLabel")}`,
      hint: daysRemaining > 0 ? `${daysRemaining} ${t("days")}` : t("completed"),
    },
    {
      icon: MousePointerClick,
      label: t("requiredTraffic"),
      value: formatNumber(requiredTraffic),
      hint: `${((row.conv_rate || 0.015) * 100).toFixed(1)}% ${t("actualCr")}`,
    },
    {
      icon: Wallet,
      label: t("impliedBudget"),
      value: formatMoney(impliedBudget, lang),
      hint: "ROAS 3x",
    },
  ];

  return (
    <div>
      <h2 className="mb-3 text-lg font-bold">{t("stepsToAchieve")} — {monthName(row.period_month, lang)}</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={i} className="card p-4">
              <div className="flex items-center gap-2 text-brand-600">
                <Icon size={18} />
                <span className="text-xs font-semibold text-slate-500">{s.label}</span>
              </div>
              <div className="mt-2 text-xl font-bold">{s.value}</div>
              <div className="text-xs text-slate-400 mt-0.5">{s.hint}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
