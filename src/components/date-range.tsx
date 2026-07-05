"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface DateRange {
  from: string | null; // ISO date
  to: string | null;
}

type Preset = "7d" | "30d" | "90d" | "month" | "all" | "custom";

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

export function useDateRange(initial: Preset = "all") {
  const [preset, setPreset] = useState<Preset>(initial);
  const [range, setRange] = useState<DateRange>(presetToRange(initial));
  return { preset, setPreset, range, setRange };
}

export function DateRangeFilter({
  preset,
  setPreset,
  range,
  setRange,
}: {
  preset: Preset;
  setPreset: (p: Preset) => void;
  range: DateRange;
  setRange: (r: DateRange) => void;
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

  return (
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
    </div>
  );
}
