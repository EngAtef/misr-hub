"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { KpiCard, ChartCard, Spinner, EmptyState } from "@/components/ui";
import { BarsChart } from "@/components/charts";
import { formatMoney, formatNumber, toCsv, downloadCsv, cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Delivery quality: the one place where delivery speed, ratings,
 * cancellations and returns are looked at together.
 *
 * All of it comes from fn_delivery_quality() in a single round trip —
 * unlike the rest of /delivery, which pulls up to 60k order rows into
 * the browser and aggregates client-side.
 * ------------------------------------------------------------------ */

interface Summary {
  orders: number;
  delivered: number;
  cancelled: number;
  returned: number;
  rts: number;
  lost_value: number;
  avg_days: number | null;
  median_days: number | null;
  avg_handling_days: number | null;
  rated: number;
  avg_customer_rating: number | null;
  avg_driver_rating: number | null;
  cancel_pct: number | null;
  return_pct: number | null;
}

interface CityRow {
  city: string;
  orders: number;
  delivered: number;
  cancelled: number;
  returned: number;
  rts: number;
  lost_value: number;
  avg_days: number | null;
  handling_days: number | null;
  rated: number;
  customer_rating: number | null;
  driver_rating: number | null;
  cancel_pct: number | null;
  return_pct: number | null;
  rts_pct: number | null;
}

interface SpeedRow {
  bucket: string;
  bucket_order: number;
  orders: number;
  share_pct: number | null;
  rated: number;
  customer_rating: number | null;
  driver_rating: number | null;
  returned: number;
  return_pct: number | null;
  aov: number | null;
}

interface ReasonRow {
  reason: string;
  orders: number;
  value: number;
  share_pct: number | null;
  avg_days: number | null;
  top_city: string | null;
}

interface PaymentRow {
  payment_method: string;
  orders: number;
  avg_days: number | null;
  cancel_pct: number | null;
  return_pct: number | null;
  customer_rating: number | null;
  lost_value: number;
}

interface Payload {
  summary: Summary;
  by_city: CityRow[];
  by_speed: SpeedRow[];
  by_reason: ReasonRow[];
  by_payment: PaymentRow[];
  ratings: { kind: string; rating: number; orders: number }[];
}

function ExportBtn({ rows, name }: { rows: Record<string, unknown>[]; name: string }) {
  const { t } = useLang();
  if (!rows.length) return null;
  return (
    <button
      className="btn-secondary text-xs"
      onClick={() => downloadCsv(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows))}
    >
      <Download size={14} />
      {t("exportCsv")}
    </button>
  );
}

// colour a rate cell relative to the store-wide rate: red = clearly worse
function rateTone(value: number | null, baseline: number | null): string {
  if (value == null || baseline == null || baseline === 0) return "text-slate-700";
  if (value >= baseline * 1.5) return "text-red-600 font-bold";
  if (value >= baseline * 1.15) return "text-amber-600 font-semibold";
  if (value <= baseline * 0.7) return "text-emerald-600 font-semibold";
  return "text-slate-700";
}

export function DeliveryQuality({ from, to }: { from: string | null; to: string | null }) {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [citySort, setCitySort] = useState<"cancel" | "rts" | "days" | "lost" | "orders">("cancel");

  // ?city= from the city-delivery alarm: highlight that row and scroll to it
  const [highlightCity, setHighlightCity] = useState<string | null>(null);
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("city");
    if (c) setHighlightCity(c);
  }, []);

  useEffect(() => {
    if (!highlightCity || loading) return;
    const timer = setTimeout(
      () => document.getElementById(`dq-city-${highlightCity}`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
      250
    );
    return () => clearTimeout(timer);
  }, [highlightCity, loading]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    supabase
      .rpc("fn_delivery_quality", {
        p_from: from ? `${from}T00:00:00Z` : null,
        p_to: to ? `${to}T23:59:59Z` : null,
        p_min_orders: 50,
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        // surface the failure — never render an empty state on error
        if (error) setError(error.message);
        else setData(data as Payload);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, from, to]);

  const cities = useMemo(() => {
    const rows = [...(data?.by_city ?? [])];
    const key = {
      cancel: (r: CityRow) => r.cancel_pct ?? 0,
      rts: (r: CityRow) => r.rts_pct ?? 0,
      days: (r: CityRow) => r.avg_days ?? 0,
      lost: (r: CityRow) => r.lost_value ?? 0,
      orders: (r: CityRow) => r.orders ?? 0,
    }[citySort];
    return rows.sort((a, b) => key(b) - key(a));
  }, [data, citySort]);

  if (loading) return <Spinner />;
  if (error)
    return (
      <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <div className="flex items-center gap-2 font-bold">
          <TriangleAlert size={16} />
          {t("dqLoadFailed")}
        </div>
        <div className="mt-1 text-xs opacity-80" dir="ltr">
          {error}
        </div>
      </div>
    );
  if (!data || !data.summary || data.summary.orders === 0) return <EmptyState message={t("noData")} />;

  const s = data.summary;
  const money = (n: number) => formatMoney(n, lang);

  // the two headline stories, computed rather than hard-coded
  const worstCity = cities.length ? [...cities].sort((a, b) => (b.cancel_pct ?? 0) - (a.cancel_pct ?? 0))[0] : null;
  const slowCity = cities.length ? [...cities].sort((a, b) => (b.avg_days ?? 0) - (a.avg_days ?? 0))[0] : null;
  const waitReason = (data.by_reason ?? []).find((r) => /too long|wait|الانتظار|طويل/i.test(r.reason));

  const speedChart = (data.by_speed ?? []).map((r) => ({
    label: `${r.bucket} ${t("days")}`,
    orders: r.orders,
    return_pct: r.return_pct ?? 0,
  }));

  const CITY_SORTS: { key: typeof citySort; label: string }[] = [
    { key: "cancel", label: t("dqSortCancel") },
    { key: "rts", label: t("dqSortRts") },
    { key: "days", label: t("dqSortDays") },
    { key: "lost", label: t("dqSortLost") },
    { key: "orders", label: t("dqSortOrders") },
  ];

  return (
    <div className="space-y-6">
      {/* headline: the money actually lost */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label={t("dqLostValue")} value={money(s.lost_value)} accent="red" sub={t("dqLostValueSub")} />
        <KpiCard
          label={t("cancelled")}
          value={formatNumber(s.cancelled)}
          accent="amber"
          sub={`${s.cancel_pct ?? 0}% ${t("dqOfOrders")}`}
        />
        <KpiCard
          label={t("returned")}
          value={formatNumber(s.returned)}
          accent="amber"
          sub={`${s.return_pct ?? 0}% ${t("dqOfOrders")}`}
        />
        <KpiCard
          label={t("dqMedianDays")}
          value={s.median_days != null ? `${formatNumber(s.median_days)} ${t("days")}` : "—"}
          accent="green"
          sub={s.avg_days != null ? `${t("dqAvgDays")}: ${s.avg_days}` : undefined}
        />
        <KpiCard
          label={t("dqCustomerRating")}
          value={s.avg_customer_rating != null ? `${s.avg_customer_rating} ★` : "—"}
          accent="slate"
          sub={`${formatNumber(s.rated)} ${t("dqRatedOrders")}`}
        />
        <KpiCard
          label={t("dqDriverRating")}
          value={s.avg_driver_rating != null ? `${s.avg_driver_rating} ★` : "—"}
          accent="slate"
          sub={`${t("dqRtsShort")}: ${formatNumber(s.rts)}`}
        />
      </div>

      {/* plain-language read of the numbers above */}
      <div className="card space-y-2 p-4 text-sm">
        <div className="flex items-center gap-2 font-bold text-slate-700">
          <TriangleAlert size={15} className="text-amber-500" />
          {t("dqReadTitle")}
        </div>
        {worstCity && (
          <p className="text-slate-600">
            {t("dqReadCity")
              .replace("{city}", worstCity.city)
              .replace("{rate}", String(worstCity.cancel_pct ?? 0))
              .replace("{base}", String(s.cancel_pct ?? 0))
              .replace("{value}", money(worstCity.lost_value))}
          </p>
        )}
        {slowCity && (
          <p className="text-slate-600">
            {t("dqReadSlow")
              .replace("{city}", slowCity.city)
              .replace("{days}", String(slowCity.avg_days ?? 0))
              .replace("{median}", String(s.median_days ?? 0))}
          </p>
        )}
        {waitReason && (
          <p className="text-slate-600">
            {t("dqReadWait")
              .replace("{n}", formatNumber(waitReason.orders))
              .replace("{value}", money(waitReason.value))}
          </p>
        )}
        {s.rated > 0 && (
          <p className="text-slate-500">
            {t("dqReadRating")
              .replace("{rated}", formatNumber(s.rated))
              .replace("{pct}", String(Math.round((s.rated / s.orders) * 100)))}
          </p>
        )}
      </div>

      {/* city table — the "where are we losing orders" answer */}
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-slate-800">{t("dqByCity")}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
              {CITY_SORTS.map((x) => (
                <button
                  key={x.key}
                  onClick={() => setCitySort(x.key)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-semibold transition",
                    citySort === x.key ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  {x.label}
                </button>
              ))}
            </div>
            <ExportBtn rows={cities as unknown as Record<string, unknown>[]} name="delivery-quality-by-city" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2 text-start">{t("city")}</th>
                <th className="px-2 py-2 text-end">{t("orders")}</th>
                <th className="px-2 py-2 text-end">{t("dqCancelPct")}</th>
                <th className="px-2 py-2 text-end">{t("dqReturnPct")}</th>
                <th className="px-2 py-2 text-end">{t("dqRtsPct")}</th>
                <th className="px-2 py-2 text-end">{t("dqAvgDays")}</th>
                <th className="px-2 py-2 text-end">{t("dqCustomerRating")}</th>
                <th className="px-2 py-2 text-end">{t("dqLostValue")}</th>
              </tr>
            </thead>
            <tbody>
              {cities.map((r) => (
                <tr
                  key={r.city}
                  id={`dq-city-${r.city}`}
                  className={cn(
                    "border-b border-slate-100 last:border-0 hover:bg-slate-50",
                    highlightCity === r.city && "bg-amber-50 ring-2 ring-inset ring-amber-300"
                  )}
                >
                  <td className="px-2 py-2 font-semibold text-slate-800">
                    <a href={`/orders?city=${encodeURIComponent(r.city)}`} className="text-brand-700 hover:underline">
                      {r.city}
                    </a>
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums text-slate-600">{formatNumber(r.orders)}</td>
                  <td className={cn("px-2 py-2 text-end tabular-nums", rateTone(r.cancel_pct, s.cancel_pct))}>
                    {r.cancel_pct ?? 0}%
                  </td>
                  <td className={cn("px-2 py-2 text-end tabular-nums", rateTone(r.return_pct, s.return_pct))}>
                    {r.return_pct ?? 0}%
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums text-slate-600">{r.rts_pct ?? 0}%</td>
                  <td className={cn("px-2 py-2 text-end tabular-nums", rateTone(r.avg_days, s.avg_days))}>
                    {r.avg_days ?? "—"}
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums text-slate-600">
                    {r.customer_rating != null ? `${r.customer_rating} ★` : "—"}
                    <span className="ms-1 text-[11px] text-slate-400">({r.rated})</span>
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums font-semibold text-slate-800">{money(r.lost_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">{t("dqCityNote")}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* does slow delivery cost us? */}
        <ChartCard title={t("dqBySpeed")}>
          <BarsChart
            data={speedChart as unknown as Record<string, unknown>[]}
            xKey="label"
            series={[{ key: "orders", name: t("orders") }]}
          />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-1.5 text-start">{t("dqSpeedBucket")}</th>
                  <th className="px-2 py-1.5 text-end">{t("orders")}</th>
                  <th className="px-2 py-1.5 text-end">{t("dqReturnPct")}</th>
                  <th className="px-2 py-1.5 text-end">{t("dqCustomerRating")}</th>
                  <th className="px-2 py-1.5 text-end">{t("avgOrderValue")}</th>
                </tr>
              </thead>
              <tbody>
                {(data.by_speed ?? []).map((r) => (
                  <tr key={r.bucket} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-1.5 font-semibold text-slate-700">
                      {r.bucket} {t("days")}
                    </td>
                    <td className="px-2 py-1.5 text-end tabular-nums text-slate-600">
                      {formatNumber(r.orders)}
                      <span className="ms-1 text-[11px] text-slate-400">{r.share_pct ?? 0}%</span>
                    </td>
                    <td className={cn("px-2 py-1.5 text-end tabular-nums", rateTone(r.return_pct, s.return_pct))}>
                      {r.return_pct ?? 0}%
                    </td>
                    <td className="px-2 py-1.5 text-end tabular-nums text-slate-600">
                      {r.customer_rating != null ? `${r.customer_rating} ★` : "—"}
                      <span className="ms-1 text-[11px] text-slate-400">({r.rated})</span>
                    </td>
                    <td className="px-2 py-1.5 text-end tabular-nums text-slate-600">{money(r.aov ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">{t("dqSpeedNote")}</p>
        </ChartCard>

        {/* why they cancel, with the money attached */}
        <ChartCard title={t("dqByReason")}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-1.5 text-start">{t("dqReason")}</th>
                  <th className="px-2 py-1.5 text-end">{t("orders")}</th>
                  <th className="px-2 py-1.5 text-end">{t("dqValue")}</th>
                  <th className="px-2 py-1.5 text-start">{t("dqTopCity")}</th>
                </tr>
              </thead>
              <tbody>
                {(data.by_reason ?? []).map((r) => (
                  <tr key={r.reason} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-1.5 text-slate-700">{r.reason}</td>
                    <td className="px-2 py-1.5 text-end tabular-nums font-semibold text-slate-800">
                      {formatNumber(r.orders)}
                      <span className="ms-1 text-[11px] text-slate-400">{r.share_pct ?? 0}%</span>
                    </td>
                    <td className="px-2 py-1.5 text-end tabular-nums text-slate-600">{money(r.value)}</td>
                    <td className="px-2 py-1.5 text-slate-500">{r.top_city ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3">
            <ExportBtn
              rows={(data.by_reason ?? []) as unknown as Record<string, unknown>[]}
              name="cancellation-reasons"
            />
          </div>
        </ChartCard>
      </div>

      {/* payment method: the other half of the cancellation story */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-bold text-slate-800">{t("dqByPayment")}</h3>
          <ExportBtn
            rows={(data.by_payment ?? []) as unknown as Record<string, unknown>[]}
            name="delivery-quality-by-payment"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2 text-start">{t("paymentMethod")}</th>
                <th className="px-2 py-2 text-end">{t("orders")}</th>
                <th className="px-2 py-2 text-end">{t("dqCancelPct")}</th>
                <th className="px-2 py-2 text-end">{t("dqReturnPct")}</th>
                <th className="px-2 py-2 text-end">{t("dqAvgDays")}</th>
                <th className="px-2 py-2 text-end">{t("dqCustomerRating")}</th>
                <th className="px-2 py-2 text-end">{t("dqLostValue")}</th>
              </tr>
            </thead>
            <tbody>
              {(data.by_payment ?? []).map((r) => (
                <tr key={r.payment_method} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-2 py-2 font-semibold text-slate-800">{r.payment_method}</td>
                  <td className="px-2 py-2 text-end tabular-nums text-slate-600">{formatNumber(r.orders)}</td>
                  <td className={cn("px-2 py-2 text-end tabular-nums", rateTone(r.cancel_pct, s.cancel_pct))}>
                    {r.cancel_pct ?? 0}%
                  </td>
                  <td className={cn("px-2 py-2 text-end tabular-nums", rateTone(r.return_pct, s.return_pct))}>
                    {r.return_pct ?? 0}%
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums text-slate-600">{r.avg_days ?? "—"}</td>
                  <td className="px-2 py-2 text-end tabular-nums text-slate-600">
                    {r.customer_rating != null ? `${r.customer_rating} ★` : "—"}
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums font-semibold text-slate-800">{money(r.lost_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
