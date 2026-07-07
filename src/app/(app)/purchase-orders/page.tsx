"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Plus, X, Download, Send, PackageCheck, FileText, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";
import { formatMoney, formatNumber, formatDate, toCsv, downloadCsv, cn } from "@/lib/utils";

interface PO {
  id: string;
  po_number: string;
  vendor: string | null;
  status: "draft" | "sent" | "received" | "cancelled";
  notes: string | null;
  created_by_email: string | null;
  created_at: string;
}
interface POItem { po_id: string; sku: string; product_name: string | null; qty: number; unit_cost: number | null; }

interface EngineRow {
  sku: string; product_name: string; vendor: string | null;
  shortfall: number; move_qty: number; status: string; cost?: number | null;
}

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  sent: "bg-amber-100 text-amber-800",
  received: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-red-100 text-red-700",
};
const STATUS_KEY: Record<string, DictKey> = { draft: "poDraft", sent: "poSent", received: "poReceived", cancelled: "poCancelled" };

export default function PurchaseOrdersPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [pos, setPos] = useState<PO[]>([]);
  const [items, setItems] = useState<Record<string, POItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("purchase_orders").select("*").order("created_at", { ascending: false });
    const list = (data as PO[]) ?? [];
    setPos(list);
    if (list.length) {
      const { data: its } = await supabase.from("purchase_order_items").select("*").in("po_id", list.map((p) => p.id));
      const map: Record<string, POItem[]> = {};
      for (const it of (its as POItem[]) ?? []) (map[it.po_id] ??= []).push(it);
      setItems(map);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(po: PO, status: PO["status"]) {
    await supabase.from("purchase_orders").update({ status, updated_at: new Date().toISOString() }).eq("id", po.id);
    load();
  }
  async function remove(po: PO) {
    if (!confirm(po.po_number)) return;
    await supabase.from("purchase_orders").delete().eq("id", po.id);
    load();
  }
  function exportPo(po: PO) {
    const rows = (items[po.id] ?? []).map((i) => ({ SKU: i.sku, Product: i.product_name ?? "", Qty: i.qty, "Unit Cost": i.unit_cost ?? "" }));
    downloadCsv(`${po.po_number}-${po.vendor ?? "vendor"}.csv`, toCsv(rows));
  }

  return (
    <div>
      <PageHeader
        title={t("purchaseOrders")}
        subtitle={t("poSubtitle")}
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} />
            {t("newPo")}
          </button>
        }
      />

      {loading ? (
        <Spinner />
      ) : pos.length === 0 ? (
        <EmptyState message={t("poGroupHint")} />
      ) : (
        <div className="space-y-4">
          {pos.map((po) => {
            const its = items[po.id] ?? [];
            const totalQty = its.reduce((s, i) => s + i.qty, 0);
            const totalVal = its.reduce((s, i) => s + i.qty * (i.unit_cost ?? 0), 0);
            return (
              <div key={po.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold" dir="ltr">{po.po_number}</span>
                      <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_STYLE[po.status])}>{t(STATUS_KEY[po.status])}</span>
                      {po.vendor && <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">{po.vendor}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {formatDate(po.created_at)} · {po.created_by_email ?? ""} · {its.length} {t("poItems")} · {formatNumber(totalQty)} {t("qty")} · {formatMoney(totalVal, lang)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button className="btn-secondary !py-1.5 text-xs" onClick={() => exportPo(po)}><Download size={14} />{t("poExport")}</button>
                    {po.status === "draft" && <button className="btn-secondary !py-1.5 text-xs" onClick={() => setStatus(po, "sent")}><Send size={14} />{t("markSent")}</button>}
                    {po.status === "sent" && <button className="btn-secondary !py-1.5 text-xs" onClick={() => setStatus(po, "received")}><PackageCheck size={14} />{t("markReceived")}</button>}
                    <button className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => remove(po)}><Trash2 size={15} /></button>
                  </div>
                </div>
                {its.length > 0 && (
                  <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 max-h-64 overflow-y-auto">
                    <table className="table-base">
                      <thead><tr><th>{t("sku")}</th><th>{t("products")}</th><th>{t("qty")}</th><th>{t("unitCost")}</th></tr></thead>
                      <tbody>
                        {its.map((i) => (
                          <tr key={i.sku}>
                            <td dir="ltr" className="font-mono text-xs">{i.sku}</td>
                            <td className="!whitespace-normal max-w-md">{i.product_name}</td>
                            <td className="font-semibold">{formatNumber(i.qty)}</td>
                            <td>{i.unit_cost != null ? formatMoney(i.unit_cost, lang) : "—"}</td>
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
      )}

      {creating && <CreatePoModal onClose={() => setCreating(false)} onCreated={load} />}
    </div>
  );
}

function CreatePoModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<EngineRow[] | null>(null);
  const [vendor, setVendor] = useState("");
  const [qtyEdits, setQtyEdits] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("fn_stock_engine", { p_window_days: 30, p_coverage_days: 45, p_max_order: 300 });
      const eng = ((data as EngineRow[]) ?? []).filter((r) => (r.shortfall ?? 0) > 0 || (r.status === "oos_reorder"));
      // enrich with vendor + cost from stock_items
      const skus = eng.map((r) => r.sku);
      const { data: si } = await supabase.from("stock_items").select("sku, vendor, cost").in("sku", skus.slice(0, 1000));
      const meta = new Map<string, { vendor: string | null; cost: number | null }>();
      for (const s of (si as { sku: string; vendor: string | null; cost: number | null }[]) ?? []) meta.set(s.sku, { vendor: s.vendor, cost: s.cost });
      setRows(eng.map((r) => ({ ...r, vendor: meta.get(r.sku)?.vendor ?? null, cost: meta.get(r.sku)?.cost ?? null })));
    })();
  }, [supabase]);

  const vendors = useMemo(() => {
    if (!rows) return [];
    const set = new Map<string, number>();
    for (const r of rows) {
      const v = r.vendor || "(untagged)";
      set.set(v, (set.get(v) ?? 0) + 1);
    }
    return Array.from(set.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const vendorRows = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => (r.vendor || "(untagged)") === vendor);
  }, [rows, vendor]);

  const effQty = (r: EngineRow) => qtyEdits[r.sku] ?? Math.max(Math.round(r.shortfall || r.move_qty || 0), 0);

  async function save() {
    if (!vendor || !vendorRows.length) return;
    setSaving(true);
    setError("");
    const { data: num } = await supabase.rpc("fn_next_po_number");
    const email = (await supabase.auth.getUser()).data.user?.email ?? null;
    const { data: po, error: e1 } = await supabase
      .from("purchase_orders")
      .insert({ po_number: num, vendor: vendor === "(untagged)" ? null : vendor, created_by_email: email })
      .select("id")
      .single();
    if (e1 || !po) { setError(e1?.message ?? "failed"); setSaving(false); return; }
    const its = vendorRows.filter((r) => effQty(r) > 0).map((r) => ({
      po_id: po.id, sku: r.sku, product_name: r.product_name, qty: effQty(r), unit_cost: r.cost ?? null,
    }));
    const { error: e2 } = await supabase.from("purchase_order_items").insert(its);
    if (e2) { setError(e2.message); setSaving(false); return; }
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-3xl card p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold">{t("generateFromReorder")}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        <p className="mb-4 text-xs text-slate-500">{t("poGroupHint")}</p>

        {!rows ? (
          <Spinner />
        ) : vendors.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">{t("poNoVendors")}</div>
        ) : (
          <>
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">{t("poSelectVendor")}</label>
              <select className="input" value={vendor} onChange={(e) => setVendor(e.target.value)}>
                <option value="">—</option>
                {vendors.map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}
              </select>
            </div>
            {vendor && (
              <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-80 overflow-y-auto mb-4">
                <table className="table-base">
                  <thead><tr><th>{t("sku")}</th><th>{t("products")}</th><th>{t("unitCost")}</th><th>{t("qty")}</th></tr></thead>
                  <tbody>
                    {vendorRows.map((r) => (
                      <tr key={r.sku}>
                        <td dir="ltr" className="font-mono text-xs">{r.sku}</td>
                        <td className="!whitespace-normal max-w-sm">{r.product_name}</td>
                        <td>{r.cost != null ? formatMoney(r.cost, lang) : "—"}</td>
                        <td>
                          <input type="number" min={0} className="input !py-1 !w-20 text-xs font-bold"
                            dir="ltr" value={effQty(r)} onChange={(e) => setQtyEdits((p) => ({ ...p, [r.sku]: Number(e.target.value) || 0 }))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {error && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
            <button className="btn-primary w-full" disabled={saving || !vendor || !vendorRows.length} onClick={save}>
              <FileText size={16} />
              {t("poSave")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
