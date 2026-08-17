"use client";

// Segments Center — every audience the marketing team can talk to, in one
// place. Prebuilt cards, a custom builder ("bought list X in July but never
// bought Y"), saved definitions, CSV/number export, an SMS cost calculator
// that knows Arabic messages are 70 chars per part, and the opt-out list.
// Everything resolves through fn_segment_count / fn_segment_export so the
// number on screen is always the number that gets exported.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Crown, Heart, Sparkles, Sprout, AlertTriangle, Moon, UserX, Trophy, Gem,
  Cake, ShoppingBag, CalendarClock, Save, Download, Copy, Ban, Calculator,
  RefreshCw, Trash2, FolderOpen, Search, X, Filter, Users2, Phone, CheckCircle2,
  ShieldCheck, Send, History,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { PageHeader, Spinner } from "@/components/ui";
import { MultiSelect } from "@/components/multi-select";
import { CustomerDrawer } from "@/components/customer-drawer";
import { ContactActions } from "@/components/contact-actions";
import { formatMoney, formatNumber, formatDate, toCsv, downloadCsv, cn } from "@/lib/utils";
import { rpcAll } from "@/lib/rpc-all";
import { confirmDialog, notifyDialog } from "@/components/dialog";

const SMS_PRICE_EGP = 0.285;

// ------------------------------------------------------------ definitions

interface BoughtDef {
  kind: "sku" | "category" | "section" | "list";
  values: string[];
  from?: string;
  to?: string;
}

interface SegDef {
  base?: string;
  segments?: string[];
  cities?: string[];
  birth_month?: number;
  joined_from?: string;
  joined_to?: string;
  last_from?: string;
  last_to?: string;
  recency_min?: number;
  recency_max?: number;
  min_orders?: number;
  max_orders?: number;
  min_spent?: number;
  max_spent?: number;
  last_status?: string;
  history?: string;
  no_sms_days?: number;
  active_in?: { from?: string; to?: string };
  bought?: BoughtDef;
  not_bought?: BoughtDef;
}

interface SegCount {
  people: number;
  with_phone: number;
  reachable: number;
  opted_out: number;
  recently_sent: number;
  exportable: number;
}

interface CampaignRow {
  campaign: string;
  sent_on: string;
  recipients: number;
  segment_name: string | null;
}

// the frequency cap is a page-level setting layered onto every definition
// (cards, builder, saved) right before it hits the engine — one knob, not
// something to remember per segment
function withCap(def: SegDef, capDays: number): SegDef {
  if (!capDays) return def;
  return { ...def, no_sms_days: capDays };
}

interface ExportRow {
  master_id: string;
  name: string | null;
  phone: string | null;
  city: string | null;
  segment: string | null;
  orders: number;
  total_spent: number;
  last_order_at: string | null;
}

interface SavedSegment {
  id: string;
  name: string;
  note: string | null;
  definition: SegDef;
  last_people: number | null;
  last_reachable: number | null;
  counted_at: string | null;
}

interface Options {
  cities: string[];
  sections: string[];
  categories: string[];
  lists: { id: string; name: string; slug: string | null; items: number }[];
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------- prebuilt catalog

interface Prebuilt {
  key: string;
  labelKey: DictKey;
  icon: React.ElementType;
  color: string;
  group: DictKey;
  def: () => SegDef;
}

const PREBUILT: Prebuilt[] = [
  // Lifecycle (RFM)
  { key: "champions", labelKey: "segChampions", icon: Crown, color: "text-amber-600 bg-amber-50 border-amber-200", group: "segGroupLifecycle", def: () => ({ segments: ["champions"] }) },
  { key: "loyal", labelKey: "segLoyal", icon: Heart, color: "text-rose-600 bg-rose-50 border-rose-200", group: "segGroupLifecycle", def: () => ({ segments: ["loyal"] }) },
  { key: "new", labelKey: "segNew", icon: Sparkles, color: "text-brand-600 bg-brand-50 border-brand-200", group: "segGroupLifecycle", def: () => ({ segments: ["new"] }) },
  { key: "promising", labelKey: "segPromising", icon: Sprout, color: "text-emerald-600 bg-emerald-50 border-emerald-200", group: "segGroupLifecycle", def: () => ({ segments: ["promising"] }) },
  { key: "at_risk", labelKey: "segAtRisk", icon: AlertTriangle, color: "text-red-600 bg-red-50 border-red-200", group: "segGroupLifecycle", def: () => ({ segments: ["at_risk"] }) },
  { key: "hibernating", labelKey: "segHibernating", icon: Moon, color: "text-slate-500 bg-slate-50 border-slate-200", group: "segGroupLifecycle", def: () => ({ segments: ["hibernating"] }) },
  // Registered, never bought
  { key: "nb30", labelKey: "segNb30", icon: UserX, color: "text-sky-600 bg-sky-50 border-sky-200", group: "segGroupRegistration", def: () => ({ base: "never", joined_from: isoDaysAgo(30) }) },
  { key: "nb90", labelKey: "segNb90", icon: UserX, color: "text-sky-600 bg-sky-50 border-sky-200", group: "segGroupRegistration", def: () => ({ base: "never", joined_from: isoDaysAgo(90), joined_to: isoDaysAgo(30) }) },
  { key: "nb365", labelKey: "segNb365", icon: UserX, color: "text-indigo-600 bg-indigo-50 border-indigo-200", group: "segGroupRegistration", def: () => ({ base: "never", joined_from: isoDaysAgo(365), joined_to: isoDaysAgo(90) }) },
  { key: "nbOld", labelKey: "segNbOld", icon: UserX, color: "text-slate-500 bg-slate-50 border-slate-200", group: "segGroupRegistration", def: () => ({ base: "never", joined_to: isoDaysAgo(365) }) },
  // Value tiers
  { key: "vip1k", labelKey: "segVip1k", icon: Trophy, color: "text-amber-600 bg-amber-50 border-amber-200", group: "segGroupValue", def: () => ({ min_spent: 1000 }) },
  { key: "vip2k", labelKey: "segVip2k", icon: Gem, color: "text-violet-600 bg-violet-50 border-violet-200", group: "segGroupValue", def: () => ({ min_spent: 2000 }) },
  { key: "hvOneTime", labelKey: "segHvOneTime", icon: ShoppingBag, color: "text-emerald-600 bg-emerald-50 border-emerald-200", group: "segGroupValue", def: () => ({ base: "one_time", min_spent: 800 }) },
  { key: "churnedRepeat", labelKey: "segChurnedRepeat", icon: CalendarClock, color: "text-red-600 bg-red-50 border-red-200", group: "segGroupValue", def: () => ({ min_orders: 2, recency_min: 180 }) },
  // Occasions & periods
  { key: "birthMonth", labelKey: "segBirthThisMonth", icon: Cake, color: "text-pink-600 bg-pink-50 border-pink-200", group: "segGroupOccasions", def: () => ({ birth_month: new Date().getMonth() + 1 }) },
  { key: "bought30", labelKey: "segBoughtLast30", icon: ShoppingBag, color: "text-brand-600 bg-brand-50 border-brand-200", group: "segGroupOccasions", def: () => ({ active_in: { from: isoDaysAgo(30) } }) },
  { key: "bought90", labelKey: "segBoughtLast90", icon: ShoppingBag, color: "text-teal-600 bg-teal-50 border-teal-200", group: "segGroupOccasions", def: () => ({ active_in: { from: isoDaysAgo(90) } }) },
];

const GROUP_ORDER: DictKey[] = ["segGroupLifecycle", "segGroupRegistration", "segGroupValue", "segGroupOccasions"];

// -------------------------------------------------------- SMS part maths

// The vendor bills per 70-character part, full stop — Arabic or Latin. So
// no encoding detection: 70 chars = 1 SMS, 71–140 = 2, and so on. Count in
// code points (Array.from) so an emoji is one character, not two.
const SMS_PART_CHARS = 70;

function smsParts(text: string): { chars: number; parts: number } {
  const chars = Array.from(text).length;
  if (!chars) return { chars: 0, parts: 0 };
  return { chars, parts: Math.ceil(chars / SMS_PART_CHARS) };
}

function normPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const last10 = digits.slice(-10);
  return /^1[0125]\d{8}$/.test(last10) ? last10 : null;
}

// ================================================================== page

export default function SegmentsPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);

  const [options, setOptions] = useState<Options>({ cities: [], sections: [], categories: [], lists: [] });
  const [totals, setTotals] = useState<SegCount | null>(null);
  const [cardCounts, setCardCounts] = useState<Record<string, SegCount>>({});
  const [saved, setSaved] = useState<SavedSegment[]>([]);
  const [optOutCount, setOptOutCount] = useState(0);

  // active preview
  const [activeLabel, setActiveLabel] = useState<string>("");
  const [activeDef, setActiveDef] = useState<SegDef | null>(null);
  const [activeCount, setActiveCount] = useState<SegCount | null>(null);
  const [sample, setSample] = useState<ExportRow[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [reachableOnly, setReachableOnly] = useState(true);
  const [excludeOptOuts, setExcludeOptOuts] = useState(true);
  const previewRef = useRef<HTMLDivElement>(null);

  const [builderDef, setBuilderDef] = useState<SegDef>({});
  const [reloadKey, setReloadKey] = useState(0);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  // frequency cap (days) — remembered per browser, default 14
  const [capDays, setCapDays] = useState<number>(14);
  useEffect(() => {
    const saved = Number(localStorage.getItem("nmSmsCapDays"));
    if (!Number.isNaN(saved) && localStorage.getItem("nmSmsCapDays") !== null) setCapDays(saved);
  }, []);
  function changeCap(days: number) {
    setCapDays(days);
    localStorage.setItem("nmSmsCapDays", String(days));
  }
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("fn_segment_options").then(({ data }) => {
      const o = data as Options | null;
      if (o && o.cities) setOptions(o);
    });
    supabase.rpc("fn_segment_count", { p_def: {} }).then(({ data }) => setTotals(data as SegCount));
    supabase
      .from("saved_segments")
      .select("id, name, note, definition, last_people, last_reachable, counted_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => setSaved((data as SavedSegment[]) ?? []));
    supabase
      .from("sms_opt_outs")
      .select("phone_norm", { count: "exact", head: true })
      .then(({ count }) => setOptOutCount(count ?? 0));
    supabase.rpc("fn_sms_campaigns", { p_limit: 30 }).then(({ data }) => setCampaigns((data as CampaignRow[]) ?? []));
  }, [supabase, reloadKey]);

  // count the prebuilt cards in small batches so we don't fire 17 RPCs at once.
  // Re-runs when the cap changes: the card numbers must be the numbers you'd export.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let i = 0; i < PREBUILT.length; i += 4) {
        const chunk = PREBUILT.slice(i, i + 4);
        const results = await Promise.all(
          chunk.map((p) => supabase.rpc("fn_segment_count", { p_def: withCap(p.def(), capDays) }))
        );
        if (cancelled) return;
        setCardCounts((prev) => {
          const next = { ...prev };
          chunk.forEach((p, j) => {
            const c = results[j].data as SegCount | null;
            if (c) next[p.key] = c;
          });
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, capDays, reloadKey]);

  // activeDef is the RAW definition; the cap is layered on at query time so
  // changing the cap re-evaluates the same segment without rebuilding it
  const openPreview = useCallback(
    async (label: string, def: SegDef, savedId: string | null = null) => {
      setActiveLabel(label);
      setActiveDef(def);
      setActiveSavedId(savedId);
      setPreviewLoading(true);
      setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      const capped = withCap(def, capDays);
      const [c, s] = await Promise.all([
        supabase.rpc("fn_segment_count", { p_def: capped }),
        supabase.rpc("fn_segment_export", {
          p_def: capped,
          p_reachable_only: reachableOnly,
          p_exclude_opt_outs: excludeOptOuts,
          p_limit: 50,
        }),
      ]);
      setActiveCount(c.data as SegCount);
      setSample((s.data as ExportRow[]) ?? []);
      setPreviewLoading(false);
    },
    [supabase, reachableOnly, excludeOptOuts, capDays]
  );

  // re-run the sample when the export toggles or the cap flip
  useEffect(() => {
    if (activeDef) void openPreview(activeLabel, activeDef, activeSavedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reachableOnly, excludeOptOuts, capDays]);

  async function fetchFull(): Promise<ExportRow[]> {
    if (!activeDef) return [];
    return rpcAll<ExportRow>(supabase, "fn_segment_export", {
      p_def: withCap(activeDef, capDays),
      p_reachable_only: reachableOnly,
      p_exclude_opt_outs: excludeOptOuts,
      p_limit: 100000,
    });
  }

  // log the send: everyone currently exportable under this (capped) definition
  const [marking, setMarking] = useState(false);
  const [markedN, setMarkedN] = useState(0);
  const [campaignName, setCampaignName] = useState("");
  async function markSent() {
    if (!activeDef || !activeCount) return;
    const n = activeCount.exportable;
    if (!await confirmDialog(t("segMarkSentConfirm").replace("{n}", formatNumber(n)))) return;
    setMarking(true);
    const { data, error } = await supabase.rpc("fn_sms_mark_sent", {
      p_def: withCap(activeDef, capDays),
      p_campaign: campaignName.trim() || activeLabel,
      p_segment_id: activeSavedId,
    });
    setMarking(false);
    if (error) {
      await notifyDialog(error.message);
      return;
    }
    setMarkedN(Number(data) || 0);
    setCampaignName("");
    setReloadKey((k) => k + 1);
    setTimeout(() => setMarkedN(0), 5000);
  }

  async function exportCsv() {
    const rows = await fetchFull();
    if (!rows.length) return;
    const slug = activeLabel.replace(/\s+/g, "-").toLowerCase();
    downloadCsv(`segment-${slug}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows as unknown as Record<string, unknown>[]));
  }

  const [copied, setCopied] = useState(0);
  async function copyNumbers() {
    const rows = await fetchFull();
    const phones = rows.map((r) => r.phone).filter(Boolean) as string[];
    if (!phones.length) return;
    await navigator.clipboard.writeText(phones.join("\n"));
    setCopied(phones.length);
    setTimeout(() => setCopied(0), 3000);
  }

  return (
    <div>
      <PageHeader title={t("segments")} subtitle={t("segmentsSubtitle")} />

      {/* headline */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi icon={Users2} color="border-s-brand-500" label={t("segTotalPeople")} value={totals ? formatNumber(totals.people) : "…"} />
        <Kpi icon={Phone} color="border-s-emerald-500" label={t("segReachable")} value={totals ? formatNumber(totals.reachable) : "…"} sub={totals ? `${((totals.reachable / Math.max(totals.people, 1)) * 100).toFixed(1)}%` : undefined} />
        <Kpi icon={Ban} color="border-s-red-500" label={t("segOptedOut")} value={formatNumber(optOutCount)} />
        <Kpi icon={CheckCircle2} color="border-s-violet-500" label={t("segExportable")} value={totals ? formatNumber(totals.exportable) : "…"} />
      </div>

      {/* frequency cap — one knob applied to every card, builder and saved segment */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="rounded-lg bg-white p-1.5 text-amber-600">
          <ShieldCheck size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-amber-900">{t("segFreqCap")}</div>
          <div className="text-xs text-amber-800">{t("segFreqCapHint")}</div>
        </div>
        <label className="flex items-center gap-2 text-sm text-amber-900">
          {t("segNoSms")}
          <select className="input !w-auto !py-1.5" value={capDays} onChange={(e) => changeCap(Number(e.target.value))}>
            <option value={0}>{t("segNoSmsAny")}</option>
            {[3, 7, 14, 21, 30, 45, 60, 90].map((d) => (
              <option key={d} value={d}>{d} {t("segDays")}</option>
            ))}
          </select>
        </label>
      </div>

      {/* prebuilt cards */}
      <div className="mb-2 flex items-start gap-3">
        <div className="rounded-lg bg-brand-50 p-2 text-brand-600">
          <Filter size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold">{t("segPrebuilt")}</h2>
          <p className="text-xs text-slate-500">{t("segPrebuiltHint")}</p>
        </div>
      </div>
      {GROUP_ORDER.map((group) => (
        <div key={group} className="mb-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-600">{t(group)}</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {PREBUILT.filter((p) => p.group === group).map((p) => {
              const Icon = p.icon;
              const c = cardCounts[p.key];
              return (
                <div
                  key={p.key}
                  className={cn(
                    "card cursor-pointer border p-4 transition hover:shadow-md",
                    activeLabel === t(p.labelKey) && "ring-2 ring-brand-400"
                  )}
                  onClick={() => openPreview(t(p.labelKey), p.def())}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className={cn("rounded-lg border p-1.5", p.color)}>
                      <Icon size={16} />
                    </div>
                    <div className="text-end">
                      <div className="text-xl font-bold">{c ? formatNumber(c.people) : "…"}</div>
                      {c && (
                        <div className="text-[11px] text-slate-400" dir="ltr">
                          📱 {formatNumber(c.exportable)}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 text-sm font-semibold leading-snug">{t(p.labelKey)}</div>
                  {c && c.exportable > 0 && (
                    <div className="mt-1 text-[11px] text-slate-500">
                      {t("segEstCost")}: <b>{formatMoney(c.exportable * SMS_PRICE_EGP, lang)}</b> {t("segPerMessage")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* builder */}
      <SegmentBuilder
        options={options}
        def={builderDef}
        onChange={setBuilderDef}
        onPreview={() => openPreview(t("segBuilder"), builderDef)}
        onSaved={() => setReloadKey((k) => k + 1)}
        activeCount={activeLabel === t("segBuilder") ? activeCount : null}
      />

      {/* saved segments */}
      <SavedSegments
        saved={saved}
        onLoad={(s) => {
          setBuilderDef(s.definition ?? {});
          void openPreview(s.name, s.definition ?? {}, s.id);
        }}
        capDays={capDays}
        onChanged={() => setReloadKey((k) => k + 1)}
      />

      {/* preview + export */}
      <div ref={previewRef}>
        {activeDef && (
          <div className="card mt-8 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold">
                {activeLabel}
                {activeCount && (
                  <span className="ms-2 text-sm font-normal text-slate-500">
                    {formatNumber(activeCount.people)} {t("segMatches")}
                  </span>
                )}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={reachableOnly} onChange={(e) => setReachableOnly(e.target.checked)} />
                  {t("segReachableOnly")}
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={excludeOptOuts} onChange={(e) => setExcludeOptOuts(e.target.checked)} />
                  {t("segExcludeOptOuts")}
                </label>
                <button className="btn-secondary !py-1.5 text-xs" onClick={copyNumbers} disabled={previewLoading}>
                  <Copy size={14} />
                  {copied ? t("segCopied").replace("{n}", formatNumber(copied)) : t("segCopyNumbers")}
                </button>
                <button className="btn-primary !py-1.5 text-xs" onClick={exportCsv} disabled={previewLoading}>
                  <Download size={14} />
                  {t("segExportCsv")}
                </button>
              </div>
            </div>

            {activeCount && (
              <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
                <MiniStat label={t("segPeopleCol")} value={formatNumber(activeCount.people)} />
                <MiniStat label={t("phone")} value={formatNumber(activeCount.with_phone)} />
                <MiniStat label={t("segReachableCol")} value={formatNumber(activeCount.reachable)} tone="text-emerald-700" />
                <MiniStat label={t("segOptedOut")} value={formatNumber(activeCount.opted_out)} tone="text-red-600" />
                <MiniStat label={t("segRecentlySent")} value={formatNumber(activeCount.recently_sent)} tone="text-amber-700" />
                <MiniStat label={t("segExportable")} value={formatNumber(activeCount.exportable)} tone="text-brand-700" />
              </div>
            )}

            {/* mark as sent — the write side of the frequency cap */}
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
              <Send size={15} className="text-emerald-700" />
              <span className="text-xs text-emerald-900">{t("segMarkSentHint")}</span>
              <div className="ms-auto flex items-center gap-2">
                <input
                  className="input !w-48 !py-1 text-xs"
                  placeholder={t("segCampaignName")}
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                />
                <button
                  className="btn-primary !py-1 text-xs"
                  onClick={markSent}
                  disabled={marking || previewLoading || !activeCount || activeCount.exportable === 0}
                >
                  <CheckCircle2 size={14} />
                  {markedN ? t("segMarkedSent").replace("{n}", formatNumber(markedN)) : t("segMarkSent")}
                </button>
              </div>
            </div>

            {previewLoading ? (
              <Spinner />
            ) : (
              <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{t("customer")}</th>
                      <th>{t("phone")}</th>
                      <th>{t("city")}</th>
                      <th>{t("segment")}</th>
                      <th>{t("orders")}</th>
                      <th>{t("totalSpent")}</th>
                      <th>{t("lastOrder")}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sample.map((r) => (
                      <tr
                        key={r.master_id}
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() => setDrawerId(r.master_id)}
                      >
                        <td className="font-medium">{r.name ?? r.master_id}</td>
                        <td dir="ltr" className="text-slate-600">{r.phone ?? "—"}</td>
                        <td>{r.city ?? "—"}</td>
                        <td className="text-xs">{r.segment ?? "—"}</td>
                        <td>{formatNumber(r.orders)}</td>
                        <td>{formatMoney(r.total_spent, lang)}</td>
                        <td className="text-xs text-slate-500" dir="ltr">{formatDate(r.last_order_at)}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <ContactActions phone={r.phone} name={r.name} waReason="general" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <SmsCalculator recipients={activeCount?.exportable ?? 0} />
          </div>
        )}
      </div>

      <SendLog rows={campaigns} />

      <OptOutManager count={optOutCount} onChanged={() => setReloadKey((k) => k + 1)} />

      <CustomerDrawer
        customerId={drawerId}
        onClose={() => setDrawerId(null)}
        onChanged={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function Kpi({ icon: Icon, color, label, value, sub }: { icon: React.ElementType; color: string; label: string; value: string; sub?: string }) {
  return (
    <div className={cn("card border-s-4 p-4", color)}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Icon size={14} />
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={cn("text-lg font-bold", tone)}>{value}</div>
    </div>
  );
}

// ------------------------------------------------------------- builder

function SegmentBuilder({
  options,
  def,
  onChange,
  onPreview,
  onSaved,
  activeCount,
}: {
  options: Options;
  def: SegDef;
  onChange: (d: SegDef) => void;
  onPreview: () => void;
  onSaved: () => void;
  activeCount: SegCount | null;
}) {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  function set<K extends keyof SegDef>(key: K, value: SegDef[K] | undefined) {
    const next = { ...def };
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) delete next[key];
    else next[key] = value;
    onChange(next);
  }

  async function save() {
    if (!saveName.trim()) return;
    setSaving(true);
    await supabase.from("saved_segments").insert({
      name: saveName.trim(),
      definition: def as unknown as Record<string, unknown>,
      last_people: activeCount?.people ?? null,
      last_reachable: activeCount?.reachable ?? null,
      counted_at: activeCount ? new Date().toISOString() : null,
    });
    setSaveName("");
    setSaving(false);
    onSaved();
  }

  const listNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const l of options.lists) m[l.id] = `${l.name} (${l.items})`;
    return m;
  }, [options.lists]);

  return (
    <div className="card mt-8 p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-lg bg-violet-50 p-2 text-violet-600">
          <Filter size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold">{t("segBuilder")}</h2>
          <p className="text-xs text-slate-500">{t("segBuilderHint")}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Field label={t("segBase")}>
          <select className="input" value={def.base ?? "all"} onChange={(e) => set("base", e.target.value === "all" ? undefined : e.target.value)}>
            <option value="all">{t("segBaseAll")}</option>
            <option value="buyers">{t("segBaseBuyers")}</option>
            <option value="never">{t("segBaseNever")}</option>
            <option value="repeat">{t("segBaseRepeat")}</option>
            <option value="one_time">{t("segBaseOneTime")}</option>
          </select>
        </Field>

        <Field label={t("segRfmFilter")}>
          <MultiSelect
            options={["champions", "loyal", "new", "promising", "at_risk", "hibernating"]}
            values={def.segments ?? []}
            onChange={(v) => set("segments", v.length ? v : undefined)}
            placeholder={t("segRfmFilter")}
          />
        </Field>

        <Field label={t("segCitiesFilter")}>
          <MultiSelect
            options={options.cities}
            values={def.cities ?? []}
            onChange={(v) => set("cities", v.length ? v : undefined)}
            placeholder={t("segCitiesFilter")}
          />
        </Field>

        <Field label={t("segJoinedBetween")}>
          <div className="flex gap-2">
            <input type="date" className="input" value={def.joined_from ?? ""} onChange={(e) => set("joined_from", e.target.value || undefined)} />
            <input type="date" className="input" value={def.joined_to ?? ""} onChange={(e) => set("joined_to", e.target.value || undefined)} />
          </div>
        </Field>

        <Field label={t("segOrderedBetween")}>
          <div className="flex gap-2">
            <input
              type="date"
              className="input"
              value={def.active_in?.from ?? ""}
              onChange={(e) => {
                const v = { ...def.active_in, from: e.target.value || undefined };
                set("active_in", v.from || v.to ? v : undefined);
              }}
            />
            <input
              type="date"
              className="input"
              value={def.active_in?.to ?? ""}
              onChange={(e) => {
                const v = { ...def.active_in, to: e.target.value || undefined };
                set("active_in", v.from || v.to ? v : undefined);
              }}
            />
          </div>
        </Field>

        <Field label={t("segRecency")}>
          <div className="flex gap-2">
            <input type="number" min={0} className="input" placeholder="min" value={def.recency_min ?? ""} onChange={(e) => set("recency_min", e.target.value ? Number(e.target.value) : undefined)} />
            <input type="number" min={0} className="input" placeholder="max" value={def.recency_max ?? ""} onChange={(e) => set("recency_max", e.target.value ? Number(e.target.value) : undefined)} />
          </div>
        </Field>

        <Field label={t("segOrdersRange")}>
          <div className="flex gap-2">
            <input type="number" min={0} className="input" placeholder="min" value={def.min_orders ?? ""} onChange={(e) => set("min_orders", e.target.value ? Number(e.target.value) : undefined)} />
            <input type="number" min={0} className="input" placeholder="max" value={def.max_orders ?? ""} onChange={(e) => set("max_orders", e.target.value ? Number(e.target.value) : undefined)} />
          </div>
        </Field>

        <Field label={t("segSpentRange")}>
          <div className="flex gap-2">
            <input type="number" min={0} className="input" placeholder="min" value={def.min_spent ?? ""} onChange={(e) => set("min_spent", e.target.value ? Number(e.target.value) : undefined)} />
            <input type="number" min={0} className="input" placeholder="max" value={def.max_spent ?? ""} onChange={(e) => set("max_spent", e.target.value ? Number(e.target.value) : undefined)} />
          </div>
        </Field>

        <Field label={t("segBirthMonthFilter")}>
          <select className="input" value={def.birth_month ?? ""} onChange={(e) => set("birth_month", e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">{t("segAnyMonth")}</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </Field>

        <Field label={t("segLastStatus")}>
          <select className="input" value={def.last_status ?? ""} onChange={(e) => set("last_status", e.target.value || undefined)}>
            <option value="">{t("segStatusAny")}</option>
            <option value="delivered">{t("segStDelivered")}</option>
            <option value="canceled">{t("segStCanceled")}</option>
            <option value="returned">{t("segStReturned")}</option>
            <option value="in_progress">{t("segStInProgress")}</option>
          </select>
        </Field>

        <Field label={t("segHistory")}>
          <select className="input" value={def.history ?? ""} onChange={(e) => set("history", e.target.value || undefined)}>
            <option value="">{t("segStatusAny")}</option>
            <option value="clean">{t("segHistClean")}</option>
            <option value="has_canceled">{t("segHistHasCanceled")}</option>
            <option value="all_canceled">{t("segHistAllCanceled")}</option>
          </select>
        </Field>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <BoughtEditor label={t("segBoughtFilter")} value={def.bought} onChange={(v) => set("bought", v)} options={options} listNames={listNames} />
        <BoughtEditor label={t("segNotBoughtFilter")} value={def.not_bought} onChange={(v) => set("not_bought", v)} options={options} listNames={listNames} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        <button className="btn-primary" onClick={onPreview}>
          <Search size={16} />
          {t("segPreview")}
        </button>
        {activeCount && (
          <span className="text-sm text-slate-600">
            <b>{formatNumber(activeCount.people)}</b> {t("segMatches")} · 📱 {formatNumber(activeCount.exportable)}
          </span>
        )}
        <div className="ms-auto flex items-center gap-2">
          <input className="input !w-52" placeholder={t("segSegmentName")} value={saveName} onChange={(e) => setSaveName(e.target.value)} />
          <button className="btn-secondary" onClick={save} disabled={saving || !saveName.trim()}>
            <Save size={16} />
            {t("segSaveSegment")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-600">{label}</label>
      {children}
    </div>
  );
}

// bought / not-bought editor: pick a kind, then SKUs (search), a category
// (dropdown) or a custom list, plus an optional period.
function BoughtEditor({
  label,
  value,
  onChange,
  options,
  listNames,
}: {
  label: string;
  value: BoughtDef | undefined;
  onChange: (v: BoughtDef | undefined) => void;
  options: Options;
  listNames: Record<string, string>;
}) {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [skuQuery, setSkuQuery] = useState("");
  const [skuResults, setSkuResults] = useState<{ sku: string; name: string | null }[]>([]);
  const [skuNames, setSkuNames] = useState<Record<string, string>>({});

  const kind = value?.kind ?? "none";

  useEffect(() => {
    if (kind !== "sku" || skuQuery.trim().length < 2) {
      setSkuResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const q = skuQuery.trim();
      const { data } = await supabase
        .from("products")
        .select("sku, name")
        .or(`name.ilike.%${q}%,sku.ilike.%${q}%,english_name.ilike.%${q}%`)
        .limit(12);
      setSkuResults((data as { sku: string; name: string | null }[]) ?? []);
    }, 300);
    return () => clearTimeout(timer);
  }, [supabase, skuQuery, kind]);

  function setKind(k: string) {
    if (k === "none") onChange(undefined);
    else onChange({ kind: k as BoughtDef["kind"], values: [], from: value?.from, to: value?.to });
  }

  function setValues(values: string[]) {
    if (!value) return;
    onChange({ ...value, values });
  }

  function addSku(sku: string, name: string | null) {
    if (!value || value.values.includes(sku)) return;
    setSkuNames((prev) => ({ ...prev, [sku]: name ?? sku }));
    setValues([...value.values, sku]);
    setSkuQuery("");
    setSkuResults([]);
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-600">{label}</span>
        <select className="input !w-auto !py-1 text-xs" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="none">{t("segKindNone")}</option>
          <option value="sku">{t("segKindSku")}</option>
          <option value="section">{t("segKindSection")}</option>
          <option value="category">{t("segKindCategory")}</option>
          <option value="list">{t("segKindList")}</option>
        </select>
        {value && (
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <span>{t("segInPeriod")}:</span>
            <input type="date" className="input !w-auto !py-1 text-xs" value={value.from ?? ""} onChange={(e) => onChange({ ...value, from: e.target.value || undefined })} />
            <input type="date" className="input !w-auto !py-1 text-xs" value={value.to ?? ""} onChange={(e) => onChange({ ...value, to: e.target.value || undefined })} />
          </div>
        )}
      </div>

      {kind === "category" && (
        <MultiSelect options={options.categories} values={value?.values ?? []} onChange={setValues} placeholder={t("segKindCategory")} />
      )}

      {kind === "section" && (
        <MultiSelect options={options.sections} values={value?.values ?? []} onChange={setValues} placeholder={t("segKindSection")} />
      )}

      {kind === "list" && (
        <MultiSelect
          options={options.lists.map((l) => l.id)}
          values={value?.values ?? []}
          onChange={setValues}
          placeholder={t("segKindList")}
          getLabel={(id) => listNames[id] ?? id}
        />
      )}

      {kind === "sku" && (
        <div>
          <div className="relative">
            <input className="input" placeholder={t("segSkuPlaceholder")} value={skuQuery} onChange={(e) => setSkuQuery(e.target.value)} />
            {skuResults.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {skuResults.map((r) => (
                  <button
                    key={r.sku}
                    className="block w-full px-3 py-1.5 text-start text-sm hover:bg-slate-50"
                    onClick={() => addSku(r.sku, r.name)}
                  >
                    <span className="font-medium">{r.name ?? r.sku}</span>
                    <span className="ms-2 text-xs text-slate-400" dir="ltr">{r.sku}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {value && value.values.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {value.values.map((sku) => (
                <span key={sku} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
                  {skuNames[sku] ?? sku}
                  <button onClick={() => setValues(value.values.filter((s) => s !== sku))}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------- saved segments

function SavedSegments({
  saved,
  onLoad,
  onChanged,
  capDays,
}: {
  saved: SavedSegment[];
  onLoad: (s: SavedSegment) => void;
  onChanged: () => void;
  capDays: number;
}) {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState<string | null>(null);

  async function recount(s: SavedSegment) {
    setBusy(s.id);
    const { data } = await supabase.rpc("fn_segment_count", { p_def: withCap(s.definition, capDays) });
    const c = data as SegCount | null;
    if (c) {
      await supabase
        .from("saved_segments")
        .update({ last_people: c.people, last_reachable: c.reachable, counted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", s.id);
      onChanged();
    }
    setBusy(null);
  }

  async function exportSaved(s: SavedSegment) {
    setBusy(s.id);
    const rows = await rpcAll<ExportRow>(supabase, "fn_segment_export", { p_def: withCap(s.definition, capDays), p_limit: 100000 });
    if (rows.length) {
      downloadCsv(`segment-${s.name.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows as unknown as Record<string, unknown>[]));
    }
    setBusy(null);
  }

  async function remove(s: SavedSegment) {
    if (!await confirmDialog(t("segDeleteConfirm"))) return;
    await supabase.from("saved_segments").delete().eq("id", s.id);
    onChanged();
  }

  return (
    <div className="card mt-8 p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-lg bg-teal-50 p-2 text-teal-600">
          <FolderOpen size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold">{t("segSaved")} ({formatNumber(saved.length)})</h2>
          <p className="text-xs text-slate-500">{t("segSavedHint")}</p>
        </div>
      </div>

      {saved.length === 0 ? (
        <div className="py-4 text-center text-sm text-slate-500">{t("segNoSaved")}</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t("segSegmentName")}</th>
                <th>{t("segPeopleCol")}</th>
                <th>{t("segReachableCol")}</th>
                <th>{t("segEstCost")}</th>
                <th>{t("segCountedAt")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {saved.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.name}</td>
                  <td>{s.last_people != null ? formatNumber(s.last_people) : "—"}</td>
                  <td className="text-emerald-700">{s.last_reachable != null ? formatNumber(s.last_reachable) : "—"}</td>
                  <td className="text-xs">{s.last_reachable != null ? formatMoney(s.last_reachable * SMS_PRICE_EGP) : "—"}</td>
                  <td className="text-xs text-slate-500" dir="ltr">{formatDate(s.counted_at)}</td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <button className="btn-secondary !px-2 !py-1 text-xs" title={t("segRecount")} onClick={() => recount(s)} disabled={busy === s.id}>
                        <RefreshCw size={13} className={busy === s.id ? "animate-spin" : undefined} />
                      </button>
                      <button className="btn-secondary !px-2 !py-1 text-xs" title={t("segLoad")} onClick={() => onLoad(s)}>
                        <FolderOpen size={13} />
                      </button>
                      <button className="btn-secondary !px-2 !py-1 text-xs" title={t("segExportCsv")} onClick={() => exportSaved(s)} disabled={busy === s.id}>
                        <Download size={13} />
                      </button>
                      <button className="btn-secondary !px-2 !py-1 text-xs !text-red-600" onClick={() => remove(s)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ send log

function SendLog({ rows }: { rows: CampaignRow[] }) {
  const { t } = useLang();
  return (
    <div className="card mt-8 p-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
          <History size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold">{t("segSendLog")}</h2>
          <p className="text-xs text-slate-500">{t("segSendLogHint")}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="py-4 text-center text-sm text-slate-500">{t("segNoSends")}</div>
      ) : (
        <div className="max-h-72 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t("segSentOn")}</th>
                <th>{t("segCampaignName")}</th>
                <th>{t("segSegmentName")}</th>
                <th>{t("segRecipients")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.sent_on}-${r.campaign}-${i}`}>
                  <td className="text-xs text-slate-500" dir="ltr">{formatDate(r.sent_on)}</td>
                  <td className="font-medium">{r.campaign}</td>
                  <td className="text-xs text-slate-500">{r.segment_name ?? "—"}</td>
                  <td className="font-semibold">{formatNumber(r.recipients)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------- SMS calculator

function SmsCalculator({ recipients }: { recipients: number }) {
  const { t, lang } = useLang();
  const [message, setMessage] = useState("");
  const { chars, parts } = smsParts(message);
  const total = parts * recipients * SMS_PRICE_EGP;
  // how many characters are left before the NEXT part starts
  const remaining = chars === 0 ? SMS_PART_CHARS : parts * SMS_PART_CHARS - chars;
  const over = parts > 1;

  return (
    <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50/50 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Calculator size={16} className="text-amber-600" />
        <h3 className="text-sm font-bold">{t("segSmsCalc")}</h3>
      </div>
      <p className="mb-3 text-xs text-slate-500">{t("segSmsCalcHint")}</p>
      <textarea
        className={cn("input min-h-20 w-full", over && "!border-red-400 focus:!ring-red-300")}
        dir="auto"
        placeholder={t("segSmsMessage")}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <div className={cn("mt-1 text-xs font-semibold", over ? "text-red-600" : "text-slate-500")} dir="ltr">
        {chars} / {SMS_PART_CHARS} · {over ? t("segSmsOver").replace("{n}", String(parts)) : t("segSmsRemaining").replace("{n}", String(remaining))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
        <MiniStat label={t("segSmsChars")} value={formatNumber(chars)} />
        <MiniStat label={t("segSmsParts")} value={formatNumber(parts)} tone={over ? "text-red-600" : "text-emerald-700"} />
        <MiniStat label={t("segSmsRecipients")} value={formatNumber(recipients)} />
        <MiniStat label={t("segSmsPerSms")} value={formatMoney(SMS_PRICE_EGP * parts, lang)} />
        <MiniStat label={t("segSmsTotal")} value={formatMoney(total, lang)} tone="text-brand-700" />
      </div>
    </div>
  );
}

// --------------------------------------------------------- opt-out list

function OptOutManager({ count, onChanged }: { count: number; onChanged: () => void }) {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [pasted, setPasted] = useState("");
  const [added, setAdded] = useState(0);
  const [busy, setBusy] = useState(false);

  async function add() {
    const phones = Array.from(
      new Set(
        pasted
          .split(/[\n,;]+/)
          .map((p) => normPhone(p))
          .filter(Boolean) as string[]
      )
    );
    if (!phones.length) return;
    setBusy(true);
    await supabase.from("sms_opt_outs").upsert(
      phones.map((phone_norm) => ({ phone_norm })),
      { onConflict: "phone_norm", ignoreDuplicates: true }
    );
    setAdded(phones.length);
    setPasted("");
    setBusy(false);
    onChanged();
    setTimeout(() => setAdded(0), 4000);
  }

  return (
    <div className="card mt-8 p-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="rounded-lg bg-red-50 p-2 text-red-600">
          <Ban size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold">
            {t("segOptOuts")} <span className="text-sm font-normal text-slate-500">({formatNumber(count)} {t("segOptOutsCount")})</span>
          </h2>
          <p className="text-xs text-slate-500">{t("segOptOutsHint")}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <textarea
          className="input min-h-16 flex-1"
          dir="ltr"
          placeholder={"01012345678\n01198765432"}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
        <button className="btn-secondary" onClick={add} disabled={busy || !pasted.trim()}>
          <Ban size={16} />
          {added ? t("segOptOutsAdded").replace("{n}", formatNumber(added)) : t("segOptOutsAdd")}
        </button>
      </div>
    </div>
  );
}
