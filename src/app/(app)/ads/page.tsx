"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { UploadCloud, Download, Pencil, Check, X, Info, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner, EmptyState, KpiCard } from "@/components/ui";
import { formatMoney, formatNumber, toCsv, downloadCsv, cn } from "@/lib/utils";
import { parseAdsFile } from "@/lib/import/parse-ads";

interface AdPerf {
  id: string;
  source: string;
  campaign_name: string | null;
  ad_name: string | null;
  match_keyword: string | null;
  mapped_sku: string | null;
  spend: number | null;
  reported_purchases: number | null;
  reported_value: number | null;
  link_clicks: number | null;
  actual_orders: number;
  actual_units: number;
  actual_revenue: number;
  reported_roas: number | null;
  actual_roas: number | null;
  actual_cr: number | null;
  report_start: string | null;
  report_end: string | null;
}

export default function AdsPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<AdPerf[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editKeyword, setEditKeyword] = useState("");
  const [editSku, setEditSku] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("fn_ads_performance", { p_from: null, p_to: null, p_batch: null });
    setRows((data as AdPerf[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleFile(file: File) {
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseAdsFile(buffer, file.name);
      if (!parsed.length) {
        alert(t("importFailed"));
        setImporting(false);
        return;
      }
      const batchLabel = file.name.replace(/\.(csv|xlsx?)$/i, "");
      const res = await fetch("/api/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", rows: parsed, batchLabel }),
      });
      if (!res.ok) alert(t("importFailed"));
      await load();
    } catch {
      alert(t("importFailed"));
    }
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function saveEdit(id: string) {
    await fetch("/api/ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", id, match_keyword: editKeyword, mapped_sku: editSku }),
    });
    setEditing(null);
    await load();
  }

  function exportCsv() {
    if (!rows.length) return;
    const clean = rows.map((r) => ({
      source: r.source,
      campaign: r.campaign_name,
      ad_name: r.ad_name,
      match_keyword: r.match_keyword,
      mapped_sku: r.mapped_sku,
      spend: r.spend,
      reported_purchases: r.reported_purchases,
      reported_value: r.reported_value,
      actual_orders: r.actual_orders,
      actual_units: r.actual_units,
      actual_revenue: r.actual_revenue,
      reported_roas: r.reported_roas,
      actual_roas: r.actual_roas,
      actual_cr_pct: r.actual_cr,
    }));
    downloadCsv(`ads-performance-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(clean));
  }

  const totals = useMemo(() => {
    const spend = rows.reduce((s, r) => s + (r.spend ?? 0), 0);
    const actualRev = rows.reduce((s, r) => s + (r.actual_revenue ?? 0), 0);
    const reportedRev = rows.reduce((s, r) => s + (r.reported_value ?? 0), 0);
    const actualOrders = rows.reduce((s, r) => s + (r.actual_orders ?? 0), 0);
    return { spend, actualRev, reportedRev, actualOrders, roas: spend > 0 ? actualRev / spend : 0 };
  }, [rows]);

  function roasColor(v: number | null) {
    if (v === null) return "";
    return v >= 3 ? "text-emerald-600" : v >= 1 ? "text-amber-600" : "text-red-600";
  }

  return (
    <div>
      <PageHeader
        title={t("ads")}
        subtitle={t("adsSubtitle")}
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
              <UploadCloud size={16} />
              {importing ? t("importing") : t("importAds")}
            </button>
            {rows.length > 0 && (
              <button className="btn-secondary" onClick={exportCsv}>
                <Download size={16} />
                {t("exportCsv")}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>
        }
      />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div className="space-y-4">
          <div
            onClick={() => fileRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 p-12 text-center hover:border-brand-400 hover:bg-slate-50"
          >
            <UploadCloud className="h-12 w-12 text-brand-500" />
            <div className="font-semibold text-slate-700">{t("importAds")}</div>
            <div className="text-sm text-slate-500">{t("adsImportHint")}</div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <KpiCard label={t("totalSpend")} value={formatMoney(totals.spend, lang)} accent="red" />
            <KpiCard label={t("actualRevenue")} value={formatMoney(totals.actualRev, lang)} accent="green" />
            <KpiCard label={t("reportedValue")} value={formatMoney(totals.reportedRev, lang)} accent="slate" />
            <KpiCard label={t("blendedRoas")} value={`${totals.roas.toFixed(2)}x`} accent={totals.roas >= 2 ? "green" : "amber"} />
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-brand-50 border border-brand-100 px-4 py-3 text-sm text-brand-800">
            <Info size={16} className="shrink-0" />
            {t("adsMatchHint")}
          </div>

          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t("adName")}</th>
                  <th>{t("matchKeyword")}</th>
                  <th>{t("spend")}</th>
                  <th>{t("reportedPurchases")}</th>
                  <th>{t("actualOrders")}</th>
                  <th>{t("actualRevenue")}</th>
                  <th>{t("reportedRoas")}</th>
                  <th>{t("actualRoas")}</th>
                  <th>{t("actualCr")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="!whitespace-normal max-w-[180px]">
                      <div className="font-medium">{r.ad_name ?? "—"}</div>
                      <div className="text-[11px] text-slate-400">{r.campaign_name}</div>
                    </td>
                    <td>
                      {editing === r.id ? (
                        <div className="flex flex-col gap-1">
                          <input
                            className="input !py-1 text-xs w-32"
                            value={editKeyword}
                            onChange={(e) => setEditKeyword(e.target.value)}
                            placeholder={t("matchKeyword")}
                          />
                          <input
                            className="input !py-1 text-xs w-32"
                            dir="ltr"
                            value={editSku}
                            onChange={(e) => setEditSku(e.target.value)}
                            placeholder={t("mappedSku")}
                          />
                        </div>
                      ) : (
                        <span className="text-xs">
                          {r.mapped_sku ? (
                            <span className="font-mono text-brand-700" dir="ltr">{r.mapped_sku}</span>
                          ) : (
                            r.match_keyword ?? "—"
                          )}
                        </span>
                      )}
                    </td>
                    <td>{formatMoney(r.spend, lang)}</td>
                    <td className="text-slate-500">{r.reported_purchases != null ? formatNumber(r.reported_purchases) : "—"}</td>
                    <td className="font-semibold">{formatNumber(r.actual_orders)}</td>
                    <td className="font-semibold text-emerald-700">{formatMoney(r.actual_revenue, lang)}</td>
                    <td className="text-slate-400">{r.reported_roas != null ? `${r.reported_roas}x` : "—"}</td>
                    <td className={cn("font-bold", roasColor(r.actual_roas))}>
                      {r.actual_roas != null ? `${r.actual_roas}x` : "—"}
                    </td>
                    <td>{r.actual_cr != null ? `${r.actual_cr}%` : "—"}</td>
                    <td>
                      {editing === r.id ? (
                        <div className="flex gap-1">
                          <button className="rounded p-1 text-emerald-600 hover:bg-emerald-50" onClick={() => saveEdit(r.id)}>
                            <Check size={15} />
                          </button>
                          <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => setEditing(null)}>
                            <X size={15} />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="rounded p-1 text-slate-400 hover:bg-slate-100"
                          onClick={() => {
                            setEditing(r.id);
                            setEditKeyword(r.match_keyword ?? "");
                            setEditSku(r.mapped_sku ?? "");
                          }}
                        >
                          <Pencil size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
