"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { Spinner, EmptyState } from "@/components/ui";
import { formatNumber, formatDateTime, cn } from "@/lib/utils";

interface InsightsData {
  users: {
    user_email: string;
    total: number;
    visits: number;
    clicks: number;
    actions: number;
    active_days: number;
    last_seen: string;
  }[];
  pages: { page: string; visits: number; users: number }[];
  hours: { h: number; c: number }[];
  days: { d: string; c: number }[];
}

const PERIODS = [7, 14, 30] as const;

/** Owner-only aggregate view over user_activity (fn_activity_insights RPC). */
export function ActivityInsights() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [days, setDays] = useState<(typeof PERIODS)[number]>(7);
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const from = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
      const { data: res } = await supabase.rpc("fn_activity_insights", { p_from: from });
      if (cancelled) return;
      setData((res as InsightsData) ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, days]);

  const totals = useMemo(() => {
    if (!data) return { events: 0, maxDay: 0, maxHour: 0, maxPage: 0, maxUser: 0 };
    return {
      events: data.users.reduce((s, u) => s + Number(u.total), 0),
      maxDay: Math.max(1, ...data.days.map((d) => Number(d.c))),
      maxHour: Math.max(1, ...data.hours.map((h) => Number(h.c))),
      maxPage: Math.max(1, ...data.pages.map((p) => Number(p.visits))),
      maxUser: Math.max(1, ...data.users.map((u) => Number(u.total))),
    };
  }, [data]);

  if (loading) return <Spinner />;
  if (!data || data.users.length === 0) return <EmptyState message={t("noActivity")} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setDays(p)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition",
                days === p ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500 hover:border-slate-300"
              )}
            >
              {p} {t("days")}
            </button>
          ))}
        </div>
        <span className="text-sm text-slate-500">
          {t("totalEvents")}: <b dir="ltr">{formatNumber(totals.events)}</b>
        </span>
      </div>

      {/* daily activity sparkbar */}
      <div className="card p-4">
        <h3 className="mb-3 text-sm font-bold text-slate-700">{t("dailyActivity")}</h3>
        <div className="flex h-24 items-end gap-1">
          {data.days.map((d) => (
            <div
              key={d.d}
              title={`${d.d} — ${formatNumber(Number(d.c))}`}
              className="flex-1 rounded-t bg-brand-500/80 hover:bg-brand-600"
              style={{ height: `${Math.max(4, (Number(d.c) / totals.maxDay) * 100)}%` }}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* most active users */}
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-bold text-slate-700">{t("mostActiveUsers")}</h3>
          <div className="space-y-2.5">
            {data.users.map((u) => (
              <div key={u.user_email}>
                <div className="mb-0.5 flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-slate-700" dir="ltr">{u.user_email}</span>
                  <span className="shrink-0 text-slate-400" dir="ltr">
                    {formatNumber(Number(u.total))} · {u.active_days} {t("activeDaysLbl")}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: `${(Number(u.total) / totals.maxUser) * 100}%` }}
                  />
                </div>
                <div className="mt-0.5 text-[10px] text-slate-400" dir="ltr">
                  {formatNumber(Number(u.visits))} {t("visitKind")} · {formatNumber(Number(u.clicks))} {t("clickKind")} · {formatNumber(Number(u.actions))} {t("actionKind")} · {t("lastSeen")}: {formatDateTime(u.last_seen)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* most used sections */}
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-bold text-slate-700">{t("mostVisitedPages")}</h3>
          <div className="space-y-2">
            {data.pages.slice(0, 15).map((p) => (
              <div key={p.page}>
                <div className="mb-0.5 flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-mono text-slate-700" dir="ltr">{p.page}</span>
                  <span className="shrink-0 text-slate-400" dir="ltr">
                    {formatNumber(Number(p.visits))} · {p.users} {t("usersCol")}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-sky-500"
                    style={{ width: `${(Number(p.visits) / totals.maxPage) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* busiest hours */}
      <div className="card p-4">
        <h3 className="mb-3 text-sm font-bold text-slate-700">{t("busiestHours")}</h3>
        <div className="flex h-20 items-end gap-1" dir="ltr">
          {Array.from({ length: 24 }, (_, h) => {
            const c = Number(data.hours.find((x) => Number(x.h) === h)?.c ?? 0);
            return (
              <div key={h} className="flex flex-1 flex-col items-center gap-1">
                <div
                  title={`${h}:00 — ${formatNumber(c)}`}
                  className="w-full rounded-t bg-amber-400/90 hover:bg-amber-500"
                  style={{ height: `${Math.max(2, (c / totals.maxHour) * 64)}px` }}
                />
                {h % 4 === 0 && <span className="text-[9px] text-slate-400">{h}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
