"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { Download, Info, FileSpreadsheet, ClipboardCheck, Check, Trash2, X, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { PageHeader, Spinner, EmptyState, KpiCard, SortTh, useSort } from "@/components/ui";
import { MultiSelect } from "@/components/multi-select";
import { SearchBox } from "@/components/search-box";
import { StockForecast } from "@/components/stock-forecast";
import { formatNumber, formatMoney, formatDate, toCsv, downloadCsv, cn } from "@/lib/utils";
import { confirmDialog, notifyDialog } from "@/components/dialog";

interface EngineRow {
  sku: string;
  product_name: string;
  category: string | null;
  units: number;
  velocity: number;
  forecast: number;
  min_applied: number;
  target: number;
  ecom_stock: number | null;
  sap_stock: number | null;
  cover_days: number | null;
  need: number;
  move_qty: number;
  shortfall: number;
  surplus: number | null;
  status: "move" | "low_sap" | "oos_reorder" | "overstock" | "relist" | "never_listed" | "inactive" | "ok";
  vendor: string | null;
  cost: number | null;
  avg_price: number | null;
  // full history, so a book that ran out months ago can still be judged
  lifetime_units: number;
  last_order_date: string | null;
  // the rate it sold at across its whole selling life — the only rate a
  // book that has been quiet for a month still has
  hist_velocity: number;
  // demand over the cover window at the better of the two rates
  expected: number;
  // stock held for a reason: a live campaign is pointing at this book
  on_ads: boolean;
  ad_spend: number;
  // 99,996 on the store is the platform saying "print on demand"
  is_unlimited: boolean;
  never_sold: boolean;
  // sold faster in the last week than over the window, so the week set
  // the velocity — the back-to-school signal Mai's list caught by eye
  recent_units: number;
  surge: boolean;
  // the store's own switch: an inactive SKU is nobody's move
  is_active: boolean;
  // and the store's own reason, when the export carried one
  ecom_note: string | null;
}

interface MoveList {
  id: string;
  list_number: string;
  status: "pending" | "moved" | "cancelled";
  notes: string | null;
  created_by_email: string | null;
  created_at: string;
}
interface MoveItem { list_id: string; sku: string; product_name: string | null; qty: number; shortfall: number; }
interface Snap { snapshot_date: string; ecom_stock: number | null; sap_stock: number | null; }
// each side is counted by its own file, so each carries its own date — a
// single "stock updated" stamp hid a warehouse count that was a week old
interface Freshness { side: "ecom" | "sap"; taken_at: string | null; skus: number; in_stock: number; units: number; }

const STATUS_META: Record<string, { key: DictKey; style: string }> = {
  move: { key: "statusMove", style: "bg-emerald-100 text-emerald-800" },
  low_sap: { key: "statusLowSap", style: "bg-amber-100 text-amber-800" },
  oos_reorder: { key: "statusOos", style: "bg-red-100 text-red-700" },
  overstock: { key: "statusOverstock", style: "bg-blue-100 text-blue-800" },
  relist: { key: "statusRelist", style: "bg-violet-100 text-violet-800" },
  never_listed: { key: "statusNeverListed", style: "bg-teal-100 text-teal-800" },
  inactive: { key: "statusInactive", style: "bg-slate-200 text-slate-500 line-through" },
  ok: { key: "statusOk", style: "bg-slate-100 text-slate-600" },
};

// The engine returns ~4,500 rows and the table is not virtualised, so it
// paints a page at a time. Every export ignores this — it is a rendering
// budget, never a filter.
const PAGE_ROWS = 500;

const ML_META: Record<string, { key: DictKey; style: string }> = {
  pending: { key: "mlPending", style: "bg-amber-100 text-amber-800" },
  moved: { key: "mlMoved", style: "bg-emerald-100 text-emerald-800" },
  cancelled: { key: "mlCancelled", style: "bg-slate-100 text-slate-600" },
};

type Tab = "replenish" | "relist" | "overstock" | "oos" | "inactive" | "forecast" | "all" | "lists";

// The "In warehouse, not on store" tab holds two different problems: a
// book the store used to carry and now reads zero on (relist it), and a
// book the store has never carried at all (list it for the first time).
// They want different decisions, so the tab can be split.
type WnsGroup = "all" | "relist" | "never_listed";

// Who the shelf floor applies to.
type MinScope = "listed" | "sold_ever" | "selling";

// The engine's tuning knobs, fixed. They were all on the page for a week
// and the verdict was "too many options": what stays as a control is
// policy — window, cover, the floor and who it applies to, the bestseller
// floor, and the SAP quantity below which a trip is not worth making —
// and the rest is plumbing with one right answer for this business:
const ENGINE = {
  // a bestseller is one that sold this many in the window
  bestsellerUnits: 20,
  // a book at zero on the store comes back with at least this many
  relistQty: 10,
  // ads are out of the picture for now; the engine keeps the join
  adDays: 0,
  // the store's 99,996 "print on demand" marker
  unlimitedAt: 5000,
  // a surplus below this is not worth a report line
  overstockMin: 20,
  // a top-up smaller than this onto a shelf already holding that many is
  // a trip for nothing
  minMoveLine: 5,
  // this week's pace beats the month's once 5 copies sold in it
  recentDays: 7,
  surgeMin: 5,
} as const;

// bumped again: the v2 blob carries the knobs above as user settings and
// would fight the constants
const SETTINGS_KEY = "nm-stock-engine-settings-v3";

// a typed number settles before it is sent — the input stays live, the
// engine sees the final value once
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function coverClass(days: number | null): string {
  if (days == null) return "";
  if (days < 7) return "text-red-600 font-semibold";
  if (days < 15) return "text-amber-600 font-semibold";
  return "";
}

export default function StockPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  // the settings that decide what the page asks for
  const [windowDays, setWindowDays] = useState(30);
  const [coverDays, setCoverDays] = useState(15);
  // no listed book that has sold sits below this on the store
  const [globalMin, setGlobalMin] = useState(20);
  const [minScope, setMinScope] = useState<MinScope>("sold_ever");
  // a bestseller is floored here instead
  const [bestsellerMin, setBestsellerMin] = useState(50);
  // SAP below this is not worth a warehouse trip: no move line, no entry in
  // a move list — the shortfall still shows because purchasing still needs it
  const [minSapMove, setMinSapMove] = useState(2);
  // no single move line above this, however deep SAP is
  const [maxOrder, setMaxOrder] = useState(100);
  const [settingsReady, setSettingsReady] = useState(false);
  const [rows, setRows] = useState<EngineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("replenish");
  const [wnsGroup, setWnsGroup] = useState<WnsGroup>("all");
  const [neverSoldOnly, setNeverSoldOnly] = useState(false);
  const [pageRows, setPageRows] = useState(PAGE_ROWS);
  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);

  // ?filter=/?q= deep links so alerts can land on the right tab already
  // narrowed (e.g. the stockouts alert opens /stock?filter=oos, and the
  // "traffic on an out-of-stock book" alarm adds &q=<book name>)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const f = sp.get("filter");
    if (["oos", "overstock", "replenish", "relist", "inactive", "forecast", "all", "lists"].includes(f ?? "")) setTab(f as Tab);
    const q = sp.get("q");
    if (q) setSearch(q);
  }, []);
  const { sort, toggle, apply } = useSort<EngineRow>();
  const [moveEdits, setMoveEdits] = useState<Record<string, string>>({});
  const [hasStockData, setHasStockData] = useState(false);
  const [freshness, setFreshness] = useState<Freshness[]>([]);
  const [moveLists, setMoveLists] = useState<MoveList[]>([]);
  const [moveItems, setMoveItems] = useState<Record<string, MoveItem[]>>({});
  const [savingList, setSavingList] = useState(false);
  const [histSku, setHistSku] = useState<{ sku: string; name: string } | null>(null);
  const [histRows, setHistRows] = useState<Snap[] | null>(null);

  // Restore saved engine settings once, before the first engine call
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
      if (s) {
        if (s.windowDays) setWindowDays(s.windowDays);
        if (s.coverDays) setCoverDays(s.coverDays);
        if (s.globalMin != null) setGlobalMin(s.globalMin);
        if (s.minScope) setMinScope(s.minScope);
        if (s.bestsellerMin != null) setBestsellerMin(s.bestsellerMin);
        if (s.minSapMove != null) setMinSapMove(s.minSapMove);
        if (s.maxOrder) setMaxOrder(s.maxOrder);
      }
    } catch {}
    setSettingsReady(true);
  }, []);

  // The three typed numbers fire the engine on every keystroke otherwise:
  // "150" is three engine runs. Debounce what goes to the server; the
  // inputs themselves stay live.
  const debouncedMin = useDebounced(globalMin, 500);
  const debouncedBestseller = useDebounced(bestsellerMin, 500);
  const debouncedMaxOrder = useDebounced(maxOrder, 500);

  // fn_stock_engine_json, not fn_stock_engine: PostgREST truncates every
  // table-returning response at 1,000 rows without saying so, and the
  // engine returns ~4,500 — the tail it silently dropped is exactly the
  // rows with need = 0, which is what relist and overstock are made of.
  // One jsonb value is one row, so the cap never applies, and the engine
  // runs once instead of the five times paging would cost.
  // A change of settings while a call is in flight makes the older answer
  // worthless; the counter lets a late response know it lost.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    const { data, error } = await supabase.rpc("fn_stock_engine_json", {
      p_window_days: windowDays,
      p_coverage_days: coverDays,
      p_global_min: debouncedMin,
      p_bestseller_min: debouncedBestseller,
      p_bestseller_units: ENGINE.bestsellerUnits,
      p_max_order: debouncedMaxOrder,
      p_min_sap_move: minSapMove,
      p_relist_qty: ENGINE.relistQty,
      p_ad_days: ENGINE.adDays,
      p_unlimited_at: ENGINE.unlimitedAt,
      p_overstock_min: ENGINE.overstockMin,
      p_min_scope: minScope,
      p_min_move_line: ENGINE.minMoveLine,
      p_recent_days: ENGINE.recentDays,
      p_surge_min: ENGINE.surgeMin,
    });
    if (seq !== loadSeq.current) return;
    if (error) console.error("fn_stock_engine_json", error);
    const list = (data as EngineRow[] | null) ?? [];
    setRows(list);
    setHasStockData(list.some((r) => r.ecom_stock !== null || r.sap_stock !== null));
    setLoading(false);
  }, [supabase, windowDays, coverDays, debouncedMin, minScope, debouncedBestseller, minSapMove, debouncedMaxOrder]);

  useEffect(() => {
    if (!settingsReady) return;
    load();
  }, [settingsReady, load]);

  useEffect(() => {
    if (!settingsReady) return;
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ windowDays, coverDays, globalMin, minScope, bestsellerMin, minSapMove, maxOrder })
      );
    } catch {}
  }, [settingsReady, windowDays, coverDays, globalMin, minScope, bestsellerMin, minSapMove, maxOrder]);

  const loadMoveLists = useCallback(async () => {
    const { data } = await supabase.from("stock_move_lists").select("*").order("created_at", { ascending: false }).limit(50);
    const lists = (data as MoveList[]) ?? [];
    setMoveLists(lists);
    if (lists.length) {
      const { data: its } = await supabase.from("stock_move_items").select("*").in("list_id", lists.map((l) => l.id));
      const map: Record<string, MoveItem[]> = {};
      for (const it of (its as MoveItem[]) ?? []) (map[it.list_id] ??= []).push(it);
      setMoveItems(map);
    }
  }, [supabase]);

  useEffect(() => {
    loadMoveLists();
    supabase.rpc("fn_stock_freshness").then(({ data }) => setFreshness((data as Freshness[] | null) ?? []));
  }, [supabase, loadMoveLists]);

  const staleDaysOf = useCallback(
    (at: string | null) => (at ? Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000) : null),
    []
  );

  const effMove = useCallback(
    (r: EngineRow) => {
      const edit = moveEdits[r.sku];
      if (edit !== undefined && edit !== "") {
        const n = parseInt(edit, 10);
        if (!isNaN(n)) return n;
      }
      return r.move_qty;
    },
    [moveEdits]
  );

  // Unit value: real cost when uploaded, otherwise recent avg selling price
  const unitValue = useCallback((r: EngineRow) => r.cost ?? r.avg_price ?? 0, []);

  const vendors = useMemo(
    () => Array.from(new Set(rows.map((r) => r.vendor).filter(Boolean) as string[])).sort(),
    [rows]
  );
  const categories = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category).filter(Boolean) as string[])).sort(),
    [rows]
  );

  // search + vendor + category, before any tab narrows it — the same list
  // the tab filters slice up, and what tells us a hit is hiding elsewhere
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (q) list = list.filter((r) => r.product_name?.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q));
    if (vendorFilter.length) list = list.filter((r) => r.vendor != null && vendorFilter.includes(r.vendor));
    if (categoryFilter.length) list = list.filter((r) => r.category != null && categoryFilter.includes(r.category));
    if (neverSoldOnly) list = list.filter((r) => r.never_sold);
    return list;
  }, [rows, search, vendorFilter, categoryFilter, neverSoldOnly]);

  const filtered = useMemo(() => {
    const list = searched;
    if (tab === "replenish") return list.filter((r) => ["move", "low_sap"].includes(r.status) || (!hasStockData && r.need > 0));
    if (tab === "relist")
      return list.filter((r) =>
        wnsGroup === "all"
          ? r.status === "relist" || r.status === "never_listed"
          : r.status === wnsGroup
      );
    if (tab === "overstock") return list.filter((r) => r.status === "overstock");
    if (tab === "oos") return list.filter((r) => r.status === "oos_reorder");
    if (tab === "inactive") return list.filter((r) => r.status === "inactive");
    return list;
  }, [searched, tab, hasStockData, wnsGroup]);

  const sorted = useMemo(
    () =>
      apply(filtered, {
        units: (r) => r.units,
        velocity: (r) => r.velocity,
        target: (r) => r.target,
        ecom: (r) => r.ecom_stock,
        sap: (r) => r.sap_stock,
        move: (r) => effMove(r),
        shortfall: (r) => r.shortfall,
        surplus: (r) => r.surplus,
        cover: (r) => r.cover_days,
        lifetime: (r) => r.lifetime_units,
        lastsale: (r) => r.last_order_date,
        expected: (r) => r.expected,
        adspend: (r) => r.ad_spend,
        value: (r) =>
          unitValue(r) *
          (tab === "overstock"
            ? (r.surplus ?? 0)
            : tab === "inactive"
              ? (r.sap_stock ?? 0) + (r.ecom_stock ?? 0)
              : effMove(r)),
      }),
    [filtered, apply, tab, effMove, unitValue]
  );

  // A rendering budget, not a filter: every export below reads `sorted`.
  const visible = useMemo(() => sorted.slice(0, pageRows), [sorted, pageRows]);

  // reset the window whenever the set under it changes, so a narrowed
  // search does not open already scrolled 3,000 rows deep
  useEffect(() => setPageRows(PAGE_ROWS), [tab, wnsGroup, search, vendorFilter, categoryFilter, neverSoldOnly]);

  const kpis = useMemo(() => {
    const moveRows = rows.filter((r) => ["move", "low_sap"].includes(r.status));
    const overRows = rows.filter((r) => r.status === "overstock");
    const relistRows = rows.filter((r) => r.status === "relist");
    const neverListedRows = rows.filter((r) => r.status === "never_listed");
    const inactiveRows = rows.filter((r) => r.status === "inactive");
    return {
      inactive: inactiveRows.length,
      // warehouse copies sitting behind switched-off listings — the number
      // that decides whether the tab is housekeeping or money
      inactiveSap: inactiveRows.reduce((s, r) => s + (r.sap_stock ?? 0), 0),
      toMove: moveRows.reduce((s, r) => s + effMove(r), 0),
      moveSkus: moveRows.length,
      shortfall: rows.reduce((s, r) => s + (r.shortfall ?? 0), 0),
      oos: rows.filter((r) => r.status === "oos_reorder").length,
      overstock: overRows.length,
      moveValue: moveRows.reduce((s, r) => s + effMove(r) * unitValue(r), 0),
      overstockValue: overRows.reduce((s, r) => s + (r.surplus ?? 0) * unitValue(r), 0),
      relist: relistRows.length,
      relistUnits: relistRows.reduce((s, r) => s + (r.sap_stock ?? 0), 0),
      neverListed: neverListedRows.length,
      neverListedUnits: neverListedRows.reduce((s, r) => s + (r.sap_stock ?? 0), 0),
    };
  }, [rows, effMove, unitValue]);

  // The move list is built from what is on screen, so a vendor filter, a
  // search or the relist tab each save their own list. Any quantity above
  // zero counts, engine-proposed or typed in by hand — that is how a book
  // the engine scores at zero still gets moved. What the warehouse cannot
  // serve is dropped and reported, never saved silently.
  const listCandidates = useMemo(
    // a switched-off book cannot be moved from any tab, typed qty or not
    () => filtered.filter((r) => r.is_active !== false && effMove(r) > 0 && (r.sap_stock ?? 0) >= minSapMove),
    [filtered, effMove, minSapMove]
  );

  async function saveMoveList() {
    const skipped = filtered.filter((r) => r.is_active !== false && effMove(r) > 0 && (r.sap_stock ?? 0) < minSapMove).length;
    const items = listCandidates.map((r) => ({
      sku: r.sku,
      product_name: r.product_name,
      qty: effMove(r),
      shortfall: Math.round(r.shortfall ?? 0),
    }));
    if (!items.length) {
      await notifyDialog(t("moveListEmpty"));
      return;
    }
    const note = skipped ? `\n${skipped} ${t("moveListSapSkipped")}` : "";
    if (!await confirmDialog(`${t("moveListConfirmQ")} ${items.length} ${t("moveListConfirmEnd")}${note}`)) return;
    setSavingList(true);
    try {
      const { data: num, error: numErr } = await supabase.rpc("fn_next_move_list_number");
      if (numErr) throw numErr;
      const { data: { user } } = await supabase.auth.getUser();
      const { data: list, error: listErr } = await supabase
        .from("stock_move_lists")
        .insert({ list_number: num as string, created_by_email: user?.email ?? null })
        .select()
        .single();
      if (listErr) throw listErr;
      const { error: itemsErr } = await supabase
        .from("stock_move_items")
        .insert(items.map((i) => ({ ...i, list_id: (list as MoveList).id })));
      if (itemsErr) throw itemsErr;
      await loadMoveLists();
      setTab("lists");
      await notifyDialog(`${num} — ${t("moveListSavedMsg")}`);
    } catch (e) {
      await notifyDialog((e as Error).message);
    } finally {
      setSavingList(false);
    }
  }

  async function setListStatus(list: MoveList, status: MoveList["status"]) {
    await supabase.from("stock_move_lists").update({ status, updated_at: new Date().toISOString() }).eq("id", list.id);
    loadMoveLists();
  }

  async function deleteList(list: MoveList) {
    if (!await confirmDialog(`${list.list_number} — ${t("mlDeleteConfirm")}`)) return;
    await supabase.from("stock_move_lists").delete().eq("id", list.id);
    loadMoveLists();
  }

  function exportList(list: MoveList) {
    const its = moveItems[list.id] ?? [];
    if (!its.length) return;
    downloadCsv(
      `${list.list_number}.csv`,
      toCsv(its.map((i) => ({ Sku: i.sku, "product name": i.product_name ?? "", qty: i.qty, shortfall: i.shortfall })))
    );
  }

  async function openHistory(r: EngineRow) {
    setHistSku({ sku: r.sku, name: r.product_name });
    setHistRows(null);
    const { data } = await supabase
      .from("stock_snapshots")
      .select("snapshot_date, ecom_stock, sap_stock")
      .eq("sku", r.sku)
      .order("snapshot_date", { ascending: false })
      .limit(60);
    setHistRows((data as Snap[]) ?? []);
  }

  // Every column the tab shows, plus the ones a buyer asks about the
  // moment they open the file. Built from `sorted` — the full filtered
  // set, never the paged slice — so an export is never a screenshot of
  // whatever happened to be painted.
  const tableRows = useCallback(
    (which: Tab = tab): Record<string, unknown>[] => {
      const common = (r: EngineRow) => ({
        Sku: r.sku,
        "Product name": r.product_name,
        Category: r.category ?? "",
        Vendor: r.vendor ?? "",
        "Units sold (window)": r.units,
        "Units sold (last 7d)": r.recent_units ?? 0,
        "Sales/day": r.velocity,
        Surge: r.surge ? "yes" : "",
        Active: r.is_active === false ? "no" : "yes",
        "Lifetime units": r.lifetime_units ?? 0,
        "Lifetime sales/day": r.hist_velocity ?? 0,
        "Last sale": r.last_order_date ? r.last_order_date.slice(0, 10) : "",
        "E-com stock": r.is_unlimited ? "unlimited" : (r.ecom_stock ?? ""),
        "SAP stock": r.sap_stock ?? "",
        "On ads": r.on_ads ? "yes" : "",
        "Campaign spend": r.on_ads ? Math.round(r.ad_spend) : "",
      });
      if (which === "overstock")
        return sorted.map((r) => ({
          ...common(r),
          "Expected demand (cover)": r.expected,
          Surplus: r.surplus ?? 0,
          "Surplus value": Math.round((r.surplus ?? 0) * unitValue(r)) || "",
          "Cover (days)": r.cover_days ?? "",
        }));
      if (which === "oos")
        return sorted.map((r) => ({
          ...common(r),
          "Expected demand (cover)": r.expected,
          Action: r.units > 0 ? "Selling now - reorder from publisher" : "Sold before, out everywhere - reorder",
        }));
      if (which === "inactive")
        return sorted.map((r) => ({
          ...common(r),
          "Reason (store)": r.ecom_note ?? "",
          "Copies held (SAP + store)": (r.sap_stock ?? 0) + (r.ecom_stock ?? 0),
          "Held value": Math.round(((r.sap_stock ?? 0) + (r.ecom_stock ?? 0)) * unitValue(r)) || "",
        }));
      if (which === "relist")
        return sorted.map((r) => ({
          ...common(r),
          Group: r.status === "relist" ? "Was on the store" : "Never listed",
          "Move qty": effMove(r),
          "Move value": Math.round(effMove(r) * unitValue(r)) || "",
        }));
      // replenish and all items share the replenishment columns
      return sorted.map((r) => ({
        ...common(r),
        Target: r.target,
        "Days of cover": r.cover_days ?? "",
        "Move qty": effMove(r),
        Shortfall: r.shortfall,
        "Move value": Math.round(effMove(r) * unitValue(r)) || "",
        Status: r.status,
      }));
    },
    [sorted, tab, effMove, unitValue]
  );

  const exportStamp = () => new Date().toISOString().slice(0, 10);

  function exportTableCsv() {
    const list = tableRows();
    if (!list.length) return;
    downloadCsv(`stock-${tab}-${exportStamp()}.csv`, toCsv(list));
  }

  function exportTableXlsx() {
    const list = tableRows();
    if (!list.length) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(list), tab.slice(0, 31));
    XLSX.writeFile(wb, `stock-${tab}-${exportStamp()}.xlsx`);
  }

  // The Move Lists tab has no engine rows behind it, so it exports its
  // own shape: every saved list, one row per line item.
  function exportMoveListsXlsx() {
    const list = moveLists.flatMap((l) =>
      (moveItems[l.id] ?? []).map((i) => ({
        List: l.list_number,
        Status: l.status,
        Created: l.created_at.slice(0, 10),
        "Created by": l.created_by_email ?? "",
        Sku: i.sku,
        "Product name": i.product_name ?? "",
        Qty: i.qty,
        Shortfall: i.shortfall,
      }))
    );
    if (!list.length) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(list), "Move lists");
    XLSX.writeFile(wb, `stock-move-lists-${exportStamp()}.xlsx`);
  }

  // Multi-sheet workbook like the ProMax engine: Move list + Overstock + Out of stock
  function exportWorkbook() {
    const wb = XLSX.utils.book_new();
    const moveRows = rows
      .filter((r) => ["move", "low_sap"].includes(r.status) && (effMove(r) > 0 || r.shortfall > 0))
      .map((r) => ({
        Sku: r.sku,
        "product name": r.product_name,
        Category: r.category ?? "",
        Vendor: r.vendor ?? "",
        "Units sold": r.units,
        "Sales/day": r.velocity,
        Target: r.target,
        "E-com now": r.ecom_stock ?? "",
        "SAP avail": r.sap_stock ?? "",
        "Move qty": effMove(r),
        Shortfall: r.shortfall,
        "Unit value": unitValue(r) || "",
        "Move value": Math.round(effMove(r) * unitValue(r)) || "",
        Status: r.status === "low_sap" ? "Low SAP stock" : "Move",
      }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(moveRows.length ? moveRows : [{ Sku: "none" }]), "Move list");

    const overRows = rows
      .filter((r) => r.status === "overstock")
      .map((r) => ({
        Sku: r.sku,
        "product name": r.product_name,
        Category: r.category ?? "",
        Vendor: r.vendor ?? "",
        "E-com now": r.ecom_stock,
        "Expected demand": r.expected,
        Surplus: r.surplus,
        "Surplus value": Math.round((r.surplus ?? 0) * unitValue(r)) || "",
        "Cover (days)": r.cover_days ?? "",
      }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(overRows.length ? overRows : [{ Sku: "none" }]), "Overstock");

    const oosRows = rows
      .filter((r) => r.status === "oos_reorder")
      .map((r) => ({
        Sku: r.sku,
        "product name": r.product_name,
        Vendor: r.vendor ?? "",
        "Units sold (window)": r.units,
        "Lifetime units": r.lifetime_units ?? 0,
        "Last sale": r.last_order_date ? r.last_order_date.slice(0, 10) : "",
        Status: r.units > 0 ? "Selling now - reorder from publisher" : "Sold before, out everywhere - reorder",
      }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oosRows.length ? oosRows : [{ Sku: "none" }]), "Out of stock");

    // stock the warehouse is holding for a book the store shows as sold out
    const relistRows = rows
      .filter((r) => r.status === "relist")
      .map((r) => ({
        Sku: r.sku,
        "product name": r.product_name,
        Category: r.category ?? "",
        Vendor: r.vendor ?? "",
        "E-com now": r.ecom_stock ?? 0,
        "SAP avail": r.sap_stock ?? 0,
        "Lifetime units": r.lifetime_units ?? 0,
        "Last sale": r.last_order_date ? r.last_order_date.slice(0, 10) : "",
        "Move qty": effMove(r),
        "Move value": Math.round(effMove(r) * unitValue(r)) || "",
      }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(relistRows.length ? relistRows : [{ Sku: "none" }]), "Not on store");

    // warehouse stock the store has simply never carried — a listing
    // decision, not a replenishment one, so it gets its own sheet
    const neverRows = rows
      .filter((r) => r.status === "never_listed")
      .map((r) => ({
        Sku: r.sku,
        "product name": r.product_name,
        Category: r.category ?? "",
        Vendor: r.vendor ?? "",
        "SAP avail": r.sap_stock ?? 0,
        "Unit value": unitValue(r) || "",
        "Stock value": Math.round((r.sap_stock ?? 0) * unitValue(r)) || "",
      }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(neverRows.length ? neverRows : [{ Sku: "none" }]), "Never on store");

    XLSX.writeFile(wb, `Stock_replenishment_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const TABS: { key: Tab; labelKey: DictKey; count?: number }[] = [
    { key: "replenish", labelKey: "stockTabReplenish", count: kpis.moveSkus },
    { key: "relist", labelKey: "stockTabRelist", count: kpis.relist + kpis.neverListed },
    { key: "overstock", labelKey: "stockTabOverstock", count: kpis.overstock },
    { key: "oos", labelKey: "stockTabOos", count: kpis.oos },
    { key: "inactive", labelKey: "stockTabInactive", count: kpis.inactive },
    { key: "forecast", labelKey: "forecast" },
    { key: "all", labelKey: "stockTabAll", count: rows.length },
    { key: "lists", labelKey: "stockTabLists", count: moveLists.filter((l) => l.status === "pending").length },
  ];

  // a table tab that carries an editable move qty and can be saved as a list
  const isMoveTab = tab === "replenish" || tab === "relist" || tab === "all";

  const Th = ({ labelKey, k }: { labelKey: DictKey; k: string }) => (
    <SortTh label={t(labelKey)} k={k} sort={sort} onToggle={toggle} />
  );

  return (
    <div>
      <PageHeader
        title={t("stock")}
        subtitle={t("stockSubtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            {isMoveTab && (
              <button className="btn-primary" onClick={saveMoveList} disabled={savingList || !listCandidates.length}>
                <ClipboardCheck size={16} />
                {t("confirmMoveList")}
                {listCandidates.length > 0 && <span className="opacity-70"> ({listCandidates.length})</span>}
              </button>
            )}
            <button className="btn-secondary" onClick={exportWorkbook}>
              <FileSpreadsheet size={16} />
              {t("exportMoveList")}
            </button>
            {/* every tab exports itself, and always the whole filtered
                set rather than the rows currently painted */}
            {tab === "lists" ? (
              <button className="btn-secondary" onClick={exportMoveListsXlsx} disabled={!moveLists.length}>
                <FileSpreadsheet size={16} />
                {t("exportTableXlsx")}
              </button>
            ) : tab !== "forecast" ? (
              <>
                <button
                  className="btn-secondary"
                  onClick={exportTableXlsx}
                  disabled={!sorted.length}
                  title={t("exportRowsNote")}
                >
                  <FileSpreadsheet size={16} />
                  {t("exportTableXlsx")}
                  {sorted.length > 0 && <span className="opacity-70"> ({formatNumber(sorted.length)})</span>}
                </button>
                <button
                  className="btn-secondary"
                  onClick={exportTableCsv}
                  disabled={!sorted.length}
                  title={t("exportRowsNote")}
                >
                  <Download size={16} />
                  {t("exportCsv")}
                </button>
              </>
            ) : null}
          </div>
        }
      />

      {/* one badge per side: the store and the warehouse are counted by
          different files and are almost never as fresh as each other */}
      <div className="mb-3 flex flex-wrap gap-2">
        {(["ecom", "sap"] as const).map((side) => {
          const f = freshness.find((x) => x.side === side);
          const days = staleDaysOf(f?.taken_at ?? null);
          return (
            <div
              key={side}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                days == null || days > 7
                  ? "bg-red-100 text-red-700"
                  : days > 3
                    ? "bg-amber-100 text-amber-800"
                    : "bg-emerald-100 text-emerald-800"
              )}
            >
              <Clock size={12} />
              {t(side === "sap" ? "stockAsOfSap" : "stockAsOfEcom")}:{" "}
              {f?.taken_at ? formatDate(f.taken_at) : t("stockNeverUploaded")}
              {days != null && days > 3 && <span>— {t("stockStaleWarn")}</span>}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-8 mb-4">
        <KpiCard label={t("moveQty")} value={formatNumber(kpis.toMove)} sub={`${kpis.moveSkus} SKU`} accent="green" />
        <KpiCard label={t("moveValue")} value={formatMoney(kpis.moveValue, lang)} accent="green" />
        <KpiCard
          label={t("relistKpi")}
          value={formatNumber(kpis.relist)}
          sub={`${formatNumber(kpis.relistUnits)} ${t("relistUnitsSub")}`}
          accent="amber"
        />
        <KpiCard
          label={t("neverListedKpi")}
          value={formatNumber(kpis.neverListed)}
          sub={`${formatNumber(kpis.neverListedUnits)} ${t("relistUnitsSub")}`}
          accent="amber"
        />
        <KpiCard label={t("shortfall")} value={formatNumber(kpis.shortfall)} accent="amber" />
        <KpiCard label={t("stockTabOos")} value={formatNumber(kpis.oos)} accent="red" />
        <KpiCard label={t("stockTabOverstock")} value={formatNumber(kpis.overstock)} accent="slate" />
        <KpiCard label={t("overstockValue")} value={formatMoney(kpis.overstockValue, lang)} accent="slate" />
      </div>

      {tab !== "lists" && tab !== "forecast" && (
        <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
          {/* the three settings that decide what the page asks for; how it
              asks is fixed in ENGINE above */}
          <Ctl label={t("windowDays")}>
            <select className="input !w-auto" value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
              {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Ctl>
          <Ctl label={t("coverDays")}>
            <select className="input !w-auto" value={coverDays} onChange={(e) => setCoverDays(Number(e.target.value))}>
              {[7, 15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Ctl>
          <Ctl label={t("globalMin")} hint={t("globalMinHint")}>
            <input
              type="number"
              min={0}
              className="input !w-20"
              dir="ltr"
              title={t("globalMinHint")}
              value={globalMin}
              onChange={(e) => setGlobalMin(Number(e.target.value) || 0)}
            />
          </Ctl>
          <Ctl label={t("minScopeCtl")} hint={t("minScopeHint")}>
            <select
              className="input !w-auto"
              title={t("minScopeHint")}
              value={minScope}
              onChange={(e) => setMinScope(e.target.value as MinScope)}
            >
              <option value="listed">{t("minScopeListed")}</option>
              <option value="sold_ever">{t("minScopeSoldEver")}</option>
              <option value="selling">{t("minScopeSelling")}</option>
            </select>
          </Ctl>
          <Ctl label={t("bestsellerMin")} hint={t("bestsellerMinHint")}>
            <input
              type="number"
              min={0}
              className="input !w-20"
              dir="ltr"
              title={t("bestsellerMinHint")}
              value={bestsellerMin}
              onChange={(e) => setBestsellerMin(Number(e.target.value) || 0)}
            />
          </Ctl>
          <Ctl label={t("minSapMove")} hint={t("minSapMoveHint")}>
            <select
              className="input !w-auto"
              title={t("minSapMoveHint")}
              value={minSapMove}
              onChange={(e) => setMinSapMove(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Ctl>
          <Ctl label={t("maxOrder")} hint={t("maxOrderHint")}>
            <input
              type="number"
              min={1}
              className="input !w-20"
              dir="ltr"
              title={t("maxOrderHint")}
              value={maxOrder}
              onChange={(e) => setMaxOrder(Math.max(1, Number(e.target.value) || 1))}
            />
          </Ctl>
          {vendors.length > 0 && (
            <Ctl label={t("vendorCol")}>
              <MultiSelect
                className="w-[180px]"
                options={vendors}
                values={vendorFilter}
                onChange={setVendorFilter}
                placeholder={t("allVendors")}
              />
            </Ctl>
          )}
          {categories.length > 0 && (
            <Ctl label={t("categoryCol")}>
              <MultiSelect
                className="w-[180px]"
                options={categories}
                values={categoryFilter}
                onChange={setCategoryFilter}
                placeholder={t("allCategories")}
              />
            </Ctl>
          )}
          <Ctl label=" ">
            <label className="input !w-auto flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
              <input type="checkbox" checked={neverSoldOnly} onChange={(e) => setNeverSoldOnly(e.target.checked)} />
              {t("neverSoldFilter")}
            </label>
          </Ctl>
          <div className="flex-1 min-w-[180px]">
            <SearchBox placeholder={t("searchProducts")} value={search} onChange={setSearch} />
          </div>
        </div>
      )}

      {!hasStockData && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <Info size={16} className="shrink-0" />
          {t("stockUploadNote")}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {TABS.map((x) => (
          <button
            key={x.key}
            onClick={() => setTab(x.key)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-semibold transition",
              tab === x.key ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            )}
          >
            {t(x.labelKey)}
            {x.count !== undefined && <span className="text-xs opacity-60"> ({x.count})</span>}
          </button>
        ))}
      </div>

      {tab === "forecast" ? (
        <StockForecast />
      ) : tab === "lists" ? (
        moveLists.length === 0 ? (
          <EmptyState message={t("noMoveLists")} />
        ) : (
          <div className="space-y-4">
            {moveLists.map((l) => {
              const its = moveItems[l.id] ?? [];
              const total = its.reduce((s, i) => s + i.qty, 0);
              const meta = ML_META[l.status];
              return (
                <div key={l.id} className="card p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-bold" dir="ltr">{l.list_number}</span>
                    <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold", meta.style)}>{t(meta.key)}</span>
                    <span className="text-xs text-slate-500">{formatDate(l.created_at)}</span>
                    <span className="text-xs text-slate-500">{its.length} SKU — {t("totalQty")}: {formatNumber(total)}</span>
                    {l.created_by_email && <span className="text-xs text-slate-400" dir="ltr">{l.created_by_email}</span>}
                    <div className="ms-auto flex gap-2">
                      {l.status === "pending" && (
                        <button className="btn-primary !py-1.5 !px-3 !text-xs" onClick={() => setListStatus(l, "moved")}>
                          <Check size={14} />
                          {t("markAsMoved")}
                        </button>
                      )}
                      {l.status === "pending" && (
                        <button className="btn-secondary !py-1.5 !px-3 !text-xs" onClick={() => setListStatus(l, "cancelled")}>
                          <X size={14} />
                          {t("cancel")}
                        </button>
                      )}
                      <button className="btn-secondary !py-1.5 !px-3 !text-xs" onClick={() => exportList(l)}>
                        <Download size={14} />
                        CSV
                      </button>
                      <button className="btn-secondary !py-1.5 !px-3 !text-xs text-red-600" onClick={() => deleteList(l)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {its.length > 0 && (
                    <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-slate-100">
                      <table className="table-base">
                        <thead>
                          <tr>
                            <th>{t("products")}</th>
                            <th>{t("sku")}</th>
                            <th>{t("moveQty")}</th>
                            <th>{t("shortfall")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {its.map((i) => (
                            <tr key={`${i.list_id}-${i.sku}`}>
                              <td className="!whitespace-normal max-w-xs">{i.product_name}</td>
                              <td dir="ltr" className="font-mono text-xs text-slate-500">{i.sku}</td>
                              <td className="font-semibold">{formatNumber(i.qty)}</td>
                              <td className={cn(i.shortfall > 0 && "text-red-600 font-semibold")}>{formatNumber(i.shortfall)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : loading && rows.length === 0 ? (
        <Spinner />
      ) : sorted.length === 0 ? (
        <div className="space-y-3">
          <EmptyState message={t("noResults")} />
          {/* the book is on record, just not in this tab — the old page left
              the search looking like the SKU did not exist at all */}
          {searched.length > 0 && (search.trim() !== "" || vendorFilter.length > 0 || categoryFilter.length > 0) && (
            <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-slate-600">
              <span>
                {t("searchOtherTabs")} <b>{formatNumber(searched.length)}</b> {t("searchOtherTabsEnd")}
              </span>
              <button className="btn-secondary !py-1.5 !px-3 !text-xs" onClick={() => setTab("all")}>
                {t("showInAllItems")}
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span>{t("stockValueNote")}</span>
            <span>
              {t("stockRowsShown")} <b>{formatNumber(visible.length)}</b> {t("stockRowsOf")}{" "}
              <b>{formatNumber(sorted.length)}</b>
            </span>
            {visible.length < sorted.length && (
              <>
                <button className="font-semibold text-brand-700 hover:underline" onClick={() => setPageRows((n) => n + PAGE_ROWS)}>
                  {t("stockShowMore")}
                </button>
                <button className="font-semibold text-brand-700 hover:underline" onClick={() => setPageRows(sorted.length)}>
                  {t("stockShowAll")}
                </button>
              </>
            )}
          </div>
          {tab === "relist" && (
            <div className="mb-3 space-y-2">
              {/* two different decisions live under one tab name, so the
                  tab says which one you are looking at */}
              <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 w-fit">
                {(
                  [
                    ["all", "wnsGroupAll", kpis.relist + kpis.neverListed],
                    ["relist", "wnsGroupRelist", kpis.relist],
                    ["never_listed", "wnsGroupNever", kpis.neverListed],
                  ] as [WnsGroup, DictKey, number][]
                ).map(([key, labelKey, count]) => (
                  <button
                    key={key}
                    onClick={() => setWnsGroup(key)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                      wnsGroup === key ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
                    )}
                  >
                    {t(labelKey)}
                    <span className="opacity-60"> ({formatNumber(count)})</span>
                  </button>
                ))}
              </div>
              {wnsGroup !== "never_listed" && (
                <div className="flex items-start gap-2 rounded-lg bg-violet-50 border border-violet-200 px-4 py-3 text-sm text-violet-900">
                  <Info size={16} className="shrink-0 mt-0.5" />
                  {t("relistNote")}
                </div>
              )}
              {wnsGroup !== "relist" && (
                <div className="flex items-start gap-2 rounded-lg bg-teal-50 border border-teal-200 px-4 py-3 text-sm text-teal-900">
                  <Info size={16} className="shrink-0 mt-0.5" />
                  {t("neverListedNote")}
                </div>
              )}
            </div>
          )}
          {tab === "overstock" && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-900">
              <Info size={16} className="shrink-0 mt-0.5" />
              {t("overstockNote")}
            </div>
          )}
          {tab === "inactive" && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-slate-100 border border-slate-200 px-4 py-3 text-sm text-slate-700">
              <Info size={16} className="shrink-0 mt-0.5" />
              <span>
                {t("inactiveNote")}{" "}
                <b>
                  {formatNumber(kpis.inactive)} SKU · {formatNumber(kpis.inactiveSap)} {t("relistUnitsSub")}
                </b>
              </span>
            </div>
          )}
          {/* after the first load the table stays put and dims while the
              engine re-runs — a spinner on every setting change made the
              page feel far slower than it is */}
          <div className={cn("card overflow-x-auto transition-opacity", loading && "pointer-events-none opacity-50")}>
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t("products")}</th>
                  <th>{t("sku")}</th>
                  <Th labelKey="units" k="units" />
                  <Th labelKey="velocity" k="velocity" />
                  {tab === "replenish" && (
                    <>
                      <Th labelKey="targetQty" k="target" />
                      <Th labelKey="ecomStock" k="ecom" />
                      <Th labelKey="sapStock" k="sap" />
                      <Th labelKey="daysOfCover" k="cover" />
                      <Th labelKey="moveQty" k="move" />
                      <Th labelKey="shortfall" k="shortfall" />
                      <Th labelKey="stockValueCol" k="value" />
                    </>
                  )}
                  {tab === "relist" && (
                    <>
                      <Th labelKey="ecomStock" k="ecom" />
                      <Th labelKey="sapStock" k="sap" />
                      <Th labelKey="ltUnitsShort" k="lifetime" />
                      <Th labelKey="lastSale" k="lastsale" />
                      <Th labelKey="moveQty" k="move" />
                      <Th labelKey="stockValueCol" k="value" />
                    </>
                  )}
                  {tab === "all" && (
                    <>
                      <Th labelKey="ecomStock" k="ecom" />
                      <Th labelKey="sapStock" k="sap" />
                      <Th labelKey="daysOfCover" k="cover" />
                      <th title={t("adSpendNote")}>{t("onAdsCol")}</th>
                      <Th labelKey="moveQty" k="move" />
                      <Th labelKey="shortfall" k="shortfall" />
                    </>
                  )}
                  {tab === "overstock" && (
                    <>
                      <Th labelKey="ecomStock" k="ecom" />
                      <Th labelKey="expectedCol" k="expected" />
                      <Th labelKey="surplusQty" k="surplus" />
                      <Th labelKey="stockValueCol" k="value" />
                      <Th labelKey="daysOfCover" k="cover" />
                    </>
                  )}
                  {tab === "oos" && (
                    <>
                      <th>{t("vendorCol")}</th>
                      <th>{t("ecomStock")}</th>
                      <th>{t("sapStock")}</th>
                      <th>{t("forecastQty")}</th>
                      <Th labelKey="ltUnits" k="lifetime" />
                      <Th labelKey="lastSale" k="lastsale" />
                    </>
                  )}
                  {tab === "inactive" && (
                    <>
                      <th>{t("inactiveReason")}</th>
                      <Th labelKey="ecomStock" k="ecom" />
                      <Th labelKey="sapStock" k="sap" />
                      <Th labelKey="stockValueCol" k="value" />
                      <Th labelKey="ltUnits" k="lifetime" />
                      <Th labelKey="lastSale" k="lastsale" />
                    </>
                  )}
                  <th>{t("status")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const meta = STATUS_META[r.status];
                  const qtyInput = (
                    <input
                      type="number"
                      min={0}
                      max={r.sap_stock ?? undefined}
                      className="input !py-1 !w-20 text-xs font-bold text-brand-700"
                      dir="ltr"
                      value={moveEdits[r.sku] ?? String(r.move_qty)}
                      onChange={(e) => setMoveEdits((p) => ({ ...p, [r.sku]: e.target.value }))}
                    />
                  );
                  return (
                    <tr key={r.sku}>
                      <td className="!whitespace-normal max-w-xs font-medium">
                        <button className="text-start hover:text-brand-700 hover:underline" onClick={() => openHistory(r)} title={t("skuHistory")}>
                          {r.product_name}
                        </button>
                      </td>
                      <td dir="ltr" className="font-mono text-xs text-slate-500">{r.sku}</td>
                      <td className="font-semibold">{formatNumber(r.units)}</td>
                      <td className="whitespace-nowrap">
                        {formatNumber(r.velocity)}
                        {r.surge && (
                          <span
                            className="ms-1 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700"
                            title={`${t("surgeHint")} ${formatNumber(r.recent_units)}`}
                          >
                            ↑7d
                          </span>
                        )}
                      </td>
                      {tab === "replenish" && (
                        <>
                          <td>{formatNumber(r.target)}</td>
                          <td>{r.ecom_stock != null ? formatNumber(r.ecom_stock) : "—"}</td>
                          <td className={cn(r.status === "low_sap" && "text-amber-700 font-semibold")}>
                            {r.sap_stock != null ? formatNumber(r.sap_stock) : "—"}
                          </td>
                          <td className={coverClass(r.cover_days)}>{r.cover_days != null ? formatNumber(r.cover_days) : "—"}</td>
                          <td>{qtyInput}</td>
                          <td className={cn("font-semibold", r.shortfall > 0 && "text-red-600")}>{formatNumber(r.shortfall)}</td>
                          <td className="text-slate-500">{unitValue(r) ? formatMoney(effMove(r) * unitValue(r), lang) : "—"}</td>
                        </>
                      )}
                      {tab === "relist" && (
                        <>
                          {/* 0 means "the store carries it and has none";
                              NULL means the store has never carried it —
                              printing 0 for both hid the difference */}
                          <td className="font-semibold text-red-600">
                            {r.ecom_stock != null ? formatNumber(r.ecom_stock) : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="font-semibold text-violet-700">{r.sap_stock != null ? formatNumber(r.sap_stock) : "—"}</td>
                          <td className="font-semibold text-slate-700">{formatNumber(r.lifetime_units ?? 0)}</td>
                          <td className="whitespace-nowrap text-xs text-slate-500">
                            {r.last_order_date ? formatDate(r.last_order_date) : <span className="text-slate-400">{t("neverSoldLbl")}</span>}
                          </td>
                          <td>{qtyInput}</td>
                          <td className="text-slate-500">{unitValue(r) ? formatMoney(effMove(r) * unitValue(r), lang) : "—"}</td>
                        </>
                      )}
                      {tab === "all" && (
                        <>
                          <td className={cn(r.ecom_stock === 0 && "font-semibold text-red-600")}>
                            {r.is_unlimited ? (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600" title={t("unlimitedAtHint")}>
                                {t("statusUnlimited")}
                              </span>
                            ) : r.ecom_stock != null ? (
                              formatNumber(r.ecom_stock)
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>{r.sap_stock != null ? formatNumber(r.sap_stock) : "—"}</td>
                          <td className={coverClass(r.cover_days)}>{r.cover_days != null ? formatNumber(r.cover_days) : "—"}</td>
                          <td>
                            {r.on_ads ? (
                              <span
                                className="whitespace-nowrap rounded-full bg-fuchsia-100 px-2 py-0.5 text-xs font-semibold text-fuchsia-800"
                                title={t("adSpendNote")}
                              >
                                {formatMoney(r.ad_spend, lang)}
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          {/* editable wherever SAP has copies to give, so a
                              book the engine scores at zero can still be
                              added to a list by hand */}
                          <td>
                            {r.is_active !== false && (r.sap_stock ?? 0) >= minSapMove ? qtyInput : <span className="text-slate-400">—</span>}
                          </td>
                          <td className={cn("font-semibold", r.shortfall > 0 && "text-red-600")}>{formatNumber(r.shortfall)}</td>
                        </>
                      )}
                      {tab === "overstock" && (
                        <>
                          <td>{formatNumber(r.ecom_stock ?? 0)}</td>
                          <td>{formatNumber(r.expected)}</td>
                          <td className="font-semibold text-blue-700">{formatNumber(r.surplus ?? 0)}</td>
                          <td className="text-slate-500">{unitValue(r) ? formatMoney((r.surplus ?? 0) * unitValue(r), lang) : "—"}</td>
                          <td className={coverClass(r.cover_days)}>{r.cover_days != null ? formatNumber(r.cover_days) : "—"}</td>
                        </>
                      )}
                      {tab === "oos" && (
                        <>
                          <td className="!whitespace-normal max-w-[140px] text-xs text-slate-500">{r.vendor ?? "—"}</td>
                          <td>{r.ecom_stock != null ? formatNumber(r.ecom_stock) : "—"}</td>
                          <td>{r.sap_stock != null ? formatNumber(r.sap_stock) : "—"}</td>
                          <td>{formatNumber(r.forecast)}</td>
                          <td className="font-semibold text-slate-700">{formatNumber(r.lifetime_units ?? 0)}</td>
                          <td className="whitespace-nowrap text-xs text-slate-500">
                            {r.last_order_date ? formatDate(r.last_order_date) : <span className="text-slate-400">{t("neverSoldLbl")}</span>}
                          </td>
                        </>
                      )}
                      {tab === "inactive" && (
                        <>
                          {/* the store's own word for why — "duplicate" and
                              "old edition" never come back, "price closed"
                              does; that is the whole decision */}
                          <td className="!whitespace-normal max-w-[220px] text-xs text-slate-600" dir="auto">
                            {r.ecom_note ?? <span className="text-slate-400">—</span>}
                          </td>
                          <td>{r.ecom_stock != null ? formatNumber(r.ecom_stock) : "—"}</td>
                          <td className={cn("font-semibold", (r.sap_stock ?? 0) > 0 && "text-amber-700")}>
                            {r.sap_stock != null ? formatNumber(r.sap_stock) : "—"}
                          </td>
                          <td className="text-slate-500">
                            {unitValue(r) ? formatMoney(((r.sap_stock ?? 0) + (r.ecom_stock ?? 0)) * unitValue(r), lang) : "—"}
                          </td>
                          <td className="font-semibold text-slate-700">{formatNumber(r.lifetime_units ?? 0)}</td>
                          <td className="whitespace-nowrap text-xs text-slate-500">
                            {r.last_order_date ? formatDate(r.last_order_date) : <span className="text-slate-400">{t("neverSoldLbl")}</span>}
                          </td>
                        </>
                      )}
                      <td>
                        <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", meta.style)}>
                          {t(meta.key)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {histSku && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setHistSku(null)}>
          <div className="card w-full max-w-md p-4 max-h-[75vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="font-bold">{t("skuHistory")}</div>
                <div className="text-sm text-slate-500">{histSku.name}</div>
                <div className="text-xs font-mono text-slate-400" dir="ltr">{histSku.sku}</div>
              </div>
              <button className="btn-secondary !p-1.5" onClick={() => setHistSku(null)}>
                <X size={16} />
              </button>
            </div>
            {histRows === null ? (
              <Spinner />
            ) : histRows.length === 0 ? (
              <EmptyState message={t("noHistoryYet")} />
            ) : (
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t("date")}</th>
                    <th>{t("ecomStock")}</th>
                    <th>{t("sapStock")}</th>
                  </tr>
                </thead>
                <tbody>
                  {histRows.map((s) => (
                    <tr key={s.snapshot_date}>
                      <td>{formatDate(s.snapshot_date)}</td>
                      <td>{s.ecom_stock != null ? formatNumber(s.ecom_stock) : "—"}</td>
                      <td>{s.sap_stock != null ? formatNumber(s.sap_stock) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Ctl({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-slate-500">
        {label}
        {/* the settings that need explaining are the ones nobody can
            guess from the label — Relist qty above all */}
        {hint && <Info size={12} className="shrink-0 text-slate-400" aria-label={hint} />}
      </label>
      {children}
    </div>
  );
}
