"use client";

import { useCallback, useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { cn, STATUS_COLORS, STATUS_AR } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

// ---- Table sorting -------------------------------------------------
export type SortState = { key: string; dir: "asc" | "desc" } | null;

function sortCmp(a: unknown, b: unknown): number {
  const aEmpty = a == null || a === "";
  const bEmpty = b == null || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return -1;
  if (bEmpty) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const an = Number(a), bn = Number(b);
  if (!isNaN(an) && !isNaN(bn) && String(a).trim() !== "" && String(b).trim() !== "") return an - bn;
  return String(a).localeCompare(String(b), "ar");
}

/**
 * Client-side table sorting. `apply(rows, accessors)` returns the rows
 * sorted by the active column; clicking a SortTh cycles desc → asc → off.
 */
export function useSort<T>() {
  const [sort, setSort] = useState<SortState>(null);
  const toggle = useCallback((key: string) => {
    setSort((s) => (s?.key === key ? (s.dir === "desc" ? { key, dir: "asc" } : null) : { key, dir: "desc" }));
  }, []);
  const apply = useCallback(
    (rows: T[], accessors: Record<string, (r: T) => unknown>) => {
      if (!sort) return rows;
      const acc = accessors[sort.key];
      if (!acc) return rows;
      const dir = sort.dir === "asc" ? 1 : -1;
      return [...rows].sort((a, b) => sortCmp(acc(a), acc(b)) * dir);
    },
    [sort]
  );
  return { sort, toggle, apply, setSort };
}

export function SortTh({
  label,
  k,
  sort,
  onToggle,
  className,
}: {
  label: React.ReactNode;
  k: string;
  sort: SortState;
  onToggle: (key: string) => void;
  className?: string;
}) {
  const active = sort?.key === k;
  return (
    <th className={cn("cursor-pointer select-none hover:text-brand-700", className)} onClick={() => onToggle(k)}>
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        {label}
        {active ? (
          sort!.dir === "desc" ? <ArrowDown size={12} className="text-brand-700 shrink-0" /> : <ArrowUp size={12} className="text-brand-700 shrink-0" />
        ) : (
          <ArrowUpDown size={12} className="opacity-30 shrink-0" />
        )}
      </span>
    </th>
  );
}

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
  delta,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "brand" | "green" | "red" | "amber" | "slate";
  delta?: React.ReactNode;
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
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-900">{value}</span>
        {delta}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

// % change vs a comparison period. `invert` = a drop is good news
// (e.g. cancellation rate). `fmtPrev` renders the previous value in
// the tooltip/subtitle line.
export function DeltaBadge({
  current,
  previous,
  invert = false,
  fmtPrev,
}: {
  current: number;
  previous: number | null | undefined;
  invert?: boolean;
  fmtPrev?: (n: number) => string;
}) {
  const { t } = useLang();
  if (previous === null || previous === undefined) return null;
  let node: React.ReactNode;
  let tone: "good" | "bad" | "flat";
  if (previous === 0) {
    if (current === 0) {
      tone = "flat";
      node = "0%";
    } else {
      tone = invert ? "bad" : "good";
      node = t("newLbl");
    }
  } else {
    const pct = ((current - previous) / Math.abs(previous)) * 100;
    const up = pct > 0.05;
    const down = pct < -0.05;
    tone = !up && !down ? "flat" : (up && !invert) || (down && invert) ? "good" : "bad";
    node = `${up ? "▲" : down ? "▼" : ""} ${Math.abs(pct) >= 1000 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)}%`;
  }
  return (
    <span
      dir="ltr"
      title={fmtPrev ? `${t("vsLbl")} ${fmtPrev(previous)}` : undefined}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold",
        tone === "good" ? "bg-emerald-100 text-emerald-700" : tone === "bad" ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-500"
      )}
    >
      {node}
    </span>
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

// ---- Numbered pagination -------------------------------------------
// Windowed page buttons (1 … 5 6 [7] 8 9 … 40) with previous/next and
// a jump-to-page box. `page` is 0-based; clamps everything it emits.
export function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  const { t } = useLang();
  const [jump, setJump] = useState("");

  const current = page + 1;
  const wanted = new Set<number>([1, totalPages]);
  for (let i = current - 2; i <= current + 2; i++) {
    if (i >= 1 && i <= totalPages) wanted.add(i);
  }
  const sorted = Array.from(wanted).sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  let prev = 0;
  for (const n of sorted) {
    if (n - prev === 2) items.push(n - 1);
    else if (n - prev > 2) items.push("gap");
    items.push(n);
    prev = n;
  }

  function go(p: number) {
    const clamped = Math.min(Math.max(p, 1), totalPages);
    if (clamped !== current) onPage(clamped - 1);
  }

  function commitJump() {
    const n = parseInt(jump, 10);
    if (!isNaN(n)) go(n);
    setJump("");
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button className="btn-secondary !px-2.5 !py-1.5 text-xs" disabled={current <= 1} onClick={() => go(current - 1)}>
        {t("previous")}
      </button>
      {items.map((it, i) =>
        it === "gap" ? (
          <span key={`g${i}`} className="px-1 text-slate-400 select-none">
            …
          </span>
        ) : (
          <button
            key={it}
            onClick={() => go(it)}
            className={cn(
              "min-w-[2.1rem] rounded-lg px-2 py-1.5 text-xs font-semibold transition",
              it === current
                ? "bg-brand-700 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:border-brand-400 hover:text-brand-700"
            )}
          >
            {it}
          </button>
        )
      )}
      <button className="btn-secondary !px-2.5 !py-1.5 text-xs" disabled={current >= totalPages} onClick={() => go(current + 1)}>
        {t("next")}
      </button>
      <input
        type="number"
        min={1}
        max={totalPages}
        value={jump}
        onChange={(e) => setJump(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitJump();
        }}
        onBlur={() => jump && commitJump()}
        placeholder={t("pageNumber")}
        className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:border-brand-400 focus:outline-none"
        dir="ltr"
      />
    </div>
  );
}
