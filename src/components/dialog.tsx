"use client";

// Styled replacement for window.confirm / window.alert.
//
//   const ok = await confirmDialog("Delete this list?");
//   await notifyDialog("Saved.", { tone: "success" });
//
// <DialogHost /> is mounted once in the app shell; the two functions talk to it
// through a module-level setter, so any component (or plain function) can call
// them without threading a hook through.

import { useEffect, useState, useCallback, useRef } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Tone = "info" | "danger" | "success" | "warning";

export type DialogOptions = {
  title?: string;
  /** Label of the confirming button. Defaults to OK / تأكيد. */
  okLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
};

type Pending = {
  kind: "confirm" | "notify";
  message: string;
  opts: DialogOptions;
  resolve: (v: boolean) => void;
};

let enqueue: ((p: Pending) => void) | null = null;
const queue: Pending[] = [];

function push(p: Pending) {
  if (enqueue) enqueue(p);
  else queue.push(p); // host not mounted yet — flushed on mount
}

export function confirmDialog(message: string, opts: DialogOptions = {}): Promise<boolean> {
  return new Promise((resolve) => push({ kind: "confirm", message, opts, resolve }));
}

export function notifyDialog(message: string, opts: DialogOptions = {}): Promise<void> {
  return new Promise((resolve) => push({ kind: "notify", message, opts, resolve: () => resolve() }));
}

const ICON: Record<Tone, { Icon: typeof Info; ring: string; fg: string; btn: string }> = {
  info: { Icon: Info, ring: "bg-brand-50", fg: "text-brand-600", btn: "bg-brand-600 hover:bg-brand-700 focus-visible:ring-brand-500" },
  danger: { Icon: XCircle, ring: "bg-red-50", fg: "text-red-600", btn: "bg-red-600 hover:bg-red-700 focus-visible:ring-red-500" },
  warning: { Icon: AlertTriangle, ring: "bg-amber-50", fg: "text-amber-600", btn: "bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-500" },
  success: { Icon: CheckCircle2, ring: "bg-emerald-50", fg: "text-emerald-600", btn: "bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500" },
};

export function DialogHost() {
  const { t } = useLang();
  const [items, setItems] = useState<Pending[]>([]);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    enqueue = (p) => setItems((prev) => [...prev, p]);
    if (queue.length) {
      const pending = queue.splice(0);
      setItems((prev) => [...prev, ...pending]);
    }
    return () => {
      enqueue = null;
    };
  }, []);

  const current = items[0];

  const close = useCallback(
    (result: boolean) => {
      if (!current) return;
      current.resolve(result);
      setItems((prev) => prev.slice(1));
    },
    [current]
  );

  // focus the primary button so Enter confirms, Esc cancels — like the native box
  useEffect(() => {
    if (!current) return;
    okRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close(current!.kind === "notify");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, close]);

  if (!current) return null;

  const tone: Tone = current.opts.tone ?? (current.kind === "confirm" ? "warning" : "info");
  const { Icon, ring, fg, btn } = ICON[tone];
  const title =
    current.opts.title ?? (current.kind === "confirm" ? t("dlgConfirmTitle") : t("dlgNoticeTitle"));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nm-dialog-title"
    >
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] nm-dlg-backdrop"
        onClick={() => close(current.kind === "notify")}
      />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-900/5 nm-dlg-panel">
        <div className="flex items-start gap-4">
          <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", ring)}>
            <Icon size={22} className={fg} />
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <h2 id="nm-dialog-title" className="text-base font-bold text-slate-900">
              {title}
            </h2>
            <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-600">{current.message}</p>
          </div>
        </div>
        <div className="mt-6 flex flex-row-reverse gap-2">
          <button
            ref={okRef}
            onClick={() => close(true)}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
              btn
            )}
          >
            {current.opts.okLabel ?? t("dlgOk")}
          </button>
          {current.kind === "confirm" && (
            <button
              onClick={() => close(false)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
            >
              {current.opts.cancelLabel ?? t("cancel")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
