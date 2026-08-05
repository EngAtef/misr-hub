"use client";

import { useCallback, useRef, useState } from "react";
import { UploadCloud, X, AlertTriangle, Check, Trash2 } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { adText } from "@/lib/ads/strings";
import { parseAdsFile, type ParsedAdReport } from "@/lib/import/parse-ads";
import { formatMoney, formatNumber, cn } from "@/lib/utils";
import type { AdPeriod } from "@/lib/ads/types";

interface Staged extends ParsedAdReport {
  key: string;
  error?: string;
}

/**
 * Multi-file import. Everything is parsed and shown BEFORE anything is written,
 * because the account label and the reporting period decide which stored period
 * gets replaced — getting either wrong silently overwrites the wrong month.
 */
export function AdsImportDialog({
  open,
  onClose,
  onDone,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  existing: AdPeriod[];
}) {
  const { lang } = useLang();
  const x = adText(lang);
  const fileRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const next: Staged[] = [];
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      try {
        const report = parseAdsFile(await file.arrayBuffer(), file.name);
        next.push({ ...report, key });
      } catch (e) {
        next.push({
          key,
          account: file.name,
          fileName: file.name,
          periodStart: null,
          periodEnd: null,
          rows: [],
          levels: { campaign: 0, adset: 0, ad: 0 },
          spend: 0,
          purchases: 0,
          conversionValue: 0,
          warnings: [],
          error: e instanceof Error ? e.message : "parse error",
        });
      }
    }
    setStaged((prev) => [...prev.filter((p) => !next.some((n) => n.key === p.key)), ...next]);
  }, []);

  function patch(key: string, changes: Partial<Staged>) {
    setStaged((prev) => prev.map((s) => (s.key === key ? { ...s, ...changes } : s)));
  }

  const ready = staged.filter((s) => !s.error && s.rows.length && s.periodStart && s.periodEnd && s.account.trim());

  async function run() {
    setBusy(true);
    setError(null);
    try {
      for (const s of ready) {
        const res = await fetch("/api/ads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "import",
            account: s.account.trim(),
            periodStart: s.periodStart,
            periodEnd: s.periodEnd,
            fileName: s.fileName,
            rows: s.rows,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(`${s.fileName}: ${j.error ?? res.status}`);
        }
      }
      setStaged([]);
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "import failed");
    }
    setBusy(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="card my-8 w-full max-w-4xl p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{x("dialogTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">{x("dialogHint")}</p>
          </div>
          <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={onClose} aria-label={x("cancel")}>
            <X size={18} />
          </button>
        </div>

        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-8 text-center transition hover:border-brand-400 hover:bg-slate-50"
        >
          <UploadCloud className="h-9 w-9 text-brand-500" />
          <div className="text-sm font-semibold text-slate-700">{x("chooseFiles")}</div>
          <div className="text-xs text-slate-500">.xlsx · Meta Ads Manager export</div>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />

        {staged.length > 0 && (
          <div className="mt-5 space-y-3">
            {staged.map((s) => {
              const clash = existing.find(
                (p) =>
                  p.account_label.toLowerCase() === s.account.trim().toLowerCase() &&
                  p.period_start === s.periodStart &&
                  p.period_end === s.periodEnd
              );
              return (
                <div key={s.key} className={cn("rounded-xl border p-4", s.error ? "border-red-200 bg-red-50" : "border-slate-200")}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="truncate text-sm font-semibold text-slate-700" dir="ltr">
                      {s.fileName}
                    </div>
                    <button
                      className="rounded p-1 text-slate-400 hover:bg-slate-100"
                      onClick={() => setStaged((prev) => prev.filter((p) => p.key !== s.key))}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  {s.error ? (
                    <div className="text-sm text-red-700">
                      {x("parseFailed")} — {s.error}
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="block">
                          <span className="mb-1 block text-xs font-semibold text-slate-500">{x("accountName")}</span>
                          <input
                            className="input !py-1.5 text-sm"
                            value={s.account}
                            onChange={(e) => patch(s.key, { account: e.target.value })}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-semibold text-slate-500">{x("from")}</span>
                          <input
                            type="date"
                            dir="ltr"
                            className="input !py-1.5 text-sm"
                            value={s.periodStart ?? ""}
                            onChange={(e) => patch(s.key, { periodStart: e.target.value || null })}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-semibold text-slate-500">{x("to")}</span>
                          <input
                            type="date"
                            dir="ltr"
                            className="input !py-1.5 text-sm"
                            value={s.periodEnd ?? ""}
                            onChange={(e) => patch(s.key, { periodEnd: e.target.value || null })}
                          />
                        </label>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
                        <span>
                          {x("levelsFound")}:{" "}
                          <b className="text-slate-800">
                            {formatNumber(s.levels.ad)} {x("ads")}
                          </b>{" "}
                          · {formatNumber(s.levels.adset)} {x("adset")} · {formatNumber(s.levels.campaign)} {x("campaign")}
                        </span>
                        <span>
                          {x("spend")}: <b className="text-slate-800">{formatMoney(s.spend, lang)}</b>
                        </span>
                        <span>
                          {x("metaPurchases")}: <b className="text-slate-800">{formatNumber(s.purchases)}</b>
                        </span>
                      </div>

                      {s.warnings.map((w, i) => (
                        <div key={i} className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                          {w}
                        </div>
                      ))}
                      {clash && (
                        <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                          {x("replaceWarning")}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            {x("cancel")}
          </button>
          <button className="btn-primary" onClick={run} disabled={busy || !ready.length}>
            <Check size={16} />
            {busy ? x("importing") : `${x("confirmImport")} (${ready.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
