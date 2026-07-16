"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

/**
 * Filter dropdown with multi-select. Empty selection means "all"
 * (same semantics as the old `<option value="">All…</option>`).
 */
export function MultiSelect({
  options,
  values,
  onChange,
  placeholder,
  className,
  getLabel,
}: {
  options: string[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  className?: string;
  getLabel?: (value: string) => string;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      searchRef.current?.focus();
    }
  }, [open]);

  const label = getLabel ?? ((v: string) => v);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => label(o).toLowerCase().includes(q));
  }, [options, query, label]);

  function toggleValue(v: string) {
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  }

  const summary =
    values.length === 0 ? (
      <span className="text-slate-500">{placeholder}</span>
    ) : values.length === 1 ? (
      <span className="truncate">{label(values[0])}</span>
    ) : (
      <span className="truncate">
        {label(values[0])}
        <span className="ms-1 rounded-full bg-brand-100 px-1.5 py-px text-[11px] font-bold text-brand-700">
          +{values.length - 1}
        </span>
      </span>
    );

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "input flex items-center justify-between gap-2 text-start",
          values.length > 0 && "!border-brand-400"
        )}
      >
        <span className="flex min-w-0 items-center truncate">{summary}</span>
        <span className="flex shrink-0 items-center gap-1">
          {values.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange([]);
                }
              }}
            >
              <X size={13} />
            </span>
          )}
          <ChevronDown size={15} className={cn("text-slate-400 transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div className="absolute start-0 z-30 mt-1 w-full min-w-[220px] rounded-xl border border-slate-200 bg-white shadow-lg">
          {options.length > 7 && (
            <div className="border-b border-slate-100 p-2">
              <input
                ref={searchRef}
                className="input !py-1.5 text-xs"
                placeholder={t("search")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 text-[11px] font-semibold">
            <button
              type="button"
              className="text-brand-600 hover:text-brand-700"
              onClick={() => onChange(filtered.length === options.length ? [...options] : Array.from(new Set([...values, ...filtered])))}
            >
              {t("selectAll")}
            </button>
            <span className="text-slate-400">
              {values.length > 0 ? `${values.length} ${t("selectedLbl")}` : placeholder}
            </span>
            <button
              type="button"
              className="text-slate-500 hover:text-slate-700 disabled:opacity-40"
              disabled={values.length === 0}
              onClick={() => onChange([])}
            >
              {t("clearSelection")}
            </button>
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-400">{t("noResults")}</div>
            ) : (
              filtered.map((o) => {
                const checked = values.includes(o);
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() => toggleValue(o)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-sm transition hover:bg-slate-50",
                      checked ? "font-semibold text-brand-700" : "text-slate-700"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition",
                        checked ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white"
                      )}
                    >
                      {checked && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="truncate">{label(o)}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
