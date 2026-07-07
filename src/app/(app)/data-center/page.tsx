"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { UploadCloud, FileSpreadsheet, CheckCircle2, XCircle, Info, ShoppingCart, Boxes, LineChart, Megaphone, Users, BookOpen, Coins } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner } from "@/components/ui";
import { formatDateTime, formatNumber, cn } from "@/lib/utils";
import { parseOrdersWorkbook, hasOrderNumberColumn, type ParsedOrder } from "@/lib/import/parse-orders";
import { parseStockFile, type StockRow } from "@/lib/import/parse-stock";
import { parseGa4Any, type Ga4AnyParsed } from "@/lib/import/parse-ga4";
import { parseAdsFile, type ParsedAdRow } from "@/lib/import/parse-ads";
import { parseCustomersFile, type CustomerRow } from "@/lib/import/parse-customers";
import { parseCostsFile, type CostRow } from "@/lib/import/parse-costs";

const CHUNK_SIZE = 250;

interface UploadRecord {
  id: string;
  file_name: string;
  uploaded_by_email: string | null;
  total_rows: number;
  processed_rows: number;
  failed_rows: number;
  status: string;
  created_at: string;
}

type UploadType = "orders" | "customers" | "stock" | "costs" | "ga4_pages" | "ga4_tx" | "ga4_items" | "ads";

const GA4_EXPECTED: Record<string, "pages" | "transactions" | "items"> = {
  ga4_pages: "pages",
  ga4_tx: "transactions",
  ga4_items: "items",
};
type Phase = "idle" | "parsing" | "ready" | "importing" | "done" | "error";

interface Pending {
  type: UploadType;
  fileName: string;
  orders?: ParsedOrder[];
  customers?: CustomerRow[];
  stock?: StockRow[];
  costs?: CostRow[];
  ga4?: Ga4AnyParsed;
  ads?: ParsedAdRow[];
  count: number;
  extra?: string;
}

export default function DataCenterPage() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [activeType, setActiveType] = useState<UploadType>("orders");
  const [phase, setPhase] = useState<Phase>("idle");
  const [pending, setPending] = useState<Pending | null>(null);
  const [progress, setProgress] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [failed, setFailed] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [history, setHistory] = useState<UploadRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  const loadHistory = useCallback(async () => {
    const { data } = await supabase.from("uploads").select("*").order("created_at", { ascending: false }).limit(25);
    setHistory((data as UploadRecord[]) ?? []);
    setHistoryLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const TYPES: { key: UploadType; icon: React.ElementType; title: string; hint: string; accept: string }[] = [
    { key: "orders", icon: ShoppingCart, title: t("uploadOrders"), hint: t("uploadOrdersHint2"), accept: ".xlsx,.xls,.csv" },
    { key: "customers", icon: Users, title: t("uploadCustomers"), hint: t("uploadCustomersHint"), accept: ".xlsx,.xls,.csv" },
    { key: "stock", icon: Boxes, title: t("uploadStock"), hint: t("uploadSapHint"), accept: ".xlsx,.xls,.csv" },
    { key: "costs", icon: Coins, title: t("uploadCosts"), hint: t("uploadCostsHint"), accept: ".xlsx,.xls,.csv" },
    { key: "ga4_pages", icon: LineChart, title: t("uploadGa4Pages"), hint: t("uploadGa4PagesHint"), accept: ".csv" },
    { key: "ga4_tx", icon: LineChart, title: t("uploadGa4Tx"), hint: t("uploadGa4TxHint"), accept: ".csv" },
    { key: "ga4_items", icon: LineChart, title: t("uploadGa4Items"), hint: t("uploadGa4ItemsHint"), accept: ".csv" },
    { key: "ads", icon: Megaphone, title: t("uploadAdsHere"), hint: t("adsImportHint"), accept: ".csv,.xlsx" },
  ];

  async function handleFile(file: File) {
    setPhase("parsing");
    setErrorMsg("");
    try {
      if (activeType === "orders") {
        const buffer = await file.arrayBuffer();
        if (!hasOrderNumberColumn(buffer)) throw new Error(t("invalidFile"));
        const result = parseOrdersWorkbook(buffer);
        setPending({ type: "orders", fileName: file.name, orders: result.orders, count: result.orders.length });
      } else if (activeType === "customers") {
        const buffer = await file.arrayBuffer();
        const rows = parseCustomersFile(buffer);
        if (!rows.length) throw new Error(t("invalidFile"));
        setPending({ type: "customers", fileName: file.name, customers: rows, count: rows.length });
      } else if (activeType === "stock") {
        const buffer = await file.arrayBuffer();
        const rows = parseStockFile(buffer);
        if (!rows.length) throw new Error(t("invalidFile"));
        setPending({ type: "stock", fileName: file.name, stock: rows, count: rows.length });
      } else if (activeType === "costs") {
        const buffer = await file.arrayBuffer();
        const rows = parseCostsFile(buffer);
        if (!rows.length) throw new Error(t("invalidFile"));
        setPending({ type: "costs", fileName: file.name, costs: rows, count: rows.length });
      } else if (activeType.startsWith("ga4")) {
        const text = await file.text();
        const parsed = parseGa4Any(text);
        if (!parsed) throw new Error(t("invalidFile"));
        // strict per-card validation: right report type. Multi-month (all-time)
        // files are allowed: transactions merge by id; pages/items are stored
        // under their start month as an "all period" bucket.
        if (parsed.kind !== GA4_EXPECTED[activeType]) throw new Error(t("wrongFileForCard"));
        const count =
          parsed.kind === "pages" ? parsed.rows.length : parsed.kind === "transactions" ? parsed.transactions.length : parsed.items.length;
        if (!count) throw new Error(t("invalidFile"));
        setPending({
          type: activeType,
          fileName: file.name,
          ga4: parsed,
          count,
          extra: `${parsed.month.slice(0, 7)} · ${parsed.kind}`,
        });
      } else {
        const buffer = await file.arrayBuffer();
        const rows = parseAdsFile(buffer, file.name);
        if (!rows.length) throw new Error(t("invalidFile"));
        setPending({ type: "ads", fileName: file.name, ads: rows, count: rows.length });
      }
      setPhase("ready");
    } catch (e) {
      setPhase("error");
      setErrorMsg(e instanceof Error ? e.message : t("invalidFile"));
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function recordUpload(fileName: string, total: number, ok: number, bad: number) {
    await supabase.from("uploads").insert({
      file_name: fileName,
      uploaded_by_email: (await supabase.auth.getUser()).data.user?.email ?? null,
      total_rows: total,
      processed_rows: ok,
      failed_rows: bad,
      status: bad > 0 && ok === 0 ? "failed" : "completed",
      finished_at: new Date().toISOString(),
    });
  }

  async function startImport() {
    if (!pending) return;
    setPhase("importing");
    setProgress(0);
    setProcessed(0);
    setFailed(0);

    try {
      if (pending.type === "orders" && pending.orders) {
        let uploadId: string | null = null;
        let ok = 0;
        let bad = 0;
        const startRes = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", fileName: pending.fileName, totalRows: pending.orders.length }),
        });
        const startData = await startRes.json();
        if (!startRes.ok) throw new Error(startData.error ?? "start failed");
        uploadId = startData.uploadId;

        for (let i = 0; i < pending.orders.length; i += CHUNK_SIZE) {
          const chunk = pending.orders.slice(i, i + CHUNK_SIZE);
          const res = await fetch("/api/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "chunk", uploadId, orders: chunk }),
          });
          if (res.ok) ok += chunk.length;
          else bad += chunk.length;
          setProcessed(ok);
          setFailed(bad);
          setProgress(Math.round(((i + chunk.length) / pending.orders.length) * 100));
        }
        await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "finish", uploadId, fileName: pending.fileName, processedRows: ok, failedRows: bad }),
        });
      } else if (pending.type === "customers" && pending.customers) {
        let ok = 0;
        for (let i = 0; i < pending.customers.length; i += 2000) {
          const chunk = pending.customers.slice(i, i + 2000);
          const { error } = await supabase.rpc("fn_upsert_customers", { p_rows: chunk });
          if (error) throw new Error(error.message);
          ok += chunk.length;
          setProcessed(ok);
          setProgress(Math.round((ok / pending.customers.length) * 100));
        }
        await recordUpload(pending.fileName, pending.customers.length, ok, 0);
      } else if (pending.type === "stock" && pending.stock) {
        const { data, error } = await supabase.rpc("fn_upsert_stock", { p_rows: pending.stock });
        if (error) throw new Error(error.message);
        setProcessed(Number(data ?? pending.stock.length));
        setProgress(100);
        await recordUpload(pending.fileName, pending.stock.length, Number(data ?? pending.stock.length), 0);
      } else if (pending.type === "costs" && pending.costs) {
        let ok = 0;
        for (let i = 0; i < pending.costs.length; i += 2000) {
          const chunk = pending.costs.slice(i, i + 2000);
          const { error } = await supabase.rpc("fn_upsert_stock", { p_rows: chunk });
          if (error) throw new Error(error.message);
          ok += chunk.length;
          setProcessed(ok);
          setProgress(Math.round((ok / pending.costs.length) * 100));
        }
        await recordUpload(pending.fileName, pending.costs.length, ok, 0);
      } else if (pending.type.startsWith("ga4") && pending.ga4) {
        const g = pending.ga4;
        let ok = 0;
        if (g.kind === "pages") {
          // replace this month's rows (safe re-upload)
          await supabase.from("ga4_pages").delete().eq("period_month", g.month);
          for (let i = 0; i < g.rows.length; i += 500) {
            const chunk = g.rows.slice(i, i + 500);
            const { error } = await supabase.from("ga4_pages").insert(chunk);
            if (error) throw new Error(error.message);
            ok += chunk.length;
            setProcessed(ok);
            setProgress(Math.round((ok / g.rows.length) * 100));
          }
        } else if (g.kind === "transactions") {
          for (let i = 0; i < g.transactions.length; i += 1000) {
            const chunk = g.transactions.slice(i, i + 1000);
            const { error } = await supabase.from("ga4_transactions").upsert(chunk, { onConflict: "transaction_id" });
            if (error) throw new Error(error.message);
            ok += chunk.length;
            setProcessed(ok);
            setProgress(Math.round((ok / g.transactions.length) * 100));
          }
        } else {
          await supabase.from("ga4_items").delete().eq("period_month", g.month);
          for (let i = 0; i < g.items.length; i += 1000) {
            const chunk = g.items.slice(i, i + 1000);
            const { error } = await supabase.from("ga4_items").insert(chunk);
            if (error) throw new Error(error.message);
            ok += chunk.length;
            setProcessed(ok);
            setProgress(Math.round((ok / g.items.length) * 100));
          }
        }
        await recordUpload(pending.fileName, pending.count, ok, 0);
      } else if (pending.type === "ads" && pending.ads) {
        const res = await fetch("/api/ads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "import",
            rows: pending.ads,
            batchLabel: pending.fileName.replace(/\.(csv|xlsx?)$/i, ""),
          }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error ?? "failed");
        setProcessed(pending.ads.length);
        setProgress(100);
        await recordUpload(pending.fileName, pending.ads.length, pending.ads.length, 0);
      }
      setPhase("done");
      loadHistory();
    } catch (e) {
      setPhase("error");
      setErrorMsg(e instanceof Error ? e.message : t("importFailed"));
    }
  }

  function reset() {
    setPhase("idle");
    setPending(null);
    setProgress(0);
  }

  const active = TYPES.find((x) => x.key === activeType)!;

  return (
    <div>
      <PageHeader title={t("dataCenter")} subtitle={t("chooseUploadType")} />

      <div className="grid gap-3 mb-5 sm:grid-cols-2 xl:grid-cols-4">
        {TYPES.map((x) => {
          const Icon = x.icon;
          return (
            <button
              key={x.key}
              onClick={() => {
                setActiveType(x.key);
                reset();
              }}
              className={cn(
                "card p-4 text-start transition hover:shadow-md",
                activeType === x.key && "ring-2 ring-brand-500"
              )}
            >
              <Icon size={20} className={activeType === x.key ? "text-brand-600" : "text-slate-400"} />
              <div className="mt-2 font-bold text-sm">{x.title}</div>
              <div className="mt-0.5 text-xs text-slate-500 leading-relaxed">{x.hint}</div>
            </button>
          );
        })}
        <Link href="/catalog" className="card p-4 text-start transition hover:shadow-md border-dashed">
          <BookOpen size={20} className="text-slate-400" />
          <div className="mt-2 font-bold text-sm">{t("catalog")}</div>
          <div className="mt-0.5 text-xs text-slate-500 leading-relaxed">{t("goToCatalog")}</div>
        </Link>
      </div>

      <div className="mb-5 flex items-start gap-2 rounded-lg bg-brand-50 border border-brand-100 px-4 py-3 text-sm text-brand-800">
        <Users size={16} className="shrink-0 mt-0.5" />
        {t("customersNote")}
      </div>

      <div className="card p-6 mb-6">
        {phase === "idle" || phase === "error" ? (
          <>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleFile(file);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition",
                dragOver ? "border-brand-500 bg-brand-50" : "border-slate-300 hover:border-brand-400 hover:bg-slate-50"
              )}
            >
              <UploadCloud className="h-11 w-11 text-brand-500" />
              <div className="font-semibold text-slate-700">{active.title}</div>
              <div className="text-sm text-slate-500">{active.hint}</div>
              <input
                ref={fileRef}
                type="file"
                accept={active.accept}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </div>
            {phase === "error" && (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                <XCircle size={18} />
                {errorMsg}
              </div>
            )}
            {activeType === "orders" && (
              <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                <Info size={14} />
                {t("duplicateNote")}
              </div>
            )}
          </>
        ) : phase === "parsing" ? (
          <div className="py-10 text-center">
            <Spinner />
            <div className="text-sm text-slate-600">{t("parsing")}</div>
          </div>
        ) : phase === "ready" && pending ? (
          <div className="text-center py-8 space-y-4">
            <FileSpreadsheet className="mx-auto h-12 w-12 text-emerald-500" />
            <div>
              <div className="font-bold text-lg" dir="ltr">{pending.fileName}</div>
              <div className="text-slate-600">
                {formatNumber(pending.count)} {t("rowsReady")}
                {pending.extra && (
                  <span className="ms-2 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-bold text-brand-700" dir="ltr">
                    {t("monthDetected")}: {pending.extra}
                  </span>
                )}
              </div>
            </div>
            <div className="flex justify-center gap-3">
              <button className="btn-primary" onClick={startImport}>
                {t("startImport")}
              </button>
              <button className="btn-secondary" onClick={reset}>
                {t("cancel")}
              </button>
            </div>
          </div>
        ) : phase === "importing" ? (
          <div className="py-8 space-y-4">
            <div className="text-center font-semibold">{t("importing")}</div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-600 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <div className="text-center text-sm text-slate-600">
              {formatNumber(processed)} {t("rowsImported")}
              {failed > 0 && <span className="text-red-600"> — {formatNumber(failed)} {t("rowsFailedLabel")}</span>}
            </div>
          </div>
        ) : (
          <div className="py-10 text-center space-y-4">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
            <div className="text-lg font-bold text-emerald-700">{t("importComplete")}</div>
            <div className="text-sm text-slate-600">
              {formatNumber(processed)} {t("rowsImported")}
              {failed > 0 && <span className="text-red-600"> — {formatNumber(failed)} {t("rowsFailedLabel")}</span>}
            </div>
            <button className="btn-primary" onClick={reset}>
              {t("uploadOrders")}
            </button>
          </div>
        )}
      </div>

      <h2 className="mb-3 text-lg font-bold">{t("uploadHistory")}</h2>
      <div className="card overflow-x-auto">
        {historyLoading ? (
          <Spinner />
        ) : history.length === 0 ? (
          <div className="p-8 text-center text-slate-500">{t("noResults")}</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>{t("fileName")}</th>
                <th>{t("uploadedBy")}</th>
                <th>{t("rows")}</th>
                <th>{t("status")}</th>
                <th>{t("date")}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td dir="ltr" className="font-medium">{h.file_name}</td>
                  <td className="text-slate-600">{h.uploaded_by_email ?? "—"}</td>
                  <td>
                    {formatNumber(h.processed_rows)} / {formatNumber(h.total_rows)}
                    {h.failed_rows > 0 && <span className="text-red-600 text-xs"> ({h.failed_rows} failed)</span>}
                  </td>
                  <td>
                    <span
                      className={cn(
                        "inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        h.status === "completed"
                          ? "bg-emerald-100 text-emerald-800"
                          : h.status === "failed"
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-800"
                      )}
                    >
                      {h.status}
                    </span>
                  </td>
                  <td className="text-xs text-slate-500">{formatDateTime(h.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
