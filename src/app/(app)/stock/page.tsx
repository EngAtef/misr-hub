"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { Download, Info, FileSpreadsheet, ClipboardCheck, Check, Trash2, X, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { PageHeader, Spinner, EmptyState, KpiCard, SortTh, useSort } from "@/components/ui";
import { MultiSelect } from "@/components/multi-select";
import { SearchBox } from "@/components/search-box";
import { StockForecast } from "@/components/stock-forecast";
import { formatNumber, formatMoney, formatDate, toCsv, downloadCsv, cn } from "@/lib/utils";

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
  status: "move" | "low_sap" | "oos_reorder" | "overstock" | "relist" | "ok";
  vendor: string | null;
  cost: number | null;
  avg_price: number | null;
  // full history, so a book that ran out months ago can still be judged
  lifetime_units: number;
  last_order_date: string | null;
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
  ok: { key: "statusOk", style: "bg-slate-100 text-slate-600" },
};

// "All items" holds every SKU the engine knows (~4.5k); the table is not
// virtualised, so it renders a page at a time and says so
const ALL_TAB_CAP = 500;

const ML_META: Record<string, { key: DictKey; style: string }> = {
  pending: { key: "mlPending", style: "bg-amber-100 text-amber-800" },
  moved: { key: "mlMoved", style: "bg-emerald-100 text-emerald-800" },
  cancelled: { key: "mlCancelled", style: "bg-slate-100 text-slate-600" },
};

type Tab = "replenish" | "relist" | "overstock" | "oos" | "forecast" | "all" | "lists";

const SETTINGS_KEY = "nm-stock-engine-settings";

function coverClass(days: number | null): string {
  if (days == null) return "";
  if (days < 7) return "text-red-600 font-semibold";
  if (days < 15) return "text-amber-600 font-semibold";
  return "";
}

export default function StockPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [windowDays, setWindowDays] = useState(30);
  const [coverDays, setCoverDays] = useState(45);
  const [globalMin, setGlobalMin] = useState(0);
  const [bestsellerMin, setBestsellerMin] = useState(20);
  const [maxOrder, setMaxOrder] = useState(300);
  // one copy in the warehouse is never worth a trip, so it never becomes a
  // move line — the shortfall still shows, purchasing still needs it
  const [minSapMove, setMinSapMove] = useState(2);
  const [relistQty, setRelistQty] = useState(10);
  const [settingsReady, setSettingsReady] = useState(false);
  const [rows, setRows] = useState<EngineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("replenish");
  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);

  // ?filter=/?q= deep links so alerts can land on the right tab already
  // narrowed (e.g. the stockouts alert opens /stock?filter=oos, and the
  // "traffic on an out-of-stock book" alarm adds &q=<book name>)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const f = sp.get("filter");
    if (["oos", "overstock", "replenish", "relist", "forecast", "all", "lists"].includes(f ?? "")) setTab(f as Tab);
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
        if (s.bestsellerMin != null) setBestsellerMin(s.bestsellerMin);
        if (s.maxOrder) setMaxOrder(s.maxOrder);
        if (s.minSapMove != null) setMinSapMove(s.minSapMove);
        if (s.relistQty) setRelistQty(s.relistQty);
      }
    } catch {}
    setSettingsReady(true);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("fn_stock_engine", {
      p_window_days: windowDays,
      p_coverage_days: coverDays,
      p_global_min: globalMin,
      p_bestseller_min: bestsellerMin,
      p_bestseller_units: 20,
      p_max_order: maxOrder,
      p_min_sap_move: minSapMove,
      p_relist_qty: relistQty,
    });
    const list = (data as EngineRow[]) ?? [];
    setRows(list);
    setHasStockData(list.some((r) => r.ecom_stock !== null || r.sap_stock !== null));
    setLoading(false);
  }, [supabase, windowDays, coverDays, globalMin, bestsellerMin, maxOrder, minSapMove, relistQty]);

  useEffect(() => {
    if (!settingsReady) return;
    load();
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ windowDays, coverDays, globalMin, bestsellerMin, maxOrder, minSapMove, relistQty })
      );
    } catch {}
  }, [settingsReady, load, windowDays, coverDays, globalMin, bestsellerMin, maxOrder, minSapMove, relistQty]);

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
    return list;
  }, [rows, search, vendorFilter, categoryFilter]);

  const filtered = useMemo(() => {
    const list = searched;
    if (tab === "replenish") return list.filter((r) => ["move", "low_sap"].includes(r.status) || (!hasStockData && r.need > 0));
    if (tab === "relist") return list.filter((r) => r.status === "relist");
    if (tab === "overstock") return list.filter((r) => r.status === "overstock");
    if (tab === "oos") return list.filter((r) => r.status === "oos_reorder");
    return list;
  }, [searched, tab, hasStockData]);

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
        value: (r) => unitValue(r) * (tab === "overstock" ? (r.surplus ?? 0) : effMove(r)),
      }),
    [filtered, apply, tab, effMove, unitValue]
  );

  // "All items" would otherwise paint ~4,500 rows at once
  const capped = tab === "all" && sorted.length > ALL_TAB_CAP;
  const visible = useMemo(() => (capped ? sorted.slice(0, ALL_TAB_CAP) : sorted), [sorted, capped]);

  const kpis = useMemo(() => {
    const moveRows = rows.filter((r) => ["move", "low_sap"].includes(r.status));
    const overRows = rows.filter((r) => r.status === "overstock");
    const relistRows = rows.filter((r) => r.status === "relist");
    return {
      toMove: moveRows.reduce((s, r) => s + effMove(r), 0),
      moveSkus: moveRows.length,
      shortfall: rows.reduce((s, r) => s + (r.shortfall ?? 0), 0),
      oos: rows.filter((r) => r.status === "oos_reorder").length,
      overstock: overRows.length,
      moveValue: moveRows.reduce((s, r) => s + effMove(r) * unitValue(r), 0),
      overstockValue: overRows.reduce((s, r) => s + (r.surplus ?? 0) * unitValue(r), 0),
      relist: relistRows.length,
      relistUnits: relistRows.reduce((s, r) => s + (r.sap_stock ?? 0), 0),
    };
  }, [rows, effMove, unitValue]);

  // The move list is built from what is on screen, so a vendor filter, a
  // search or the relist tab each save their own list. Any quantity above
  // zero counts, engine-proposed or typed in by hand — that is how a book
  // the engine scores at zero still gets moved. What the warehouse cannot
  // serve is dropped and reported, never saved silently.
  const listCandidates = useMemo(
    () => filtered.filter((r) => effMove(r) > 0 && (r.sap_stock ?? 0) >= minSapMove),
    [filtered, effMove, minSapMove]
  );

  async function saveMoveList() {
    const skipped = filtered.filter((r) => effMove(r) > 0 && (r.sap_stock ?? 0) < minSapMove).length;
    const items = listCandidates.map((r) => ({
      sku: r.sku,
      product_name: r.product_name,
      qty: effMove(r),
      shortfall: Math.round(r.shortfall ?? 0),
    }));
    if (!items.length) {
      alert(t("moveListEmpty"));
      return;
    }
    const note = skipped ? `\n${skipped} ${t("moveListSapSkipped")}` : "";
    if (!confirm(`${t("moveListConfirmQ")} ${items.length} ${t("moveListConfirmEnd")}${note}`)) return;
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
      alert(`${num} — ${t("moveListSavedMsg")}`);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSavingList(false);
    }
  }

  async function setListStatus(list: MoveList, status: MoveList["status"]) {
    await supabase.from("stock_move_lists").update({ status, updated_at: new Date().toISOString() }).eq("id", list.id);
    loadMoveLists();
  }

  async function deleteList(list: MoveList) {
    if (!confirm(`${list.list_number} — ${t("mlDeleteConfirm")}`)) return;
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

  function exportTeamCsv() {
    const list = sorted
      .filter((r) => (tab === "replenish" ? effMove(r) > 0 || r.shortfall > 0 : true))
      .map((r) =>
        tab === "replenish" || tab === "relist" || tab === "all"
          ? { Sku: r.sku, "product name": r.product_name, restock: effMove(r) + r.shortfall }
          : tab === "overstock"
            ? { Sku: r.sku, "product name": r.product_name, "E-com now": r.ecom_stock, "Expected demand": r.forecast, Surplus: r.surplus }
            : {
                Sku: r.sku,
                "product name": r.product_name,
                Vendor: r.vendor ?? "",
                "Units sold": r.units,
                "Lifetime units": r.lifetime_units ?? 0,
                "Last sale": r.last_order_date ? r.last_order_date.slice(0, 10) : "",
                Status: r.units > 0 ? "Selling now - reorder from publisher" : "Sold before, out everywhere - reorder",
              }
      );
    if (!list.length) return;
    downloadCsv(`stock-${tab}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(list as Record<string, unknown>[]));
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
        "Expected demand": r.forecast,
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

    XLSX.writeFile(wb, `Stock_replenishment_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const TABS: { key: Tab; labelKey: DictKey; count?: number }[] = [
    { key: "replenish", labelKey: "stockTabReplenish", count: kpis.moveSkus },
    { key: "relist", labelKey: "stockTabRelist", count: kpis.relist },
    { key: "overstock", labelKey: "stockTabOverstock", count: kpis.overstock },
    { key: "oos", labelKey: "stockTabOos", count: kpis.oos },
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
            <button className="btn-secondary" onClick={exportTeamCsv}>
              <Download size={16} />
              {t("exportCsv")}
            </button>
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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7 mb-4">
        <KpiCard label={t("moveQty")} value={formatNumber(kpis.toMove)} sub={`${kpis.moveSkus} SKU`} accent="green" />
        <KpiCard label={t("moveValue")} value={formatMoney(kpis.moveValue, lang)} accent="green" />
        <KpiCard
          label={t("relistKpi")}
          value={formatNumber(kpis.relist)}
          sub={`${formatNumber(kpis.relistUnits)} ${t("relistUnitsSub")}`}
          accent="amber"
        />
        <KpiCard label={t("shortfall")} value={formatNumber(kpis.shortfall)} accent="amber" />
        <KpiCard label={t("stockTabOos")} value={formatNumber(kpis.oos)} accent="red" />
        <KpiCard label={t("stockTabOverstock")} value={formatNumber(kpis.overstock)} accent="slate" />
        <KpiCard label={t("overstockValue")} value={formatMoney(kpis.overstockValue, lang)} accent="slate" />
      </div>

      {tab !== "lists" && tab !== "forecast" && (
        <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
          <Ctl label={t("windowDays")}>
            <select className="input !w-auto" value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
              {[14, 30, 60, 90].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Ctl>
          <Ctl label={t("coverDays")}>
            <select className="input !w-auto" value={coverDays} onChange={(e) => setCoverDays(Number(e.target.value))}>
              {[15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Ctl>
          <Ctl label={t("globalMin")}>
            <input type="number" min={0} className="input !w-20" dir="ltr" value={globalMin} onChange={(e) => setGlobalMin(Number(e.target.value) || 0)} />
          </Ctl>
          <Ctl label={t("bestsellerMin")}>
            <input type="number" min={0} className="input !w-20" dir="ltr" value={bestsellerMin} onChange={(e) => setBestsellerMin(Number(e.target.value) || 0)} />
          </Ctl>
          <Ctl label={t("maxOrder")}>
            <select className="input !w-auto" value={maxOrder} onChange={(e) => setMaxOrder(Number(e.target.value))}>
              {[100, 150, 200, 300, 500].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Ctl>
          <Ctl label={t("minSapMove")}>
            <select
              className="input !w-auto"
              title={t("minSapMoveHint")}
              value={minSapMove}
              onChange={(e) => setMinSapMove(Number(e.target.value))}
            >
              {[1, 2, 3, 5, 10].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Ctl>
          <Ctl label={t("relistQtyCtl")}>
            <select className="input !w-auto" value={relistQty} onChange={(e) => setRelistQty(Number(e.target.value))}>
              {[5, 10, 15, 20, 30].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
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
      ) : loading ? (
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
            {capped && <span className="text-amber-600 font-semibold">{t("stockRowsCapped")}</span>}
          </div>
          {tab === "relist" && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-violet-50 border border-violet-200 px-4 py-3 text-sm text-violet-900">
              <Info size={16} className="shrink-0 mt-0.5" />
              {t("relistNote")}
            </div>
          )}
          <div className="card overflow-x-auto">
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
                      <Th labelKey="moveQty" k="move" />
                      <Th labelKey="shortfall" k="shortfall" />
                    </>
                  )}
                  {tab === "overstock" && (
                    <>
                      <Th labelKey="ecomStock" k="ecom" />
                      <th>{t("forecastQty")}</th>
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
                      <td>{formatNumber(r.velocity)}</td>
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
                          <td className="font-semibold text-red-600">{formatNumber(r.ecom_stock ?? 0)}</td>
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
                            {r.ecom_stock != null ? formatNumber(r.ecom_stock) : "—"}
                          </td>
                          <td>{r.sap_stock != null ? formatNumber(r.sap_stock) : "—"}</td>
                          <td className={coverClass(r.cover_days)}>{r.cover_days != null ? formatNumber(r.cover_days) : "—"}</td>
                          {/* editable wherever SAP has copies to give, so a
                              book the engine scores at zero can still be
                              added to a list by hand */}
                          <td>{(r.sap_stock ?? 0) >= minSapMove ? qtyInput : <span className="text-slate-400">—</span>}</td>
                          <td className={cn("font-semibold", r.shortfall > 0 && "text-red-600")}>{formatNumber(r.shortfall)}</td>
                        </>
                      )}
                      {tab === "overstock" && (
                        <>
                          <td>{formatNumber(r.ecom_stock ?? 0)}</td>
                          <td>{formatNumber(r.forecast)}</td>
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

function Ctl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1 text-slate-500">{label}</label>
      {children}
    </div>
  );
}
