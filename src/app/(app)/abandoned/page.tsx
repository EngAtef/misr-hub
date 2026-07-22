"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ShoppingBasket, Download, RefreshCw, Search, ChevronDown, ChevronUp,
  ExternalLink, Megaphone, Flame, Users, UserPlus, Repeat, Sparkles,
  CheckCircle2, X, PhoneOutgoing, AlertTriangle, User,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { useMyRole } from "@/lib/use-role";
import { PageHeader, Spinner, EmptyState, ChartCard, KpiCard } from "@/components/ui";
import { TrendChart, BarsChart, DonutChart } from "@/components/charts";
import { MultiSelect } from "@/components/multi-select";
import { CustomerDrawer } from "@/components/customer-drawer";
import { formatMoney, formatNumber, formatDate, toCsv, downloadCsv, cn } from "@/lib/utils";
import { ContactActions } from "@/components/contact-actions";
import { abandonedCartLink } from "@/lib/whatsapp";

interface Summary {
  total_carts: number; total_value: number; avg_cart_value: number;
  reachable_carts: number; reachable_value: number; guest_carts: number;
  known_customers: number; prospects: number;
  recovered_carts: number; recovered_value: number;
  contacted: number; responded: number; lost: number; new_carts: number;
  hot_carts: number; hot_value: number; hot_reachable: number;
  last30_carts: number; last30_value: number;
  repeat_abandoners: number; facebook_carts: number; notified_carts: number;
  items_rows: number; last_import: string | null;
  anomaly_carts: number; anomaly_value: number; anomaly_days: number; anomaly_days_value: number;
}

interface SegmentRow { segment: string; carts: number; reachable: number; total_value: number; recovered: number }

interface CartRow {
  cart_key: string; full_name: string | null; email: string | null; phone: string | null; phone_norm: string | null;
  products_count: number | null; skus: string[] | null; cart_value: number | null;
  created_at: string | null; notified_at: string | null; web_url: string | null;
  traffic_hint: string | null; is_guest: boolean; customer_id: string | null;
  recall_status: string; recall_note: string | null; recalled_at: string | null; recalled_by: string | null;
  recovered_order_number: string | null; recovered_at: string | null; recovered_value: number | null;
  age_days: number; is_repeat: boolean; is_anomaly: boolean; anomaly_reason: string | null;
  customer_name: string | null; customer_city: string | null;
  lifetime_orders: number | null; lifetime_delivered_amount: number | null;
  full_count: number;
}

interface TrendRow { day: string; lost_value: number | null; avg_cart_value: number | null; carts: number; platform_lost: number | null }
interface TopProduct { sku: string; product_name: string | null; carts: number; total_qty: number; ecom_stock: number | null; in_catalog: boolean }
interface Repeater {
  phone_norm: string; full_name: string | null; email: string | null; customer_id: string | null;
  carts: number; total_value: number; last_abandoned: string | null; recovered: number; recall_status: string;
}
interface CartItem { item_key: string; sku: string | null; product_name: string | null; qty: number | null }
interface Breakdowns {
  by_hour: { hour: number; carts: number; value: number }[];
  by_dow: { dow: number; carts: number; value: number }[];
  by_bucket: { bucket: string; carts: number; value: number }[];
  by_traffic: { source: string; carts: number; value: number; reachable: number }[];
}
interface AnomalyReport {
  carts: {
    cart_key: string; full_name: string | null; phone: string | null; email: string | null;
    products_count: number | null; cart_value: number | null; created_at: string | null;
    reason: string | null; user_ip: string | null; web_url: string | null;
  }[];
  days: { day: string; lost_value: number | null; avg_cart_value: number | null; real_value: number | null }[];
  carts_value: number;
  days_value: number;
}

const PAGE_SIZE = 50;

const SEGMENTS: { key: string; labelKey: DictKey; icon: React.ElementType }[] = [
  { key: "all", labelKey: "abSegAll", icon: ShoppingBasket },
  { key: "hot_0_7", labelKey: "abSegHot", icon: Flame },
  { key: "warm_8_30", labelKey: "abSegWarm", icon: Flame },
  { key: "cool_31_90", labelKey: "abSegCool", icon: Flame },
  { key: "cold_90p", labelKey: "abSegCold", icon: Flame },
  { key: "vip_1000", labelKey: "abSegVip", icon: Sparkles },
  { key: "known_customer", labelKey: "abSegKnown", icon: Users },
  { key: "prospect", labelKey: "abSegProspect", icon: UserPlus },
  { key: "repeat_abandoner", labelKey: "abSegRepeat", icon: Repeat },
  { key: "facebook", labelKey: "abSegFacebook", icon: Megaphone },
  { key: "guest_anon", labelKey: "abSegGuest", icon: Users },
];

const STATUS_STYLE: Record<string, string> = {
  new: "bg-slate-100 text-slate-700",
  contacted: "bg-blue-100 text-blue-800",
  responded: "bg-violet-100 text-violet-800",
  recovered: "bg-emerald-100 text-emerald-800",
  lost: "bg-red-100 text-red-700",
  excluded: "bg-slate-200 text-slate-500",
};
const STATUS_KEY: Record<string, DictKey> = {
  new: "abStatusNew", contacted: "abStatusContacted", responded: "abStatusResponded",
  recovered: "abStatusRecovered", lost: "abStatusLost", excluded: "abStatusExcluded",
};
const TRAFFIC_KEY: Record<string, DictKey> = {
  direct: "abTrafficDirect", facebook: "abTrafficFacebook", google: "abTrafficGoogle",
  tiktok: "abTrafficTiktok", other_campaign: "abTrafficCampaign", unknown: "abTrafficUnknown",
};
const SORTS: { key: string; labelKey: DictKey }[] = [
  { key: "newest", labelKey: "abSortNewest" },
  { key: "oldest", labelKey: "abSortOldest" },
  { key: "value_desc", labelKey: "abSortValueDesc" },
  { key: "value_asc", labelKey: "abSortValueAsc" },
  { key: "products_desc", labelKey: "abSortProducts" },
];

export default function AbandonedPage() {
  const { t, lang } = useLang();
  const role = useMyRole();
  const canEdit = role === "admin" || role === "manager";
  const supabase = useMemo(() => createClient(), []);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [segments, setSegments] = useState<SegmentRow[]>([]);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [trendDays, setTrendDays] = useState(180);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [repeaters, setRepeaters] = useState<Repeater[]>([]);
  const [breakdowns, setBreakdowns] = useState<Breakdowns | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyReport | null>(null);
  const [showAnomalies, setShowAnomalies] = useState(false);
  const [loading, setLoading] = useState(true);

  const [carts, setCarts] = useState<CartRow[]>([]);
  const [cartsLoading, setCartsLoading] = useState(false);
  const [segment, setSegment] = useState("all");
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [trafficFilters, setTrafficFilters] = useState<string[]>([]);
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [order, setOrder] = useState("newest");
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [page, setPage] = useState(0);
  const [fullCount, setFullCount] = useState(0);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, CartItem[]>>({});
  const [drawerCustomer, setDrawerCustomer] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [rematching, setRematching] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadOverview = useCallback(async () => {
    const [s, seg, tr, tp, rep, bd, an] = await Promise.all([
      supabase.rpc("fn_abandoned_summary"),
      supabase.rpc("fn_abandoned_segments"),
      supabase.rpc("fn_abandoned_trend", { p_days: trendDays }),
      supabase.rpc("fn_abandoned_top_products", { p_days: null, p_limit: 30 }),
      supabase.rpc("fn_abandoned_repeaters", { p_limit: 50 }),
      supabase.rpc("fn_abandoned_breakdowns"),
      supabase.rpc("fn_abandoned_anomaly_report"),
    ]);
    setSummary((s.data as Summary) ?? null);
    setSegments((seg.data as SegmentRow[]) ?? []);
    setTrend(((tr.data as TrendRow[]) ?? []).map((r) => ({ ...r, lost_value: r.lost_value ?? 0, avg_cart_value: r.avg_cart_value ?? 0 })));
    setTopProducts((tp.data as TopProduct[]) ?? []);
    setRepeaters((rep.data as Repeater[]) ?? []);
    setBreakdowns((bd.data as Breakdowns) ?? null);
    setAnomalies((an.data as AnomalyReport) ?? null);
    setLoading(false);
  }, [supabase, trendDays]);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  const listParams = useCallback((limit: number, offset: number) => ({
    p_segment: segment,
    p_status: statusFilters.length ? statusFilters : null,
    p_search: search || null,
    p_traffic: trafficFilters.length ? trafficFilters : null,
    p_min_value: minValue !== "" ? Number(minValue) : null,
    p_max_value: maxValue !== "" ? Number(maxValue) : null,
    p_order: order,
    p_limit: limit,
    p_offset: offset,
  }), [segment, statusFilters, search, trafficFilters, minValue, maxValue, order]);

  const loadCarts = useCallback(async () => {
    setCartsLoading(true);
    const { data } = await supabase.rpc("fn_abandoned_carts_list", listParams(PAGE_SIZE, page * PAGE_SIZE));
    const rows = (data as CartRow[]) ?? [];
    setCarts(rows);
    setFullCount(rows[0]?.full_count ?? 0);
    setCartsLoading(false);
  }, [supabase, listParams, page]);

  useEffect(() => { loadCarts(); }, [loadCarts]);

  async function toggleExpand(cart: CartRow) {
    if (expanded === cart.cart_key) { setExpanded(null); return; }
    setExpanded(cart.cart_key);
    if (!items[cart.cart_key] && cart.full_name && cart.created_at) {
      const { data } = await supabase
        .from("abandoned_cart_items")
        .select("item_key, sku, product_name, qty")
        .eq("cart_name", cart.full_name)
        .gte("created_at", new Date(new Date(cart.created_at).getTime() - 3600_000).toISOString())
        .lte("created_at", new Date(new Date(cart.created_at).getTime() + 3600_000).toISOString())
        .limit(50);
      setItems((prev) => ({ ...prev, [cart.cart_key]: (data as CartItem[]) ?? [] }));
    }
  }

  async function setStatus(cart: CartRow, status: string) {
    if (!canEdit) return;
    const email = (await supabase.auth.getUser()).data.user?.email ?? null;
    const patch: Record<string, unknown> = { recall_status: status, updated_at: new Date().toISOString() };
    if (status === "contacted") { patch.recalled_at = new Date().toISOString(); patch.recalled_by = email; }
    const { error } = await supabase.from("abandoned_carts").update(patch).eq("cart_key", cart.cart_key);
    if (error) { setMsg(error.message); return; }
    setCarts((prev) => prev.map((c) => (c.cart_key === cart.cart_key ? { ...c, recall_status: status } : c)));
  }

  async function rematch() {
    setRematching(true);
    const { data, error } = await supabase.rpc("fn_abandoned_link");
    setRematching(false);
    if (error) { setMsg(error.message); return; }
    const d = data as { matched_by_phone: number; matched_by_email: number; auto_recovered: number };
    setMsg(t("abRematchDone").replace("{a}", String(d.matched_by_phone)).replace("{b}", String(d.matched_by_email)).replace("{c}", String(d.auto_recovered)));
    loadOverview();
    loadCarts();
  }

  // pull every page of the current filter (RPC caps at 1000/page)
  async function fetchAllFiltered(): Promise<CartRow[]> {
    const all: CartRow[] = [];
    for (let off = 0; off < 60000; off += 1000) {
      const { data } = await supabase.rpc("fn_abandoned_carts_list", listParams(1000, off));
      const rows = (data as CartRow[]) ?? [];
      all.push(...rows);
      if (!rows.length || all.length >= (rows[0]?.full_count ?? 0)) break;
    }
    return all;
  }

  async function exportCsv() {
    setExporting(true);
    const all = await fetchAllFiltered();
    const rows = all.map((c) => ({
      name: c.customer_name ?? c.full_name, phone: c.phone, email: c.email,
      cart_value: c.cart_value, products: c.products_count, skus: (c.skus ?? []).join(" | "),
      created_at: c.created_at, age_days: c.age_days, status: c.recall_status,
      known_customer: c.customer_id ? "yes" : "no", past_orders: c.lifetime_orders,
      repeat_abandoner: c.is_repeat ? "yes" : "no", source: c.traffic_hint,
      recovered_order: c.recovered_order_number, city: c.customer_city,
    }));
    downloadCsv(`abandoned-${segment}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows as unknown as Record<string, unknown>[]));
    setExporting(false);
  }

  // Meta Custom Audience format: email + phone columns. Phones are digits-only
  // with country code — Meta accepts this and it survives the CSV formula-
  // injection guard (a leading + would get quoted).
  async function exportMeta() {
    setExporting(true);
    const all = await fetchAllFiltered();
    const seen = new Set<string>();
    const rows: { email: string; phone: string }[] = [];
    for (const c of all) {
      const phone = c.phone_norm ?? "";
      const email = c.email ?? "";
      if (!phone && !email) continue;
      const k = phone + "|" + email;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({ email, phone });
    }
    downloadCsv(`meta-audience-abandoned-${segment}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows as unknown as Record<string, unknown>[], ["email", "phone"]));
    setExporting(false);
  }

  function exportRows(name: string, rows: Record<string, unknown>[]) {
    if (!rows.length) return;
    downloadCsv(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
  }

  const DOW = lang === "ar"
    ? ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const hourData = useMemo(
    () => (breakdowns?.by_hour ?? []).map((h) => ({ label: `${h.hour}:00`, carts: h.carts })),
    [breakdowns]
  );
  const dowData = useMemo(
    () => (breakdowns?.by_dow ?? []).map((d) => ({ label: DOW[(d.dow - 1) % 7], carts: d.carts, value: Math.round(d.value) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [breakdowns, lang]
  );
  const bucketData = useMemo(
    () => (breakdowns?.by_bucket ?? []).map((b) => ({ label: b.bucket, carts: b.carts })),
    [breakdowns]
  );
  const trafficData = useMemo(
    () => (breakdowns?.by_traffic ?? []).map((s) => ({ source: t(TRAFFIC_KEY[s.source] ?? "abTrafficUnknown"), carts: s.carts })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [breakdowns, lang]
  );

  const insights = useMemo(() => {
    if (!summary) return [];
    const out: { icon: React.ElementType; text: string; tone: string }[] = [];
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
    if (summary.hot_reachable > 0)
      out.push({
        icon: Flame, tone: "text-red-600",
        text: lang === "ar"
          ? `${formatNumber(summary.hot_reachable)} سلة ساخنة (أقل من ٧ أيام) يمكن الوصول لأصحابها بقيمة ${formatMoney(summary.hot_value, lang)} — تواصل معهم الآن قبل أن تبرد`
          : `${formatNumber(summary.hot_reachable)} reachable hot carts (under 7 days) worth ${formatMoney(summary.hot_value, lang)} — contact them now before they go cold`,
      });
    if (summary.prospects > 0)
      out.push({
        icon: UserPlus, tone: "text-emerald-600",
        text: lang === "ar"
          ? `${formatNumber(summary.prospects)} عميل محتمل جديد (لديهم بيانات تواصل ولم يشتروا أبداً) — أفضل جمهور لاكتساب عملاء جدد عبر واتساب أو Meta`
          : `${formatNumber(summary.prospects)} new prospects (reachable, never purchased) — your best acquisition audience for WhatsApp or Meta`,
      });
    if (summary.guest_carts > 0)
      out.push({
        icon: Users, tone: "text-amber-600",
        text: lang === "ar"
          ? `${pct(summary.guest_carts, summary.total_carts)}٪ من السلال لزوار مجهولين — أضف حافزاً للتسجيل قبل الدفع (خصم أول طلب، حفظ السلة) لتقليل الفاقد`
          : `${pct(summary.guest_carts, summary.total_carts)}% of carts are anonymous guests — add a sign-in incentive before checkout (first-order discount, saved cart) to shrink the blind spot`,
      });
    const oos = topProducts.filter((p) => p.in_catalog && (p.ecom_stock ?? 0) <= 0).slice(0, 3);
    if (oos.length)
      out.push({
        icon: ShoppingBasket, tone: "text-red-600",
        text: lang === "ar"
          ? `منتجات كثيرة الترك ونافدة من المخزون: ${oos.map((p) => p.product_name ?? p.sku).join("، ")} — وفرها وأبلغ من تركوها`
          : `Top-abandoned products now out of stock: ${oos.map((p) => p.product_name ?? p.sku).join(", ")} — restock and notify their abandoners`,
      });
    if (summary.facebook_carts > 0)
      out.push({
        icon: Megaphone, tone: "text-blue-600",
        text: lang === "ar"
          ? `${formatNumber(summary.facebook_carts)} سلة جاءت من إعلانات فيسبوك ثم تُركت — صدّر جمهور Meta وشغّل حملة Retargeting بخصم بسيط`
          : `${formatNumber(summary.facebook_carts)} carts came from Facebook ads then got abandoned — export the Meta audience and run a retargeting campaign with a small discount`,
      });
    if (summary.repeat_abandoners > 0)
      out.push({
        icon: Repeat, tone: "text-violet-600",
        text: lang === "ar"
          ? `${formatNumber(summary.repeat_abandoners)} رقم هاتف ترك أكثر من سلة — نية شراء عالية جداً، اتصل بهم هاتفياً مباشرة`
          : `${formatNumber(summary.repeat_abandoners)} phone numbers abandoned more than one cart — very high intent, call them directly`,
      });
    if ((summary.anomaly_days ?? 0) > 0)
      out.push({
        icon: AlertTriangle, tone: "text-amber-600",
        text: lang === "ar"
          ? `تقرير "الإيرادات المفقودة" اليومي من المنصة مبالغ فيه دائماً (${formatMoney(summary.anomaly_days_value, lang)} في ${formatNumber(summary.anomaly_days)} يوماً شاذاً وحدها) — اعتمد على الرسم البياني المحسوب من سلالك الفعلية، وتجاهل أرقام المنصة اليومية`
          : `The platform's daily "revenue lost" report is chronically inflated (${formatMoney(summary.anomaly_days_value, lang)} across just ${formatNumber(summary.anomaly_days)} anomaly days) — trust the chart computed from your actual carts and ignore the platform's daily figures`,
      });
    if (summary.notified_carts > 0 && summary.recovered_carts >= 0)
      out.push({
        icon: CheckCircle2, tone: "text-slate-600",
        text: lang === "ar"
          ? `المتجر أرسل إشعاراً آلياً لـ ${formatNumber(summary.notified_carts)} سلة، واستُرد ${formatNumber(summary.recovered_carts)} (${pct(summary.recovered_carts, summary.total_carts)}٪) — المتابعة اليدوية عبر واتساب ترفع النسبة`
          : `The store auto-notified ${formatNumber(summary.notified_carts)} carts and ${formatNumber(summary.recovered_carts)} recovered (${pct(summary.recovered_carts, summary.total_carts)}%) — manual WhatsApp follow-up lifts this`,
      });
    return out;
  }, [summary, topProducts, lang]);

  if (loading) return <Spinner />;

  const noData = !summary || (summary.total_carts === 0 && summary.anomaly_carts === 0);

  return (
    <div>
      <PageHeader
        title={t("abandoned")}
        subtitle={t("abandonedSubtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <button className="btn-secondary" onClick={rematch} disabled={rematching} title={t("abRematchHint")}>
                <RefreshCw size={16} className={rematching ? "animate-spin" : ""} />
                {t("abRematch")}
              </button>
            )}
            <button className="btn-secondary" onClick={exportCsv} disabled={exporting || noData}>
              <Download size={16} />{t("abExportCsv")}
            </button>
            <button className="btn-primary" onClick={exportMeta} disabled={exporting || noData} title={t("abExportMetaHint")}>
              <Megaphone size={16} />{t("abExportMeta")}
            </button>
          </div>
        }
      />

      {msg && (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm text-emerald-800">
          <span>{msg}</span>
          <button onClick={() => setMsg("")}><X size={14} /></button>
        </div>
      )}

      {noData ? (
        <div className="card p-10 text-center">
          <ShoppingBasket className="mx-auto h-12 w-12 text-slate-300" />
          <div className="mt-3 text-slate-600">{t("abNoData")}</div>
          <Link href="/data-center" className="btn-primary mt-4 inline-flex">{t("abGoDataCenter")}</Link>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-2.5 text-[13px] text-emerald-800">
            <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
            {t("abCleanNote")}
          </div>

          {/* KPIs — real numbers only */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-3">
            <KpiCard label={t("abandoned")} value={formatNumber(summary.total_carts)} sub={`${t("abAvgCart")}: ${formatMoney(summary.avg_cart_value, lang)}`} />
            <KpiCard label={t("abValueAtRisk")} value={formatMoney(summary.total_value, lang)} accent="red" sub={`30d: ${formatNumber(summary.last30_carts)} · ${formatMoney(summary.last30_value, lang)}`} />
            <KpiCard label={t("abReachable")} value={formatNumber(summary.reachable_carts)} accent="green" sub={`${t("abReachableHint")} — ${formatMoney(summary.reachable_value, lang)}`} />
            <KpiCard label={t("abHotCarts")} value={formatNumber(summary.hot_carts)} accent="amber" sub={`${t("abHotHint")} — ${formatMoney(summary.hot_value, lang)}`} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-6">
            <KpiCard label={t("abKnownCustomers")} value={formatNumber(summary.known_customers)} sub={t("abSegKnown")} />
            <KpiCard label={t("abProspects")} value={formatNumber(summary.prospects)} accent="green" sub={t("abProspectsHint")} />
            <KpiCard label={t("abRecovered")} value={formatNumber(summary.recovered_carts)} accent="green" sub={`${t("abRecoveredValue")}: ${formatMoney(summary.recovered_value, lang)}`} />
            <KpiCard label={t("abRepeatAbandoners")} value={formatNumber(summary.repeat_abandoners)} accent="amber" sub={`${t("abFromFacebook")}: ${formatNumber(summary.facebook_carts)}`} />
          </div>

          {/* Recovery funnel */}
          <div className="card p-4 mb-6">
            <div className="text-sm font-bold mb-3">{t("abFunnel")}</div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {(["new", "contacted", "responded", "recovered"] as const).map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  {i > 0 && <span className="text-slate-300">←</span>}
                  <button
                    onClick={() => { setStatusFilters(statusFilters.length === 1 && statusFilters[0] === s ? [] : [s]); setPage(0); }}
                    className={cn("rounded-full px-3 py-1.5 font-semibold", STATUS_STYLE[s], statusFilters.includes(s) && "ring-2 ring-brand-400")}
                  >
                    {t(STATUS_KEY[s])}: {formatNumber(s === "new" ? summary.new_carts : s === "contacted" ? summary.contacted : s === "responded" ? summary.responded : summary.recovered_carts)}
                  </button>
                </div>
              ))}
              <span className="mx-2 text-slate-300">|</span>
              <button
                onClick={() => { setStatusFilters(statusFilters.length === 1 && statusFilters[0] === "lost" ? [] : ["lost"]); setPage(0); }}
                className={cn("rounded-full px-3 py-1.5 font-semibold", STATUS_STYLE.lost, statusFilters.includes("lost") && "ring-2 ring-brand-400")}
              >
                {t("abStatusLost")}: {formatNumber(summary.lost)}
              </button>
              <span className="ms-auto text-slate-400">
                {t("abNotifiedByPlatform")}: {formatNumber(summary.notified_carts)}
                {summary.last_import && <span className="ms-3">{t("abLastImport")}: {formatDate(summary.last_import)}</span>}
              </span>
            </div>
          </div>

          {/* Insights */}
          {insights.length > 0 && (
            <div className="card p-4 mb-6">
              <div className="text-sm font-bold mb-3 flex items-center gap-2"><Sparkles size={15} className="text-brand-600" />{t("abInsights")}</div>
              <div className="grid gap-2.5 lg:grid-cols-2">
                {insights.map((ins, i) => {
                  const Icon = ins.icon;
                  return (
                    <div key={i} className="flex items-start gap-2.5 rounded-lg bg-slate-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-700">
                      <Icon size={16} className={cn("mt-0.5 shrink-0", ins.tone)} />
                      {ins.text}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Trend */}
          <div className="grid gap-4 lg:grid-cols-2 mb-4">
            <ChartCard title={t("abTrendRealTitle")}>
              <div className="mb-2 flex items-center gap-1.5">
                {[30, 90, 180, 365, 3650].map((d) => (
                  <button key={d} onClick={() => setTrendDays(d)}
                    className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", trendDays === d ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
                    {d === 3650 ? "All" : `${d}d`}
                  </button>
                ))}
                <button className="ms-auto btn-secondary !py-1 !px-2 text-xs"
                  onClick={() => exportRows("abandoned-daily-trend", trend as unknown as Record<string, unknown>[])}>
                  <Download size={12} />CSV
                </button>
              </div>
              <TrendChart data={trend as unknown as Record<string, unknown>[]} xKey="day" series={[{ key: "lost_value", name: t("abTrendLost"), color: "#dc2626" }]} />
              <div className="mt-1 text-[11px] text-slate-400">{t("abTrendRealNote")}</div>
            </ChartCard>
            <ChartCard title={`${t("abTrendAvg")} / ${t("abTrendCarts")}`}>
              <div className="h-[28px]" />
              <TrendChart
                data={trend as unknown as Record<string, unknown>[]}
                xKey="day"
                type="line"
                series={[
                  { key: "avg_cart_value", name: t("abTrendAvg"), color: "#2b3990" },
                  { key: "carts", name: t("abTrendCarts"), color: "#4e7f76" },
                ]}
              />
            </ChartCard>
          </div>

          {/* Behavior breakdowns */}
          <div className="grid gap-4 lg:grid-cols-2 mb-6">
            <ChartCard title={t("abByHour")}>
              <BarsChart data={hourData as unknown as Record<string, unknown>[]} xKey="label" series={[{ key: "carts", name: t("abTrendCarts"), color: "#2b3990" }]} height={240} />
            </ChartCard>
            <ChartCard title={t("abByDow")}>
              <BarsChart data={dowData as unknown as Record<string, unknown>[]} xKey="label" series={[{ key: "carts", name: t("abTrendCarts"), color: "#4e7f76" }]} height={240} />
            </ChartCard>
            <ChartCard title={t("abByBucket")}>
              <BarsChart data={bucketData as unknown as Record<string, unknown>[]} xKey="label" series={[{ key: "carts", name: t("abTrendCarts"), color: "#b45309" }]} height={240} />
            </ChartCard>
            <ChartCard title={t("abByTraffic")}>
              <DonutChart data={trafficData as unknown as Record<string, unknown>[]} nameKey="source" valueKey="carts" height={240} />
            </ChartCard>
          </div>

          {/* Segments */}
          <h2 className="mb-3 text-lg font-bold">{t("abSegments")}</h2>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6 mb-6">
            {SEGMENTS.map((s) => {
              const row = segments.find((x) => x.segment === s.key);
              const Icon = s.icon;
              const active = segment === s.key;
              if (s.key !== "all" && !row) return null;
              return (
                <button key={s.key} onClick={() => { setSegment(s.key); setPage(0); }}
                  className={cn("card p-3 text-start transition hover:shadow-md", active && "ring-2 ring-brand-500")}>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                    <Icon size={13} className={active ? "text-brand-600" : "text-slate-400"} />
                    {t(s.labelKey)}
                  </div>
                  <div className="mt-1 text-lg font-bold">{s.key === "all" ? formatNumber(summary.total_carts) : formatNumber(row?.carts ?? 0)}</div>
                  {s.key !== "all" && row && (
                    <div className="text-[11px] text-slate-500">
                      {formatMoney(row.total_value, lang)}
                      {row.reachable > 0 && <span className="ms-1 text-emerald-600">· {formatNumber(row.reachable)} ✆</span>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Cart browser + filters */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold me-2">{t("abCartBrowser")}</h2>
            <MultiSelect
              options={["new", "contacted", "responded", "recovered", "lost", "excluded"]}
              values={statusFilters}
              onChange={(v) => { setStatusFilters(v); setPage(0); }}
              placeholder={t("abFilterStatus")}
              getLabel={(v) => t(STATUS_KEY[v] ?? "abStatusNew")}
              className="w-40"
            />
            <MultiSelect
              options={["direct", "facebook", "google", "tiktok", "other_campaign", "unknown"]}
              values={trafficFilters}
              onChange={(v) => { setTrafficFilters(v); setPage(0); }}
              placeholder={t("abFilterTraffic")}
              getLabel={(v) => t(TRAFFIC_KEY[v] ?? "abTrafficUnknown")}
              className="w-40"
            />
            <input type="number" min={0} value={minValue} onChange={(e) => { setMinValue(e.target.value); setPage(0); }}
              placeholder={t("abMinValue")} className="input !w-28" dir="ltr" />
            <input type="number" min={0} value={maxValue} onChange={(e) => { setMaxValue(e.target.value); setPage(0); }}
              placeholder={t("abMaxValue")} className="input !w-28" dir="ltr" />
            <select value={order} onChange={(e) => { setOrder(e.target.value); setPage(0); }} className="input !w-auto" title={t("abSortLbl")}>
              {SORTS.map((s) => <option key={s.key} value={s.key}>{t(s.labelKey)}</option>)}
            </select>
            <form
              className="relative ms-auto"
              onSubmit={(e) => { e.preventDefault(); setSearch(searchDraft); setPage(0); }}
            >
              <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
              <input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder={t("abSearchPh")}
                className="input !ps-9 w-64 max-w-full"
              />
            </form>
            <span className="text-xs text-slate-500">
              {t("abShowingOf").replace("{x}", formatNumber(carts.length)).replace("{y}", formatNumber(fullCount))}
            </span>
          </div>

          <div className="card overflow-x-auto mb-6">
            {cartsLoading ? (
              <Spinner />
            ) : carts.length === 0 ? (
              <EmptyState message={t("noResults")} />
            ) : (
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t("customer")}</th>
                    <th>{t("abProducts")}</th>
                    <th>{t("abCartValue")}</th>
                    <th>{t("abCartAge")}</th>
                    <th>{t("status")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {carts.map((c) => {
                    const isOpen = expanded === c.cart_key;
                    const cartItems = items[c.cart_key];
                    const wa = abandonedCartLink(
                      c.phone,
                      {
                        customerName: c.customer_name ?? (c.is_guest ? null : c.full_name),
                        products: (cartItems ?? []).map((i) => i.product_name ?? "").filter(Boolean),
                        cartValue: c.cart_value,
                      },
                      lang
                    );
                    return (
                      <Fragment key={c.cart_key}>
                        <tr className={cn(isOpen && "bg-slate-50")}>
                          <td>
                            <div className="flex items-center gap-1.5 font-medium">
                              {c.customer_id ? (
                                <button
                                  className="flex items-center gap-1 text-brand-700 hover:underline"
                                  onClick={() => setDrawerCustomer(c.customer_id)}
                                  title={t("abViewCustomer")}
                                >
                                  <User size={13} />
                                  {c.customer_name ?? c.full_name ?? c.customer_id}
                                </button>
                              ) : (
                                <span>{c.full_name ?? "—"}</span>
                              )}
                              {c.customer_id && <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">{t("abSegKnown")}</span>}
                              {c.is_repeat && <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">{t("abSegRepeat")}</span>}
                              {c.traffic_hint === "facebook" && <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">FB</span>}
                              {c.is_anomaly && <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">{t("abExcludedFromStats")}</span>}
                            </div>
                            <div className="text-xs text-slate-400" dir="ltr">{c.phone ?? c.email ?? ""}</div>
                            {(c.lifetime_orders ?? 0) > 0 && (
                              <div className="text-[11px] text-slate-500">{t("abLifetimeOrders")}: {formatNumber(c.lifetime_orders)}{c.customer_city ? ` · ${c.customer_city}` : ""}</div>
                            )}
                          </td>
                          <td>
                            <button className="flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline" onClick={() => toggleExpand(c)}>
                              {formatNumber(c.products_count)} {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>
                          </td>
                          <td className="font-bold">{formatMoney(c.cart_value, lang)}</td>
                          <td>
                            <div className="text-sm">{formatNumber(Math.round(c.age_days))} {t("abDays")}</div>
                            <div className="text-[11px] text-slate-400">{formatDate(c.created_at)}</div>
                          </td>
                          <td>
                            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", STATUS_STYLE[c.recall_status])}>
                              {t(STATUS_KEY[c.recall_status] ?? "abStatusNew")}
                            </span>
                            {c.recovered_order_number && (
                              <div className="mt-0.5 text-[11px] text-emerald-700" dir="ltr">#{c.recovered_order_number} · {formatMoney(c.recovered_value, lang)}</div>
                            )}
                          </td>
                          <td>
                            <div className="flex items-center gap-1.5">
                              {wa && (
                                <a href={wa} target="_blank" rel="noopener noreferrer"
                                  onClick={() => c.recall_status === "new" && setStatus(c, "contacted")}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                                  title={t("abWhatsappRecall")}>
                                  <PhoneOutgoing size={13} />
                                  {t("abWhatsappRecall")}
                                </a>
                              )}
                              {!wa && (c.phone || c.email) && (
                                <ContactActions phone={c.phone} email={c.email} name={c.full_name} />
                              )}
                              {canEdit && c.recall_status !== "recovered" && (
                                <button className="btn-secondary !py-1 !px-2 text-xs" onClick={() => setStatus(c, "recovered")}>{t("abMarkRecovered")}</button>
                              )}
                              {canEdit && !["lost", "recovered"].includes(c.recall_status) && (
                                <button className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title={t("abMarkLost")} onClick={() => setStatus(c, "lost")}>
                                  <X size={14} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-slate-50">
                            <td colSpan={6} className="!py-3">
                              <div className="text-xs font-bold text-slate-500 mb-1.5">{t("abItemsInCart")}</div>
                              {!cartItems ? (
                                <Spinner />
                              ) : cartItems.length === 0 ? (
                                <div className="text-xs text-slate-400" dir="ltr">{(c.skus ?? []).join(" · ") || "—"}</div>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {cartItems.map((i) => (
                                    <span key={i.item_key} className="rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-xs">
                                      {i.product_name ?? i.sku}
                                      {(i.qty ?? 1) > 1 && <b className="ms-1 text-brand-700">×{i.qty}</b>}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {c.web_url && (
                                <a href={c.web_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-brand-600 hover:underline" dir="ltr">
                                  <ExternalLink size={12} />{t("abOpenCartUrl")}
                                </a>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {fullCount > PAGE_SIZE && (
            <div className="mb-8 flex items-center justify-center gap-3 text-sm">
              <button className="btn-secondary !py-1.5" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
              <span>{page + 1} / {Math.ceil(fullCount / PAGE_SIZE)}</span>
              <button className="btn-secondary !py-1.5" disabled={(page + 1) * PAGE_SIZE >= fullCount} onClick={() => setPage(page + 1)}>›</button>
            </div>
          )}

          {/* Top abandoned products + repeaters */}
          <div className="grid gap-4 xl:grid-cols-2 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-lg font-bold">{t("abTopProducts")}</h2>
                <button className="ms-auto btn-secondary !py-1 !px-2 text-xs"
                  onClick={() => exportRows("abandoned-top-products", topProducts as unknown as Record<string, unknown>[])}>
                  <Download size={12} />CSV
                </button>
              </div>
              <div className="mb-3 text-xs text-slate-500">{t("abTopProductsHint")}</div>
              <div className="card overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr><th>{t("abProducts")}</th><th>{t("abCartsCount")}</th><th>{t("abQty")}</th><th>{t("stock")}</th></tr>
                  </thead>
                  <tbody>
                    {topProducts.map((p) => (
                      <tr key={p.sku}>
                        <td>
                          <div className="font-medium !whitespace-normal max-w-[16rem]">{p.product_name ?? p.sku}</div>
                          <div className="text-[11px] text-slate-400" dir="ltr">{p.sku}</div>
                        </td>
                        <td className="font-bold">{formatNumber(p.carts)}</td>
                        <td>{formatNumber(p.total_qty)}</td>
                        <td>
                          {!p.in_catalog ? (
                            <span className="text-xs text-slate-400">—</span>
                          ) : (p.ecom_stock ?? 0) > 0 ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">{t("abInStock")} {formatNumber(p.ecom_stock)}</span>
                          ) : (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">{t("abOutOfStock")}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-lg font-bold">{t("abRepeatersTitle")}</h2>
                <button className="ms-auto btn-secondary !py-1 !px-2 text-xs"
                  onClick={() => exportRows("abandoned-repeaters", repeaters as unknown as Record<string, unknown>[])}>
                  <Download size={12} />CSV
                </button>
              </div>
              <div className="mb-3 text-xs text-slate-500">{t("abRepeatersHint")}</div>
              <div className="card overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr><th>{t("customer")}</th><th>{t("abCartsCount")}</th><th>{t("abCartValue")}</th><th>{t("date")}</th><th></th></tr>
                  </thead>
                  <tbody>
                    {repeaters.map((r) => (
                      <tr key={r.phone_norm}>
                        <td>
                          {r.customer_id ? (
                            <button className="flex items-center gap-1 font-medium text-brand-700 hover:underline"
                              onClick={() => setDrawerCustomer(r.customer_id)} title={t("abViewCustomer")}>
                              <User size={13} />
                              {r.full_name ?? r.customer_id}
                            </button>
                          ) : (
                            <div className="font-medium">{r.full_name ?? "—"}</div>
                          )}
                          <div className="text-xs text-slate-400" dir="ltr">+{r.phone_norm}</div>
                        </td>
                        <td className="font-bold">{formatNumber(r.carts)}</td>
                        <td>{formatMoney(r.total_value, lang)}</td>
                        <td className="text-xs text-slate-500">{formatDate(r.last_abandoned)}</td>
                        <td>
                          <ContactActions phone={"+" + r.phone_norm} email={r.email} name={r.full_name} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Separated anomaly / test-data report */}
          {anomalies && (anomalies.carts.length > 0 || anomalies.days.length > 0) && (
            <div className="card border-red-100 mb-8">
              <button
                className="flex w-full items-center gap-2 p-4 text-start"
                onClick={() => setShowAnomalies(!showAnomalies)}
              >
                <AlertTriangle size={18} className="text-red-500 shrink-0" />
                <div className="flex-1">
                  <div className="font-bold">{t("abAnomalyReport")}</div>
                  <div className="text-xs text-slate-500">
                    {formatNumber(anomalies.carts.length)} {t("abCartsLbl")} · {formatMoney(anomalies.carts_value, lang)}
                    <span className="mx-1.5">|</span>
                    {formatNumber(anomalies.days.length)} {t("abAnomalyDaysTbl").toLowerCase()} · {formatMoney(anomalies.days_value, lang)}
                  </div>
                </div>
                {showAnomalies ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {showAnomalies && (
                <div className="border-t border-slate-100 p-4">
                  <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-red-800">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    {t("abAnomalyNote")}
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-sm font-bold">{t("abAnomalyCartsTbl")}</h3>
                        <button className="ms-auto btn-secondary !py-1 !px-2 text-xs"
                          onClick={() => exportRows("abandoned-anomaly-carts", anomalies.carts as unknown as Record<string, unknown>[])}>
                          <Download size={12} />CSV
                        </button>
                      </div>
                      <div className="card overflow-x-auto">
                        <table className="table-base">
                          <thead>
                            <tr><th>{t("customer")}</th><th>{t("abProducts")}</th><th>{t("abCartValue")}</th><th>{t("date")}</th><th>{t("abReason")}</th></tr>
                          </thead>
                          <tbody>
                            {anomalies.carts.map((c) => (
                              <tr key={c.cart_key}>
                                <td>
                                  <div className="font-medium">{c.full_name ?? "—"}</div>
                                  <div className="text-xs text-slate-400" dir="ltr">{c.phone ?? c.email ?? c.user_ip ?? ""}</div>
                                </td>
                                <td>{formatNumber(c.products_count)}</td>
                                <td className="font-bold text-red-700">{formatMoney(c.cart_value, lang)}</td>
                                <td className="text-xs text-slate-500">{formatDate(c.created_at)}</td>
                                <td>
                                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                    {c.reason === "huge_value" ? t("abReasonHuge") : t("abReasonBulk")}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-sm font-bold">{t("abAnomalyDaysTbl")}</h3>
                        <button className="ms-auto btn-secondary !py-1 !px-2 text-xs"
                          onClick={() => exportRows("abandoned-anomaly-days", anomalies.days as unknown as Record<string, unknown>[])}>
                          <Download size={12} />CSV
                        </button>
                      </div>
                      <div className="card overflow-x-auto">
                        <table className="table-base">
                          <thead>
                            <tr><th>{t("date")}</th><th>{t("abPlatformCol")}</th><th>{t("abRealCol")}</th><th>{t("abAvgCart")}</th></tr>
                          </thead>
                          <tbody>
                            {anomalies.days.map((d) => (
                              <tr key={d.day}>
                                <td dir="ltr">{formatDate(d.day)}</td>
                                <td className="font-bold text-red-700">{formatMoney(d.lost_value, lang)}</td>
                                <td className="font-bold text-emerald-700">{formatMoney(d.real_value, lang)}</td>
                                <td>{formatMoney(d.avg_cart_value, lang)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <CustomerDrawer customerId={drawerCustomer} onClose={() => setDrawerCustomer(null)} />
    </div>
  );
}
