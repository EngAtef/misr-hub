"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Radar,
  Boxes,
  XCircle,
  Target,
  Cake,
  X,
  Megaphone,
  TrendingDown,
  Search,
  Truck,
  ShoppingBasket,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";
import { createClient } from "../lib/supabase/client";
import { useLang, type DictKey } from "../lib/i18n";
import { cn, formatNumber } from "../lib/utils";

/* ------------------------------------------------------------------ *
 * One alert feed.
 *
 * Until now the store had two independent alarm engines that never met:
 * fn_alerts() (6 order/stock/target checks, shown on the Overview) and
 * fn_traffic_alarms() (10 traffic/ads/SEO checks, buried in a tab on
 * /traffic). Both are read here, merged, sorted by severity, and — the
 * point of the exercise — every item deep-links to the page *with the
 * filters already applied* instead of dropping you on a bare list.
 * ------------------------------------------------------------------ */

interface AlertsData {
  tracking_month: string | null;
  tracking_rate: number | null;
  untracked: number | null;
  tracking_rate_7d: number | null;
  tracking_rate_30d: number | null;
  stockouts: number;
  cancel_rate_recent: number;
  cancel_rate_prior: number;
  target_total: number | null;
  target_actual: number | null;
  target_expected_pct: number;
  birthdays_this_month: number;
  never_purchased: number;
}

interface TrafficAlarm {
  kind: string;
  severity: "red" | "amber" | "info";
  data: Record<string, string | number>;
}

interface FeedItem {
  key: string;
  severity: "red" | "amber" | "info";
  icon: React.ElementType;
  title: string;
  body: string;
  href: string;
}

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

const SEVERITY_ORDER: Record<string, number> = { red: 0, amber: 1, info: 2 };
const VISIBLE_BY_DEFAULT = 6;

export function AlertsBar() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<AlertsData | null>(null);
  const [alarms, setAlarms] = useState<TrafficAlarm[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // fn_alerts is a heavy query — run the bar's own fetch first, then the
    // notification sync sequentially (never in parallel), and at most once
    // per hour per browser so the dashboard doesn't double the load
    supabase.rpc("fn_alerts").then(({ data }) => {
      if (cancelled) return;
      setData(data as AlertsData);
      setLoaded(true);
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

    // traffic alarms are cheap and independent; a failure here must not
    // take the order/stock alerts down with it
    supabase.rpc("fn_traffic_alarms").then(({ data, error }) => {
      if (cancelled || error) return;
      setAlarms((data as TrafficAlarm[]) ?? []);
    });

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const items = useMemo<FeedItem[]>(() => {
    const out: FeedItem[] = [];
    const month = new Date().getMonth() + 1;

    /* ---------- orders / stock / targets (fn_alerts) ---------- */
    if (data) {
      if (data.tracking_rate !== null && data.tracking_rate < 95) {
        out.push({
          key: "tracking",
          severity: data.tracking_rate < 90 ? "red" : "amber",
          icon: Radar,
          title: t("alertTracking"),
          body: fill(t("alertTrackingBody"), {
            rate: data.tracking_rate,
            n: formatNumber(data.untracked ?? 0),
          }),
          href: "/traffic?tab=health",
        });
      }

      // sudden daily-tracking drop (GA4 API data): 7d rate well below 30d rate
      if (
        data.tracking_rate_7d !== null &&
        data.tracking_rate_30d !== null &&
        data.tracking_rate_30d > 0 &&
        data.tracking_rate_7d < data.tracking_rate_30d * 0.85
      ) {
        out.push({
          key: "tracking-drop",
          severity: "red",
          icon: Radar,
          title: t("alertTrackingDrop"),
          body: fill(t("alertTrackingDropBody"), { r7: data.tracking_rate_7d, r30: data.tracking_rate_30d }),
          href: "/traffic?tab=health",
        });
      }

      if (data.stockouts > 0) {
        out.push({
          key: "stockouts",
          severity: data.stockouts >= 10 ? "red" : "amber",
          icon: Boxes,
          title: t("alertStockouts"),
          body: fill(t("alertStockoutsBody"), { n: data.stockouts }),
          href: "/stock?filter=oos",
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
          title: t("alertCancels"),
          body: fill(t("alertCancelsBody"), { r: data.cancel_rate_recent, p: data.cancel_rate_prior }),
          // the delivery-quality report is where cancellations are explained
          href: "/delivery?tab=quality",
        });
      }

      if (data.target_total && data.target_total > 0) {
        const achievedPct = Math.round(((data.target_actual ?? 0) / data.target_total) * 100);
        if (achievedPct < data.target_expected_pct - 10) {
          out.push({
            key: "pace",
            severity: "amber",
            icon: Target,
            title: t("alertPace"),
            body: fill(t("alertPaceBody"), { a: achievedPct, e: data.target_expected_pct }),
            href: "/targets",
          });
        }
      } else if (data.target_total === null) {
        out.push({
          key: "no-target",
          severity: "info",
          icon: Target,
          title: t("alertNoTarget"),
          body: t("alertNoTargetBody"),
          href: "/targets",
        });
      }

      if (data.birthdays_this_month > 0) {
        out.push({
          key: "birthdays",
          severity: "info",
          icon: Cake,
          title: t("alertBirthdays"),
          body: fill(t("alertBirthdaysBody"), { n: formatNumber(data.birthdays_this_month) }),
          href: `/customers?month=${month}#birthdays`,
        });
      }
    }

    /* ---------- traffic / ads / SEO (fn_traffic_alarms) ---------- */
    const n = (v: unknown) => formatNumber(Number(v ?? 0));
    alarms.forEach((a, i) => {
      const d = a.data;
      const base = { key: `${a.kind}-${i}`, severity: a.severity };

      switch (a.kind) {
        case "dead_spend":
          out.push({
            ...base,
            icon: Megaphone,
            title: t("alarmDeadSpendTitle"),
            body: fill(t("alarmDeadSpend"), { name: String(d.name), spend: n(d.spend) }),
            href: `/ads?campaign=${encodeURIComponent(String(d.name))}`,
          });
          break;
        case "low_roas":
          out.push({
            ...base,
            icon: Megaphone,
            title: t("alarmLowRoasTitle"),
            body: fill(t("alarmLowRoas"), { name: String(d.name), spend: n(d.spend), revenue: n(d.revenue) }),
            href: `/ads?campaign=${encodeURIComponent(String(d.name))}`,
          });
          break;
        case "traffic_anomaly":
          out.push({
            ...base,
            icon: TrendingDown,
            title: t("alarmAnomalyTitle"),
            body: fill(t("alarmAnomaly"), { yesterday: n(d.yesterday), avg: n(d.avg) }),
            href: "/traffic?tab=overview",
          });
          break;
        case "oos_traffic":
          out.push({
            ...base,
            icon: Boxes,
            title: t("alarmOosTitle"),
            body: fill(t("alarmOos"), { name: String(d.name), views: n(d.views) }),
            href: `/stock?filter=oos&q=${encodeURIComponent(String(d.name))}`,
          });
          break;
        case "conversion_collapse":
          out.push({
            ...base,
            icon: TrendingDown,
            title: t("alarmCollapseTitle"),
            body: fill(t("alarmCollapse"), { name: String(d.name), cur: String(d.cur), prev: String(d.prev) }),
            href: "/traffic?tab=matrix",
          });
          break;
        case "checkout_leak":
          out.push({
            ...base,
            icon: ShoppingBasket,
            title: t("alarmLeakTitle"),
            body: fill(t("alarmLeak"), { recent: String(d.recent), prior: String(d.prior) }),
            href: "/abandoned",
          });
          break;
        case "rank_drop":
          out.push({
            ...base,
            icon: Search,
            title: t("alarmRankDropTitle"),
            body: fill(t("alarmRankDrop"), { query: String(d.query), prev: String(d.prev), cur: String(d.cur) }),
            href: "/traffic?tab=seo",
          });
          break;
        case "rank_win":
          out.push({
            ...base,
            icon: Search,
            title: t("alarmRankWinTitle"),
            body: fill(t("alarmRankWin"), { query: String(d.query), prev: String(d.prev), cur: String(d.cur) }),
            href: "/traffic?tab=seo",
          });
          break;
        case "city_delivery":
          out.push({
            ...base,
            icon: Truck,
            title: t("alarmCityDelTitle"),
            body: fill(t("alarmCityDel"), { city: String(d.city), cur: String(d.cur), prev: String(d.prev) }),
            // land on the quality report, which explains this city's rate
            href: `/delivery?tab=quality&city=${encodeURIComponent(String(d.city))}`,
          });
          break;
        case "pace_driver": {
          const crCur = Number(d.o_cur) / Math.max(Number(d.s_cur), 1);
          const crPrev = Number(d.o_prev) / Math.max(Number(d.s_prev), 1);
          const aovCur = Number(d.r_cur) / Math.max(Number(d.o_cur), 1);
          const aovPrev = Number(d.r_prev) / Math.max(Number(d.o_prev), 1);
          const drops: [string, number][] = [
            [t("alarmDriverSessions"), Number(d.s_prev) > 0 ? Number(d.s_cur) / Number(d.s_prev) : 1],
            [t("alarmDriverCr"), crPrev > 0 ? crCur / crPrev : 1],
            [t("alarmDriverAov"), aovPrev > 0 ? aovCur / aovPrev : 1],
          ];
          drops.sort((x, y) => x[1] - y[1]);
          out.push({
            ...base,
            icon: TrendingDown,
            title: t("alarmPaceTitle"),
            body: fill(t("alarmPace"), { rc: n(d.r_cur), rp: n(d.r_prev), driver: drops[0][0] }),
            href: "/traffic?tab=channels",
          });
          break;
        }
      }
    });

    return out
      .filter((a) => !dismissed.has(a.key))
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));
  }, [data, alarms, dismissed, t]);

  if (!loaded) return null;

  const styles = {
    red: "border-red-200 bg-red-50 text-red-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    info: "border-brand-200 bg-brand-50 text-brand-800",
  };

  const reds = items.filter((a) => a.severity === "red").length;
  const shown = expanded ? items : items.slice(0, VISIBLE_BY_DEFAULT);
  const hidden = items.length - shown.length;

  return (
    <div className="mb-6 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-600">
        <AlertTriangle size={15} className="text-amber-500" />
        {t("healthTitle")}
        {items.length > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{items.length}</span>
        )}
        {reds > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
            {reds} {t("alertUrgent")}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          <CheckCircle2 size={16} />
          {t("alertsAllClear")}
        </div>
      ) : (
        <>
          <div className="grid gap-2 md:grid-cols-2">
            {shown.map((a) => {
              const Icon = a.icon;
              return (
                <div
                  key={a.key}
                  className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", styles[a.severity])}
                >
                  <Icon size={17} className="mt-0.5 shrink-0" />
                  <Link href={a.href} className="group min-w-0 flex-1">
                    <div className="text-sm font-bold group-hover:underline">{a.title}</div>
                    <div className="mt-0.5 text-xs opacity-80">{a.body}</div>
                  </Link>
                  <button
                    className="shrink-0 opacity-40 transition hover:opacity-100"
                    aria-label={t("dismiss")}
                    onClick={() => setDismissed((p) => new Set(p).add(a.key))}
                  >
                    <X size={15} />
                  </button>
                </div>
              );
            })}
          </div>
          {(hidden > 0 || expanded) && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition hover:text-slate-800"
            >
              <ChevronDown size={14} className={cn("transition", expanded && "rotate-180")} />
              {expanded ? t("alertShowLess") : fill(t("alertShowMore"), { n: hidden })}
            </button>
          )}
        </>
      )}
    </div>
  );
}
