"use client";

import { useMemo, useState } from "react";
import { GitCompareArrows } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface DateRange {
  from: string | null; // ISO date
  to: string | null;
}

type Preset = "7d" | "30d" | "90d" | "month" | "all" | "custom";
export type ComparePreset = "off" | "prev" | "year" | "custom";

export function presetToRange(preset: Preset): DateRange {
  const now = new Date();
  const end = new Date(now.getTime() + 24 * 3600 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (preset) {
    case "7d":
      return { from: iso(new Date(now.getTime() - 7 * 24 * 3600 * 1000)), to: iso(end) };
    case "30d":
      return { from: iso(new Date(now.getTime() - 30 * 24 * 3600 * 1000)), to: iso(end) };
    case "90d":
      return { from: iso(new Date(now.getTime() - 90 * 24 * 3600 * 1000)), to: iso(end) };
    case "month":
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(end) };
    default:
      return { from: null, to: null };
  }
}

// Same length, immediately before the main period.
export function prevPeriod(range: DateRange): DateRange | null {
  if (!range.from || !range.to) return null;
  const from = new Date(range.from + "T00:00:00Z");
  const to = new Date(range.to + "T00:00:00Z");
  const len = to.getTime() - from.getTime();
  if (len <= 0) return null;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(new Date(from.getTime() - len)), to: iso(from) };
}

// Same dates, one year earlier.
export function samePeriodLastYear(range: DateRange): DateRange | null {
  if (!range.from || !range.to) return null;
  const shift = (s: string) => {
    const d = new Date(s + "T00:00:00Z");
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
  };
  return { from: shift(range.from), to: shift(range.to) };
}

export function useDateRange(initial: Preset = "all") {
  const [preset, setPreset] = useState<Preset>(initial);
  const [range, setRange] = useState<DateRange>(presetToRange(initial));
  const [comparePreset, setComparePreset] = useState<ComparePreset>("off");
  const [customCompare, setCustomCompare] = useState<DateRange>({ from: null, to: null });

  // The resolved comparison period (null = compare off / not resolvable).
  // "prev" and "year" follow the main range automatically.
  const compare = useMemo<DateRange | null>(() => {
    if (comparePreset === "off") return null;
    if (comparePreset === "custom") return customCompare.from && customCompare.to ? customCompare : null;
    if (comparePreset === "prev") return prevPeriod(range);
    return samePeriodLastYear(range);
  }, [comparePreset, customCompare, range]);

  return { preset, setPreset, range, setRange, comparePreset, setComparePreset, customCompare, setCustomCompare, compare };
}

export function DateRangeFilter({
  preset,
  setPreset,
  range,
  setRange,
  comparePreset,
  setComparePreset,
  customCompare,
  setCustomCompare,
  compare,
}: {
  preset: Preset;
  setPreset: (p: Preset) => void;
  range: DateRange;
  setRange: (r: DateRange) => void;
  // compare props are optional so pages can adopt gradually
  comparePreset?: ComparePreset;
  setComparePreset?: (p: ComparePreset) => void;
  customCompare?: DateRange;
  setCustomCompare?: (r: DateRange) => void;
  compare?: DateRange | null;
}) {
  const { t } = useLang();
  const presets: { key: Preset; label: string }[] = [
    { key: "7d", label: t("last7") },
    { key: "30d", label: t("last30") },
    { key: "90d", label: t("last90") },
    { key: "month", label: t("thisMonth") },
    { key: "all", label: t("allTime") },
    { key: "custom", label: t("custom") },
  ];
  const compareOptions: { key: ComparePreset; label: string }[] = [
    { key: "prev", label: t("comparePrev") },
    { key: "year", label: t("compareYear") },
    { key: "custom", label: t("custom") },
  ];
  const canCompare = !!setComparePreset;
  const compareOn = canCompare && comparePreset !== "off";
  // prev/year need a bounded main range
  const needsBoundedRange = comparePreset === "prev" || comparePreset === "year";
  const unresolved = compareOn && !compare;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {presets.map((p) => (
            <button
              key={p.key}
              onClick={() => {
                setPreset(p.key);
                if (p.key !== "custom") setRange(presetToRange(p.key));
              }}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                preset === p.key ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="input !w-auto"
              value={range.from ?? ""}
              onChange={(e) => setRange({ ...range, from: e.target.value || null })}
            />
            <span className="text-slate-400 text-sm">→</span>
            <input
              type="date"
              className="input !w-auto"
              value={range.to ?? ""}
              onChange={(e) => setRange({ ...range, to: e.target.value || null })}
            />
          </div>
        )}
        {canCompare && (
          <button
            onClick={() => setComparePreset!(compareOn ? "off" : "prev")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
              compareOn ? "bg-violet-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"
            )}
          >
            <GitCompareArrows size={14} />
            {t("compareBtn")}
          </button>
        )}
      </div>

      {compareOn && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-lg bg-violet-50 p-1">
            {compareOptions.map((c) => (
              <button
                key={c.key}
                onClick={() => setComparePreset!(c.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                  comparePreset === c.key ? "bg-white text-violet-700 shadow-sm" : "text-violet-500 hover:text-violet-800"
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          {comparePreset === "custom" && setCustomCompare && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                className="input !w-auto"
                value={customCompare?.from ?? ""}
                onChange={(e) => setCustomCompare({ from: e.target.value || null, to: customCompare?.to ?? null })}
              />
              <span className="text-slate-400 text-sm">→</span>
              <input
                type="date"
                className="input !w-auto"
                value={customCompare?.to ?? ""}
                onChange={(e) => setCustomCompare({ from: customCompare?.from ?? null, to: e.target.value || null })}
              />
            </div>
          )}
          {compare ? (
            <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-bold text-violet-700" dir="ltr">
              {t("vsLbl")} {compare.from} → {compare.to}
            </span>
          ) : unresolved && needsBoundedRange ? (
            <span className="text-[11px] font-semibold text-amber-600">{t("comparePickRange")}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
