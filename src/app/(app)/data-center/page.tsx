"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { UploadCloud, FileSpreadsheet, CheckCircle2, XCircle, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner } from "@/components/ui";
import { formatDateTime, formatNumber, cn } from "@/lib/utils";
import { parseOrdersWorkbook, hasOrderNumberColumn, type ParsedOrder } from "@/lib/import/parse-orders";

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

type Phase = "idle" | "parsing" | "ready" | "importing" | "done" | "error";

export default function DataCenterPage() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedOrder[]>([]);
  const [progress, setProgress] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [failed, setFailed] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [history, setHistory] = useState<UploadRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from("uploads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    setHistory((data as UploadRecord[]) ?? []);
    setHistoryLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function handleFile(file: File) {
    setFileName(file.name);
    setPhase("parsing");
    setErrorMsg("");
    try {
      const buffer = await file.arrayBuffer();
      if (!hasOrderNumberColumn(buffer)) {
        setPhase("error");
        setErrorMsg(t("invalidFile"));
        return;
      }
      const result = parseOrdersWorkbook(buffer);
      setParsed(result.orders);
      setPhase("ready");
    } catch {
      setPhase("error");
      setErrorMsg(t("invalidFile"));
    }
  }

  async function startImport() {
    setPhase("importing");
    setProgress(0);
    setProcessed(0);
    setFailed(0);

    let uploadId: string | null = null;
    let ok = 0;
    let bad = 0;

    try {
      const startRes = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", fileName, totalRows: parsed.length }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error ?? "start failed");
      uploadId = startData.uploadId;

      for (let i = 0; i < parsed.length; i += CHUNK_SIZE) {
        const chunk = parsed.slice(i, i + CHUNK_SIZE);
        const res = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "chunk", uploadId, orders: chunk }),
        });
        if (res.ok) {
          ok += chunk.length;
        } else {
          bad += chunk.length;
        }
        setProcessed(ok);
        setFailed(bad);
        setProgress(Math.round(((i + chunk.length) / parsed.length) * 100));
      }

      await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "finish",
          uploadId,
          fileName,
          processedRows: ok,
          failedRows: bad,
        }),
      });

      setPhase("done");
      loadHistory();
    } catch (e) {
      setPhase("error");
      setErrorMsg(e instanceof Error ? e.message : "Import failed");
      if (uploadId) {
        fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "finish",
            uploadId,
            fileName,
            processedRows: ok,
            failedRows: parsed.length - ok,
            errorMessage: String(e),
          }),
        });
      }
    }
  }

  function reset() {
    setPhase("idle");
    setParsed([]);
    setFileName("");
    setProgress(0);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div>
      <PageHeader title={t("dataCenter")} />

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
                "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-12 text-center transition",
                dragOver ? "border-brand-500 bg-brand-50" : "border-slate-300 hover:border-brand-400 hover:bg-slate-50"
              )}
            >
              <UploadCloud className="h-12 w-12 text-brand-500" />
              <div className="font-semibold text-slate-700">{t("uploadOrders")}</div>
              <div className="text-sm text-slate-500">{t("uploadHint")}</div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
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
            <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
              <Info size={14} />
              {t("duplicateNote")}
            </div>
          </>
        ) : phase === "parsing" ? (
          <div className="py-12 text-center">
            <Spinner />
            <div className="text-sm text-slate-600">{t("parsing")}</div>
          </div>
        ) : phase === "ready" ? (
          <div className="text-center py-8 space-y-4">
            <FileSpreadsheet className="mx-auto h-12 w-12 text-emerald-500" />
            <div>
              <div className="font-bold text-lg" dir="ltr">{fileName}</div>
              <div className="text-slate-600">
                {formatNumber(parsed.length)} {t("rowsFound")}
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
              <div
                className="h-full rounded-full bg-brand-600 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-center text-sm text-slate-600">
              {formatNumber(processed)} / {formatNumber(parsed.length)} {t("rowsImported")}
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
