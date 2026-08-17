"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { History, Play, Pause, AlertTriangle, Check, Trash2, Clock } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { cn, formatNumber, formatMoney } from "@/lib/utils";
import { confirmDialog } from "@/components/dialog";

interface Progress {
  total: number;
  done: number;
  pending: number;
  running: number;
  error: number;
  skipped: number;
  stalled: number;
  spend: number;
  oldest: string | null;
  newest: string | null;
  errors: { account: string; period: string; error: string }[];
}

interface StepResult {
  processed: number;
  done: number;
  failed: number;
  empty: number;
  rows: number;
  spend: number;
  rateLimited: boolean;
  ranOutOfTime: boolean;
  items: { account: string; period: string; status: string; rows?: number; spend?: number; error?: string }[];
}

const T = {
  title: { ar: "سحب التاريخ الكامل من ميتا", en: "Pull full history from Meta" },
  intro: {
    ar: "ميتا بتحتفظ بآخر ٣٧ شهر بس — أقدم من كده مش موجود عندها أصلاً. السحب بيتم شهر × حساب، وبيقف لوحده لو ميتا طلبت نهدّى، وبيكمّل من مكانه لما ترجع.",
    en: "Meta only keeps the last 37 months — anything older simply isn't there to pull. The backfill runs one account-month at a time, pauses itself if Meta asks it to slow down, and resumes exactly where it stopped.",
  },
  start: { ar: "ابدأ السحب", en: "Start backfill" },
  resume: { ar: "كمّل السحب", en: "Resume backfill" },
  running: { ar: "شغال...", en: "Running..." },
  stop: { ar: "وقف", en: "Stop" },
  monthsDone: { ar: "شهر تم", en: "months done" },
  empty: { ar: "شهور من غير إعلانات", en: "months with no ads" },
  failed: { ar: "فشل", en: "failed" },
  left: { ar: "متبقي", en: "left" },
  spendPulled: { ar: "إنفاق تم سحبه", en: "spend pulled" },
  finished: { ar: "خلص ✓ كل التاريخ المتاح موجود دلوقتي", en: "Finished ✓ — every month Meta still serves is now in" },
  paused: {
    ar: "ميتا طلبت نهدّى شوية — السحب اتوقف لوحده. استنى ١٥ دقيقة واضغط «كمّل».",
    en: "Meta asked us to slow down — the backfill paused itself. Wait ~15 minutes and press Resume.",
  },
  nothingQueued: { ar: "مفيش حاجة في الطابور", en: "Nothing queued yet" },
  // manual uploads
  purgeTitle: { ar: "شيل الملفات المرفوعة يدوي", en: "Remove hand-uploaded files" },
  purgeIntro: {
    ar: "بيمسح كل استيراد جه من ملف Excel، ويسيب اللي اتسحب من الـ API بس. الربط بين الإعلانات والكتب مش بيتأثر — هو متخزن باسم الإعلان مش بالاستيراد.",
    en: "Deletes every import that came from an Excel file, leaving only what the API pulled. Ad-to-book connections are unaffected — they're keyed on ad names, not on the import.",
  },
  purgeCheck: { ar: "اعرض اللي هيتمسح", en: "Show what would be removed" },
  purgeDo: { ar: "امسحهم", en: "Remove them" },
  purgeNone: { ar: "مفيش ملفات مرفوعة يدوي — كل البيانات من الـ API ✓", en: "No hand-uploaded files left — everything is from the API ✓" },
  purgeDone: { ar: "اتمسحوا", en: "removed" },
  purgeWarn: {
    ar: "متأكد؟ اتأكد الأول إن نفس الشهور اتسحبت من الـ API، وإلا هتفضى بيانات.",
    en: "Are you sure? Check the same months exist from the API first, or you'll empty out data.",
  },
};

/**
 * Drives the ad_sync_jobs queue from the browser.
 *
 * The loop lives here rather than on the server because Vercel caps a function
 * at 60 seconds and the full history is 100+ account-months. Each request
 * drains what it can and reports back; the state that matters is in the
 * database, so closing this tab pauses the run instead of losing it — and the
 * twice-daily cron picks up anything left behind.
 */
export function AdsBackfill({ onChanged }: { onChanged: () => void }) {
  const { lang } = useLang();
  const tx = useCallback((v: { ar: string; en: string }) => v[lang], [lang]);

  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [last, setLast] = useState<StepResult | null>(null);
  const [purge, setPurge] = useState<{ imports: { account: string; from: string; file: string; spend: number }[] } | null>(null);
  const stop = useRef(false);

  const post = useCallback(async (body: object) => {
    const res = await fetch("/api/meta-ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
  }, []);

  const refresh = useCallback(async () => {
    const r = await post({ action: "backfill_progress" });
    if (r.ok) setProgress(r.json.progress as Progress);
  }, [post]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run() {
    stop.current = false;
    setRunning(true);
    setNote(null);
    try {
      // plan first — it's idempotent, so pressing Resume just tops the queue up
      const plan = await post({ action: "backfill_plan" });
      if (!plan.ok) {
        setNote({ kind: "err", text: [plan.json.error, plan.json.hint].filter(Boolean).join(" — ") });
        setRunning(false);
        return;
      }

      for (let guard = 0; guard < 200 && !stop.current; guard++) {
        const step = await post({ action: "backfill_step" });
        if (step.status === 429) {
          setNote({ kind: "warn", text: tx(T.paused) });
          break;
        }
        if (!step.ok) {
          setNote({ kind: "err", text: [step.json.error, step.json.hint].filter(Boolean).join(" — ") });
          break;
        }
        const result = step.json.result as StepResult;
        setLast(result);
        setProgress(step.json.progress as Progress);
        if (result.rateLimited) {
          setNote({ kind: "warn", text: tx(T.paused) });
          break;
        }
        if (result.processed === 0) {
          setNote({ kind: "ok", text: tx(T.finished) });
          break;
        }
      }
      await refresh();
      onChanged();
    } catch (e) {
      setNote({ kind: "err", text: e instanceof Error ? e.message : "backfill failed" });
    }
    setRunning(false);
  }

  async function checkPurge(dryRun: boolean) {
    if (!dryRun && !await confirmDialog(tx(T.purgeWarn))) return;
    const r = await post({ action: "purge_manual", dryRun });
    if (!r.ok) {
      setNote({ kind: "err", text: r.json.error ?? "failed" });
      return;
    }
    const imports = (r.json.imports ?? []) as { account: string; from: string; file: string; spend: number }[];
    setPurge({ imports });
    if (!dryRun) {
      setNote({ kind: "ok", text: `${imports.length} ${tx(T.purgeDone)}` });
      setPurge({ imports: [] });
      onChanged();
    }
  }

  const p = progress;
  const total = p?.total ?? 0;
  const settled = (p?.done ?? 0) + (p?.skipped ?? 0);
  const pct = total ? Math.round((settled / total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------- backfill */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-[260px] flex-1">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <History size={15} className="text-brand-600" />
              {tx(T.title)}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{tx(T.intro)}</p>
          </div>
          {running ? (
            <button className="btn-secondary" onClick={() => (stop.current = true)}>
              <Pause size={16} />
              {tx(T.stop)}
            </button>
          ) : (
            <button className="btn-primary" onClick={run}>
              <Play size={16} />
              {settled > 0 && (p?.pending ?? 0) > 0 ? tx(T.resume) : tx(T.start)}
            </button>
          )}
        </div>

        {total > 0 && (
          <>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn("h-full rounded-full transition-all", running ? "bg-brand-500" : "bg-emerald-500")}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
              <span className="font-bold text-slate-800">{pct}%</span>
              <span>
                {formatNumber(p?.done ?? 0)} {tx(T.monthsDone)}
              </span>
              {(p?.skipped ?? 0) > 0 && (
                <span className="text-slate-400">
                  {formatNumber(p!.skipped)} {tx(T.empty)}
                </span>
              )}
              <span>
                {formatNumber(p?.pending ?? 0)} {tx(T.left)}
              </span>
              {(p?.error ?? 0) > 0 && (
                <span className="font-semibold text-amber-600">
                  {formatNumber(p!.error)} {tx(T.failed)}
                </span>
              )}
              <span className="font-semibold text-slate-700">
                {formatMoney(p?.spend ?? 0, lang)} {tx(T.spendPulled)}
              </span>
              {p?.oldest && (
                <span className="text-slate-400" dir="ltr">
                  {p.oldest} → {p.newest}
                </span>
              )}
            </div>
          </>
        )}

        {running && last && (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <Clock size={13} className="animate-pulse" />
            {last.items.slice(-1).map((i) => (
              <span key={i.period} dir="ltr">
                {i.account} · {i.period}
              </span>
            ))}
          </div>
        )}

        {note && (
          <div
            className={cn(
              "mt-3 flex items-start gap-2 rounded-lg border px-4 py-2.5 text-xs",
              note.kind === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-800",
              note.kind === "warn" && "border-amber-200 bg-amber-50 text-amber-800",
              note.kind === "err" && "border-red-200 bg-red-50 text-red-800"
            )}
          >
            {note.kind === "ok" ? <Check size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
            {note.text}
          </div>
        )}

        {(p?.errors?.length ?? 0) > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            {p!.errors.map((e, i) => (
              <div key={i} dir="ltr" className="truncate">
                {e.account} {e.period}: {e.error}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ purge */}
      <div className="card p-5">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <Trash2 size={15} className="text-red-500" />
          {tx(T.purgeTitle)}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{tx(T.purgeIntro)}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn-secondary !py-1.5 text-xs" onClick={() => checkPurge(true)}>
            {tx(T.purgeCheck)}
          </button>
          {(purge?.imports.length ?? 0) > 0 && (
            <button className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700" onClick={() => checkPurge(false)}>
              <Trash2 size={14} />
              {tx(T.purgeDo)} ({purge!.imports.length})
            </button>
          )}
        </div>

        {purge && purge.imports.length === 0 && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
            {tx(T.purgeNone)}
          </div>
        )}

        {(purge?.imports.length ?? 0) > 0 && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            {purge!.imports.map((i, n) => (
              <div key={n} dir="ltr" className="truncate">
                {i.account} · {i.from} · {i.file} · {formatMoney(i.spend ?? 0, lang)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
