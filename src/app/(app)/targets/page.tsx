"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Target, TrendingUp, Users, MousePointerClick, Wallet, Plus, X, UploadCloud } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";
import { formatMoney, formatNumber, cn } from "@/lib/utils";
import { parseTargetsFile } from "@/lib/import/parse-targets";

interface TargetRow {
  period_month: string;
  quarter: string | null;
  label: string | null;
  total_target: number;
  kids_target: number;
  cultural_target: number;
  actual_revenue: number;
  actual_orders: number;
  progress_pct: number;
  aov: number;
  conv_rate: number;
}

function monthName(iso: string, lang: "ar" | "en") {
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { month: "long", year: "numeric" });
}

export default function TargetsPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TargetRow | null>(null);
  const [editing, setEditing] = useState<TargetRow | null | "new">(null);

  const load = useCallback(() => {
    supabase.rpc("fn_targets_overview").then(({ data }) => {
      const list = (data as TargetRow[]) ?? [];
      setRows(list);
      // default-select the current month if present, else the last one with actuals
      const now = new Date();
      const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const cur = list.find((r) => r.period_month.startsWith(curKey));
      setSelected((prev) => prev ?? cur ?? list.find((r) => r.actual_revenue > 0) ?? list[0] ?? null);
      setLoading(false);
    });
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const annual = useMemo(() => {
    const target = rows.reduce((s, r) => s + r.total_target, 0);
    const actual = rows.reduce((s, r) => s + r.actual_revenue, 0);
    return { target, actual, pct: target > 0 ? (actual / target) * 100 : 0 };
  }, [rows]);

  if (loading) return <div><PageHeader title={t("targets")} /><Spinner /></div>;

  const addButton = (
    <div className="flex gap-2">
      <button className="btn-primary" onClick={() => setEditing("new")}>
        <Plus size={16} />
        {t("addTarget")}
      </button>
      <UploadTargetsButton onDone={load} />
    </div>
  );

  if (!rows.length)
    return (
      <div>
        <PageHeader title={t("targets")} actions={addButton} />
        <EmptyState message={t("noData")} />
        {editing && <TargetModal target={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      </div>
    );

  return (
    <div>
      <PageHeader title={t("targets")} subtitle={t("targetsSubtitle")} actions={addButton} />

      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-slate-700">{t("targetYear")} (Jul 2025 – Jun 2026)</h3>
          <span className={cn("text-sm font-bold", annual.pct >= 70 ? "text-emerald-600" : annual.pct >= 40 ? "text-amber-600" : "text-red-600")}>
            {annual.pct.toFixed(1)}%
          </span>
        </div>
        <ProgressBar pct={annual.pct} />
        <div className="mt-2 flex justify-between text-sm text-slate-600">
          <span>{t("achieved")}: <b>{formatMoney(annual.actual, lang)}</b></span>
          <span>{t("monthlyTarget")}: <b>{formatMoney(annual.target, lang)}</b></span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 mb-8">
        {rows.map((r) => {
          const status = r.progress_pct >= 70 ? "onTrack" : r.progress_pct >= 40 ? "behind" : "behind";
          return (
            <div
              key={r.period_month}
              className={cn("card p-4 cursor-pointer transition hover:shadow-md", selected?.period_month === r.period_month && "ring-2 ring-brand-400")}
              onClick={() => setSelected(r)}
              onDoubleClick={() => setEditing(r)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold">{monthName(r.period_month, lang)}</div>
                  <div className="text-[11px] text-slate-400">{r.quarter} · {r.label}</div>
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold",
                  r.progress_pct >= 70 ? "bg-emerald-100 text-emerald-700" : r.progress_pct >= 40 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700")}>
                  {r.progress_pct}%
                </span>
              </div>
              <div className="mt-3"><ProgressBar pct={r.progress_pct} /></div>
              <div className="mt-2 flex justify-between text-xs text-slate-600">
                <span>{formatMoney(r.actual_revenue, lang)}</span>
                <span className="text-slate-400">/ {formatMoney(r.total_target, lang)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {selected && <StepsToAchieve row={selected} />}
      {editing && (
        <TargetModal
          target={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function TargetModal({ target, onClose, onSaved }: { target: TargetRow | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [form, setForm] = useState({
    month: target ? target.period_month.slice(0, 7) : new Date().toISOString().slice(0, 7),
    total: target?.total_target?.toString() ?? "",
    kids: target?.kids_target?.toString() ?? "",
    cultural: target?.cultural_target?.toString() ?? "",
    aov: target?.aov?.toString() ?? "550",
    conv: target ? String((target.conv_rate ?? 0.015) * 100) : "1.5",
    label: target?.label ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const month = `${form.month}-01`;
    const m = parseInt(form.month.slice(5, 7), 10);
    const quarter = `Q${Math.floor(((m + 5) % 12) / 3) + 1}`; // fiscal year starts July
    const { error: err } = await supabase.from("targets").upsert(
      {
        period_month: month,
        quarter,
        label: form.label || null,
        total_target: Number(form.total) || 0,
        kids_target: Number(form.kids) || 0,
        cultural_target: Number(form.cultural) || 0,
        aov: Number(form.aov) || 550,
        conv_rate: (Number(form.conv) || 1.5) / 100,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "period_month" }
    );
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full max-w-md card p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{t("addTarget")}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">{t("targetMonth")}</label>
          <input type="month" className="input" required value={form.month} onChange={(e) => set("month", e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">{t("totalTargetLabel")}</label>
          <input type="number" min={0} className="input" dir="ltr" required value={form.total} onChange={(e) => set("total", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-1">{t("kidsTargetLabel")}</label>
            <input type="number" min={0} className="input" dir="ltr" value={form.kids} onChange={(e) => set("kids", e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">{t("culturalTargetLabel")}</label>
            <input type="number" min={0} className="input" dir="ltr" value={form.cultural} onChange={(e) => set("cultural", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-1">{t("aovLabel")}</label>
            <input type="number" min={1} className="input" dir="ltr" value={form.aov} onChange={(e) => set("aov", e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">{t("convLabel")}</label>
            <input type="number" min={0.1} step={0.1} className="input" dir="ltr" value={form.conv} onChange={(e) => set("conv", e.target.value)} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">{t("noteLabel")}</label>
          <input className="input" placeholder={t("targetsUploadHint").split("—")[0]} value={form.label} onChange={(e) => set("label", e.target.value)} />
        </div>
        {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={saving}>
          {t("save")}
        </button>
      </form>
    </div>
  );
}

function UploadTargetsButton({ onDone }: { onDone: () => void }) {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function handleFile(file: File) {
    setBusy(true);
    setMsg("");
    try {
      const rows = parseTargetsFile(await file.arrayBuffer());
      if (!rows.length) {
        setMsg(t("invalidFile"));
        setBusy(false);
        return;
      }
      const { error } = await supabase.from("targets").upsert(
        rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
        { onConflict: "period_month" }
      );
      if (error) {
        setMsg(error.message);
      } else {
        setMsg(`✅ ${rows.length} ${t("targetsImported")}`);
        onDone();
      }
    } catch {
      setMsg(t("invalidFile"));
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="flex items-center gap-2">
      <button className="btn-secondary" disabled={busy} onClick={() => fileRef.current?.click()} title={t("targetsUploadHint")}>
        <UploadCloud size={16} />
        {t("uploadTargets")}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      {msg && <span className="text-xs font-semibold text-slate-600">{msg}</span>}
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.min(pct, 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function StepsToAchieve({ row }: { row: TargetRow }) {
  const { t, lang } = useLang();

  const now = new Date();
  const monthStart = new Date(row.period_month);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const daysInMonth = monthEnd.getDate();
  const isCurrent = now.getFullYear() === monthStart.getFullYear() && now.getMonth() === monthStart.getMonth();
  const isPast = monthEnd < now;
  const daysRemaining = isCurrent ? Math.max(daysInMonth - now.getDate(), 1) : isPast ? 0 : daysInMonth;

  const remaining = Math.max(row.total_target - row.actual_revenue, 0);
  const aov = row.aov || 550;
  const neededOrders = Math.ceil(remaining / aov);
  const neededDaily = daysRemaining > 0 ? Math.ceil(neededOrders / daysRemaining) : neededOrders;
  const requiredTraffic = Math.ceil(neededOrders / (row.conv_rate || 0.015));
  // implied ad budget assuming a conservative 3x ROAS on the paid-driven share (~50% of remaining)
  const impliedBudget = Math.round((remaining * 0.5) / 3);

  const steps: { icon: React.ElementType; label: string; value: string; hint: string }[] = [
    {
      icon: Target,
      label: t("remainingToTarget"),
      value: formatMoney(remaining, lang),
      hint: `${row.progress_pct}% ${t("achieved")}`,
    },
    {
      icon: Users,
      label: t("neededOrders"),
      value: formatNumber(neededOrders),
      hint: `${t("avgOrderValue")}: ${formatMoney(aov, lang)}`,
    },
    {
      icon: TrendingUp,
      label: t("neededDaily"),
      value: `${formatNumber(neededDaily)} ${t("ordersLabel")}`,
      hint: daysRemaining > 0 ? `${daysRemaining} ${t("days")}` : t("completed"),
    },
    {
      icon: MousePointerClick,
      label: t("requiredTraffic"),
      value: formatNumber(requiredTraffic),
      hint: `${((row.conv_rate || 0.015) * 100).toFixed(1)}% ${t("actualCr")}`,
    },
    {
      icon: Wallet,
      label: t("impliedBudget"),
      value: formatMoney(impliedBudget, lang),
      hint: "ROAS 3x",
    },
  ];

  return (
    <div>
      <h2 className="mb-3 text-lg font-bold">{t("stepsToAchieve")} — {monthName(row.period_month, lang)}</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={i} className="card p-4">
              <div className="flex items-center gap-2 text-brand-600">
                <Icon size={18} />
                <span className="text-xs font-semibold text-slate-500">{s.label}</span>
              </div>
              <div className="mt-2 text-xl font-bold">{s.value}</div>
              <div className="text-xs text-slate-400 mt-0.5">{s.hint}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
