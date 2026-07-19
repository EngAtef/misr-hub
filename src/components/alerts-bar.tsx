"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Radar, Boxes, XCircle, Target, Cake, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { cn, formatNumber } from "@/lib/utils";

interface AlertsData {
  tracking_month: string | null;
  tracking_rate: number | null;
  untracked: number | null;
  stockouts: number;
  cancel_rate_recent: number;
  cancel_rate_prior: number;
  target_total: number | null;
  target_actual: number | null;
  target_expected_pct: number;
  birthdays_this_month: number;
  never_purchased: number;
}

interface AlertItem {
  key: string;
  severity: "red" | "amber" | "info";
  icon: React.ElementType;
  titleKey: DictKey;
  body: string;
  href: string;
}

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

export function AlertsBar() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<AlertsData | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    // fn_alerts is a heavy query — run the bar's own fetch first, then the
    // notification sync sequentially (never in parallel), and at most once
    // per hour per browser so the dashboard doesn't double the load
    supabase.rpc("fn_alerts").then(({ data }) => {
      setData(data as AlertsData);
      try {
        const last = Number(localStorage.getItem("alertSyncAt") || 0);
        if (Date.now() - last > 3600_000) {
          localStorage.setItem("alertSyncAt", String(Date.now()));
          supabase.rpc("sync_alert_notifications").then(
            () => undefined,
            () => undefined
          );
        }
      } catch {
        // private mode etc. — skip the sync rather than break the bar
      }
    });
  }, [supabase]);

  const alerts = useMemo<AlertItem[]>(() => {
    if (!data) return [];
    const out: AlertItem[] = [];

    if (data.tracking_rate !== null && data.tracking_rate < 95) {
      out.push({
        key: "tracking",
        severity: data.tracking_rate < 90 ? "red" : "amber",
        icon: Radar,
        titleKey: "alertTracking",
        body: fill(t("alertTrackingBody"), { rate: data.tracking_rate, n: formatNumber(data.untracked ?? 0) }),
        href: "/traffic",
      });
    }

    if (data.stockouts > 0) {
      out.push({
        key: "stockouts",
        severity: data.stockouts >= 10 ? "red" : "amber",
        icon: Boxes,
        titleKey: "alertStockouts",
        body: fill(t("alertStockoutsBody"), { n: data.stockouts }),
        href: "/stock",
      });
    }

    if (
      data.cancel_rate_recent > 5 &&
      data.cancel_rate_recent > data.cancel_rate_prior * 1.5 &&
      data.cancel_rate_prior > 0
    ) {
      out.push({
        key: "cancels",
        severity: "red",
        icon: XCircle,
        titleKey: "alertCancels",
        body: fill(t("alertCancelsBody"), { r: data.cancel_rate_recent, p: data.cancel_rate_prior }),
        href: "/analytics",
      });
    }

    if (data.target_total && data.target_total > 0) {
      const achievedPct = Math.round(((data.target_actual ?? 0) / data.target_total) * 100);
      if (achievedPct < data.target_expected_pct - 10) {
        out.push({
          key: "pace",
          severity: "amber",
          icon: Target,
          titleKey: "alertPace",
          body: fill(t("alertPaceBody"), { a: achievedPct, e: data.target_expected_pct }),
          href: "/targets",
        });
      }
    } else if (data.target_total === null) {
      out.push({
        key: "no-target",
        severity: "info",
        icon: Target,
        titleKey: "alertNoTarget",
        body: t("alertNoTargetBody"),
        href: "/targets",
      });
    }

    if (data.birthdays_this_month > 0) {
      out.push({
        key: "birthdays",
        severity: "info",
        icon: Cake,
        titleKey: "alertBirthdays",
        body: fill(t("alertBirthdaysBody"), { n: formatNumber(data.birthdays_this_month) }),
        href: "/customers",
      });
    }

    return out.filter((a) => !dismissed.has(a.key));
  }, [data, dismissed, t]);

  if (!data || alerts.length === 0) return null;

  const styles = {
    red: "border-red-200 bg-red-50 text-red-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    info: "border-brand-200 bg-brand-50 text-brand-800",
  };

  return (
    <div className="mb-6 space-y-2">
      <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
        <AlertTriangle size={15} className="text-amber-500" />
        {t("healthTitle")}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {alerts.map((a) => {
          const Icon = a.icon;
          return (
            <div key={a.key} className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", styles[a.severity])}>
              <Icon size={17} className="mt-0.5 shrink-0" />
              <Link href={a.href} className="min-w-0 flex-1 group">
                <div className="text-sm font-bold group-hover:underline">{t(a.titleKey)}</div>
                <div className="text-xs opacity-80 mt-0.5">{a.body}</div>
              </Link>
              <button
                className="shrink-0 opacity-40 hover:opacity-100"
                onClick={() => setDismissed((p) => new Set(p).add(a.key))}
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
