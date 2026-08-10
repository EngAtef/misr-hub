"use client";

// Ad Audiences — buyer-persona exports for Meta Lookalike seeding.
// Deliberately separate from /segments (its own page_key: 'audiences') so a
// media buyer can be granted exactly this page — audience building and
// exports — with no SMS tooling or costs anywhere on it.
//
// Same engine as /segments underneath (fn_segment_ids), so "buyers of book X
// in July" means the same people on both pages. Exports speak Meta's Custom
// Audience CSV dialect; Meta hashes on upload and matches phone or email.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Radar, Users2, Mail, Phone, Flame, ShoppingBag, Repeat2, Trophy, Search,
  Download, MapPin, PieChart, X, Filter, Info,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner } from "@/components/ui";
import { MultiSelect } from "@/components/multi-select";
import { CustomerDrawer } from "@/components/customer-drawer";
import { formatMoney, formatNumber, formatDate, toCsv, downloadCsv, cn } from "@/lib/utils";

// ------------------------------------------------------------ definitions

interface BoughtDef {
  kind: "sku" | "category" | "section" | "list";
  values: string[];
  from?: string;
  to?: string;
}

interface AudDef {
  base?: string;
  cities?: string[];
  min_orders?: number;
  min_spent?: number;
  active_in?: { from?: string; to?: string };
  bought?: BoughtDef;
}

interface AudCount {
  people: number;
  with_phone: number;
  with_email: number;
  matchable: number;
}

interface AudInsights {
  people: number;
  avg_spend: number | null;
  avg_orders: number | null;
  repeat_buyers: number;
  active_180: number;
  with_birthdate: number;
  cities: { city: string; n: number }[];
  segments: { segment: string; n: number }[];
}

interface AudRow {
  email: string | null;
  phone: string | null;
  fn: string | null;
  ln: string | null;
  ct: string | null;
  country: string;
  value: number | null;
  master_id: string;
  orders: number;
  last_order_at: string | null;
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

// ================================================================== page

export default function AudiencesPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);

  const [options, setOptions] = useState<Options>({ cities: [], sections: [], categories: [], lists: [] });
  const [totals, setTotals] = useState<AudCount | null>(null);
  const [totalsIns, setTotalsIns] = useState<AudInsights | null>(null);

  // builder state
  const [kind, setKind] = useState<"any" | "sku" | "category" | "section" | "list">("any");
  const [values, setValues] = useState<string[]>([]);
  const [skuNames, setSkuNames] = useState<Record<string, string>>({});
  const [window_, setWindow] = useState<0 | 90 | 180 | 365>(0);
  const [minOrders, setMinOrders] = useState<number | undefined>();
  const [minSpent, setMinSpent] = useState<number | undefined>();
  const [cities, setCities] = useState<string[]>([]);

  // active audience
  const [activeLabel, setActiveLabel] = useState("");
  const [activeDef, setActiveDef] = useState<AudDef | null>(null);
  const [count, setCount] = useState<AudCount | null>(null);
  const [insights, setInsights] = useState<AudInsights | null>(null);
  const [sample, setSample] = useState<AudRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [includeValue, setIncludeValue] = useState(true);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.rpc("fn_segment_options").then(({ data }) => {
      const o = data as Options | null;
      if (o && o.cities) setOptions(o);
    });
    supabase.rpc("fn_audience_count", { p_def: { base: "buyers" } }).then(({ data }) => setTotals(data as AudCount));
    supabase.rpc("fn_audience_insights", { p_def: { base: "buyers" } }).then(({ data }) => setTotalsIns(data as AudInsights));
  }, [supabase]);

  const openAudience = useCallback(
    async (label: string, def: AudDef) => {
      setActiveLabel(label);
      setActiveDef(def);
      setLoading(true);
      setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      const [c, i, s] = await Promise.all([
        supabase.rpc("fn_audience_count", { p_def: def }),
        supabase.rpc("fn_audience_insights", { p_def: def }),
        supabase.rpc("fn_audience_export", { p_def: def, p_limit: 30 }),
      ]);
      setCount(c.data as AudCount);
      setInsights(i.data as AudInsights);
      setSample((s.data as AudRow[]) ?? []);
      setLoading(false);
    },
    [supabase]
  );

  function builderDef(): AudDef {
    const def: AudDef = {};
    if (kind === "any") {
      def.base = "buyers";
      if (window_) def.active_in = { from: isoDaysAgo(window_) };
    } else {
      def.bought = { kind, values, from: window_ ? isoDaysAgo(window_) : undefined };
    }
    if (minOrders) def.min_orders = minOrders;
    if (minSpent) def.min_spent = minSpent;
    if (cities.length) def.cities = cities;
    return def;
  }

  function builderLabel(): string {
    if (kind === "sku") return values.map((v) => skuNames[v] ?? v).join(", ") || t("audBuilder");
    if (kind === "category" || kind === "section") return values.join(", ") || t("audBuilder");
    if (kind === "list") {
      const names = options.lists.filter((l) => values.includes(l.id)).map((l) => l.name);
      return names.join(", ") || t("audBuilder");
    }
    return t("audPresetAll");
  }

  async function fetchFull(): Promise<AudRow[]> {
    if (!activeDef) return [];
    const { data } = await supabase.rpc("fn_audience_export", { p_def: activeDef, p_limit: 100000 });
    return (data as AudRow[]) ?? [];
  }

  function slugify(s: string): string {
    return s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase() || "audience";
  }

  // Meta Custom Audience file: exactly the columns the upload template
  // understands, nothing internal.
  async function exportMeta() {
    const rows = await fetchFull();
    if (!rows.length) return;
    const cols = ["email", "phone", "fn", "ln", "ct", "country", ...(includeValue ? ["value"] : [])];
    const metaRows = rows.map((r) => {
      const o: Record<string, unknown> = {
        email: r.email ?? "",
        phone: r.phone ?? "",
        fn: r.fn ?? "",
        ln: r.ln ?? "",
        ct: r.ct ?? "",
        country: r.country,
      };
      if (includeValue) o.value = r.value ?? 0;
      return o;
    });
    downloadCsv(
      `meta-audience-${slugify(activeLabel)}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(metaRows, cols)
    );
  }

  async function exportFull() {
    const rows = await fetchFull();
    if (!rows.length) return;
    downloadCsv(
      `audience-${slugify(activeLabel)}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rows as unknown as Record<string, unknown>[])
    );
  }

  const presets = [
    { key: "all", label: t("audPresetAll"), icon: Users2, color: "text-brand-600 bg-brand-50 border-brand-200", def: { base: "buyers" } as AudDef },
    { key: "recent", label: t("audPresetRecent"), icon: Flame, color: "text-orange-600 bg-orange-50 border-orange-200", def: { base: "buyers", active_in: { from: isoDaysAgo(180) } } as AudDef },
    { key: "repeat", label: t("audPresetRepeat"), icon: Repeat2, color: "text-violet-600 bg-violet-50 border-violet-200", def: { base: "repeat" } as AudDef },
    { key: "top", label: t("audPresetTop"), icon: Trophy, color: "text-amber-600 bg-amber-50 border-amber-200", def: { base: "buyers", min_spent: 1000 } as AudDef },
  ];

  return (
    <div>
      <PageHeader title={t("audiences")} subtitle={t("audiencesSubtitle")} />

      {/* headline */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi icon={Users2} color="border-s-brand-500" label={t("audBuyersTotal")} value={totals ? formatNumber(totals.people) : "…"} />
        <Kpi icon={Radar} color="border-s-emerald-500" label={t("audMatchable")} value={totals ? formatNumber(totals.matchable) : "…"} sub={t("audMatchableHint")} />
        <Kpi icon={Mail} color="border-s-violet-500" label={t("audWithEmail")} value={totals ? formatNumber(totals.with_email) : "…"} />
        <Kpi icon={Flame} color="border-s-orange-500" label={t("audActive180")} value={totalsIns ? formatNumber(totalsIns.active_180) : "…"} />
      </div>

      {/* presets */}
      <div className="mb-2 flex items-start gap-3">
        <div className="rounded-lg bg-brand-50 p-2 text-brand-600">
          <Radar size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold">{t("audPresets")}</h2>
          <p className="text-xs text-slate-500">{t("audPresetsHint")}</p>
        </div>
      </div>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {presets.map((p) => {
          const Icon = p.icon;
          return (
            <div
              key={p.key}
              className={cn(
                "card cursor-pointer border p-4 transition hover:shadow-md",
                activeLabel === p.label && "ring-2 ring-brand-400"
              )}
              onClick={() => openAudience(p.label, p.def)}
            >
              <div className={cn("mb-2 inline-flex rounded-lg border p-1.5", p.color)}>
                <Icon size={16} />
              </div>
              <div className="text-sm font-semibold leading-snug">{p.label}</div>
            </div>
          );
        })}
      </div>

      {/* builder */}
      <div className="card p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="rounded-lg bg-violet-50 p-2 text-violet-600">
            <Filter size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold">{t("audBuilder")}</h2>
            <p className="text-xs text-slate-500">{t("audBuilderHint")}</p>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">{t("audWhatBought")}</label>
            <div className="mb-2 flex flex-wrap gap-2">
              {([
                ["any", t("audKindAny")],
                ["sku", t("segKindSku")],
                ["section", t("segKindSection")],
                ["category", t("segKindCategory")],
                ["list", t("segKindList")],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold transition",
                    kind === k
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  )}
                  onClick={() => {
                    setKind(k);
                    setValues([]);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {kind === "category" && (
              <MultiSelect options={options.categories} values={values} onChange={setValues} placeholder={t("segKindCategory")} />
            )}
            {kind === "section" && (
              <MultiSelect options={options.sections} values={values} onChange={setValues} placeholder={t("segKindSection")} />
            )}
            {kind === "list" && (
              <MultiSelect
                options={options.lists.map((l) => l.id)}
                values={values}
                onChange={setValues}
                placeholder={t("segKindList")}
                getLabel={(id) => {
                  const l = options.lists.find((x) => x.id === id);
                  return l ? `${l.name} (${l.items})` : id;
                }}
              />
            )}
            {kind === "sku" && (
              <SkuPicker
                values={values}
                onChange={setValues}
                names={skuNames}
                onName={(sku, name) => setSkuNames((prev) => ({ ...prev, [sku]: name }))}
              />
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">{t("audQuality")}</label>
            <div className="grid grid-cols-2 gap-2">
              <select className="input" value={window_} onChange={(e) => setWindow(Number(e.target.value) as typeof window_)}>
                <option value={0}>{t("audBoughtWithin")}: {t("audAnyTime")}</option>
                <option value={90}>{t("audDays90")}</option>
                <option value={180}>{t("audDays180")}</option>
                <option value={365}>{t("audDays365")}</option>
              </select>
              <MultiSelect options={options.cities} values={cities} onChange={setCities} placeholder={t("segCitiesFilter")} />
              <input
                type="number"
                min={0}
                className="input"
                placeholder={t("audMinOrders")}
                value={minOrders ?? ""}
                onChange={(e) => setMinOrders(e.target.value ? Number(e.target.value) : undefined)}
              />
              <input
                type="number"
                min={0}
                className="input"
                placeholder={t("audMinSpent")}
                value={minSpent ?? ""}
                onChange={(e) => setMinSpent(e.target.value ? Number(e.target.value) : undefined)}
              />
            </div>
          </div>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-4">
          <button
            className="btn-primary"
            onClick={() => openAudience(builderLabel(), builderDef())}
            disabled={kind !== "any" && values.length === 0}
          >
            <Search size={16} />
            {t("audPreview")}
          </button>
        </div>
      </div>

      {/* persona + export */}
      <div ref={previewRef}>
        {activeDef && (
          <div className="card mt-8 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold">{activeLabel}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-secondary !py-1.5 text-xs" onClick={exportFull} disabled={loading}>
                  <Download size={14} />
                  {t("audExportFull")}
                </button>
                <button className="btn-primary !py-1.5 text-xs" onClick={exportMeta} disabled={loading}>
                  <Download size={14} />
                  {t("audExportMeta")}
                </button>
              </div>
            </div>

            {count && (
              <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <MiniStat label={t("segPeopleCol")} value={formatNumber(count.people)} />
                <MiniStat label={t("audMatchable")} value={formatNumber(count.matchable)} tone="text-emerald-700" />
                <MiniStat label={t("audWithPhone")} value={formatNumber(count.with_phone)} />
                <MiniStat label={t("audWithEmail")} value={formatNumber(count.with_email)} />
              </div>
            )}

            <label className="mb-1 flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={includeValue} onChange={(e) => setIncludeValue(e.target.checked)} />
              {t("audIncludeValue")}
            </label>
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
              <Info size={14} className="mt-0.5 shrink-0" />
              {t("audMetaFormatHint")}
            </div>

            {loading ? (
              <Spinner />
            ) : (
              insights && (
                <div className="mb-5 grid gap-4 xl:grid-cols-3">
                  {/* persona numbers */}
                  <div className="rounded-lg border border-slate-200 p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-bold">
                      <ShoppingBag size={15} className="text-brand-600" />
                      {t("audPersona")}
                    </div>
                    <dl className="space-y-1.5 text-sm">
                      <PersonaRow label={t("audAvgSpend")} value={insights.avg_spend != null ? formatMoney(insights.avg_spend, lang) : "—"} />
                      <PersonaRow label={t("audAvgOrders")} value={insights.avg_orders != null ? String(insights.avg_orders) : "—"} />
                      <PersonaRow
                        label={t("audRepeatRate")}
                        value={insights.people ? `${((insights.repeat_buyers / insights.people) * 100).toFixed(1)}%` : "—"}
                      />
                      <PersonaRow label={t("audActive180")} value={formatNumber(insights.active_180)} />
                    </dl>
                  </div>

                  {/* top cities */}
                  <div className="rounded-lg border border-slate-200 p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-bold">
                      <MapPin size={15} className="text-sky-600" />
                      {t("audTopCities")}
                    </div>
                    <Bars rows={insights.cities.map((c) => ({ label: c.city, n: c.n }))} total={insights.people} color="bg-sky-500" />
                  </div>

                  {/* segment mix */}
                  <div className="rounded-lg border border-slate-200 p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-bold">
                      <PieChart size={15} className="text-violet-600" />
                      {t("audRfmMix")}
                    </div>
                    <Bars rows={insights.segments.map((s) => ({ label: s.segment, n: s.n }))} total={insights.people} color="bg-violet-500" />
                  </div>
                </div>
              )
            )}

            {!loading && sample.length > 0 && (
              <>
                <h3 className="mb-2 text-sm font-bold text-slate-600">{t("audSample")}</h3>
                <div className="max-h-80 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>{t("customer")}</th>
                        <th>{t("phone")}</th>
                        <th>{t("email")}</th>
                        <th>{t("city")}</th>
                        <th>{t("orders")}</th>
                        <th>{t("audValueCol")}</th>
                        <th>{t("lastOrder")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sample.map((r) => (
                        <tr
                          key={r.master_id}
                          className="cursor-pointer hover:bg-slate-50"
                          onClick={() => setDrawerId(r.master_id)}
                        >
                          <td className="font-medium">{[r.fn, r.ln].filter(Boolean).join(" ") || r.master_id}</td>
                          <td dir="ltr" className="text-slate-600">{r.phone ?? "—"}</td>
                          <td dir="ltr" className="text-xs text-slate-500">{r.email ?? "—"}</td>
                          <td>{r.ct ?? "—"}</td>
                          <td>{formatNumber(r.orders)}</td>
                          <td className="font-semibold">{r.value != null ? formatMoney(r.value, lang) : "—"}</td>
                          <td className="text-xs text-slate-500" dir="ltr">{formatDate(r.last_order_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <CustomerDrawer customerId={drawerId} onClose={() => setDrawerId(null)} />
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

function PersonaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function Bars({ rows, total, color }: { rows: { label: string; n: number }[]; total: number; color: string }) {
  if (!rows.length) return <div className="text-xs text-slate-400">—</div>;
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-xs">
          <span className="w-24 truncate text-slate-600">{r.label}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className={cn("h-full rounded-full", color)} style={{ width: `${(r.n / max) * 100}%` }} />
          </div>
          <span className="w-16 text-end font-semibold" dir="ltr">
            {formatNumber(r.n)} · {total ? Math.round((r.n / total) * 100) : 0}%
          </span>
        </div>
      ))}
    </div>
  );
}

// book search with chips — same interaction as the segments builder
function SkuPicker({
  values,
  onChange,
  names,
  onName,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  names: Record<string, string>;
  onName: (sku: string, name: string) => void;
}) {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ sku: string; name: string | null }[]>([]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const q = query.trim();
      const { data } = await supabase
        .from("products")
        .select("sku, name")
        .or(`name.ilike.%${q}%,sku.ilike.%${q}%,english_name.ilike.%${q}%`)
        .limit(12);
      setResults((data as { sku: string; name: string | null }[]) ?? []);
    }, 300);
    return () => clearTimeout(timer);
  }, [supabase, query]);

  return (
    <div>
      <div className="relative">
        <input className="input" placeholder={t("segSkuPlaceholder")} value={query} onChange={(e) => setQuery(e.target.value)} />
        {results.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {results.map((r) => (
              <button
                key={r.sku}
                className="block w-full px-3 py-1.5 text-start text-sm hover:bg-slate-50"
                onClick={() => {
                  if (!values.includes(r.sku)) {
                    onName(r.sku, r.name ?? r.sku);
                    onChange([...values, r.sku]);
                  }
                  setQuery("");
                  setResults([]);
                }}
              >
                <span className="font-medium">{r.name ?? r.sku}</span>
                <span className="ms-2 text-xs text-slate-400" dir="ltr">{r.sku}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {values.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {values.map((sku) => (
            <span key={sku} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
              {names[sku] ?? sku}
              <button onClick={() => onChange(values.filter((s) => s !== sku))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
