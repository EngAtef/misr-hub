"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";
import { formatMoney, formatNumber, formatDate, toCsv, downloadCsv, cn } from "@/lib/utils";
import { ContactActions } from "@/components/contact-actions";

interface Ret {
  id: string; order_number: string | null; customer_name: string | null; customer_phone: string | null;
  reason: string | null; status: "requested" | "approved" | "picked_up" | "refunded" | "rejected";
  amount: number | null; created_at: string;
}

const FLOW: Ret["status"][] = ["requested", "approved", "picked_up", "refunded"];
const STATUS_STYLE: Record<string, string> = {
  requested: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  picked_up: "bg-violet-100 text-violet-800",
  refunded: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
};
const STATUS_KEY: Record<string, DictKey> = {
  requested: "rmaRequested", approved: "rmaApproved", picked_up: "rmaPickedUp", refunded: "rmaRefunded", rejected: "rmaRejected",
};

export default function ReturnsPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Ret[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("returns").select("*").order("created_at", { ascending: false }).limit(1000);
    setRows((data as Ret[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function seed() {
    const { data, error } = await supabase.rpc("fn_seed_returns");
    setMsg(error ? error.message : `✅ ${data} ${t("returnsSeeded")}`);
    load();
  }
  async function setStatus(r: Ret, status: Ret["status"]) {
    await supabase.from("returns").update({ status, updated_at: new Date().toISOString() }).eq("id", r.id);
    load();
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const filtered = filter ? rows.filter((r) => r.status === filter) : rows;
  const totalRefunded = rows.filter((r) => r.status === "refunded").reduce((s, r) => s + (r.amount ?? 0), 0);

  return (
    <div>
      <PageHeader
        title={t("returns")}
        subtitle={t("returnsSubtitle")}
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={seed}><RefreshCw size={16} />{t("seedReturns")}</button>
            {rows.length > 0 && (
              <button className="btn-secondary" onClick={() => downloadCsv(`returns-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows as unknown as Record<string, unknown>[]))}>
                <Download size={16} />{t("exportCsv")}
              </button>
            )}
          </div>
        }
      />

      {msg && <div className="mb-4 text-sm font-semibold text-emerald-700">{msg}</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6 mb-6">
        <button onClick={() => setFilter("")} className={cn("card p-3 text-start", filter === "" && "ring-2 ring-brand-400")}>
          <div className="text-xl font-bold">{formatNumber(rows.length)}</div>
          <div className="text-[11px] text-slate-500">{t("returns")}</div>
        </button>
        {(["requested", "approved", "picked_up", "refunded", "rejected"] as const).map((s) => (
          <button key={s} onClick={() => setFilter(filter === s ? "" : s)} className={cn("card p-3 text-start", filter === s && "ring-2 ring-brand-400")}>
            <div className="text-xl font-bold">{formatNumber(counts[s] ?? 0)}</div>
            <div className="text-[11px] text-slate-500">{t(STATUS_KEY[s])}</div>
          </button>
        ))}
      </div>

      <div className="mb-4 text-sm text-slate-600">{t("rmaRefunded")}: <b className="text-red-600">{formatMoney(totalRefunded, lang)}</b></div>

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState message={t("noResults")} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t("orderNumber")}</th>
                <th>{t("customer")}</th>
                <th>{t("reason")}</th>
                <th>{t("amount")}</th>
                <th>{t("date")}</th>
                <th>{t("status")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const nextIdx = FLOW.indexOf(r.status);
                const next = nextIdx >= 0 && nextIdx < FLOW.length - 1 ? FLOW[nextIdx + 1] : null;
                return (
                  <tr key={r.id}>
                    <td className="font-bold text-brand-700" dir="ltr">{r.order_number ? `#${r.order_number}` : "—"}</td>
                    <td>
                      <div className="font-medium">{r.customer_name ?? "—"}</div>
                      <div className="text-xs text-slate-400" dir="ltr">{r.customer_phone ?? ""}</div>
                    </td>
                    <td className="!whitespace-normal max-w-xs text-xs">{r.reason ?? "—"}</td>
                    <td>{formatMoney(r.amount, lang)}</td>
                    <td className="text-xs text-slate-500">{formatDate(r.created_at)}</td>
                    <td><span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_STYLE[r.status])}>{t(STATUS_KEY[r.status])}</span></td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <ContactActions phone={r.customer_phone} name={r.customer_name} orderNumber={r.order_number ?? ""} waReason="return_pending" />
                        {next && <button className="btn-secondary !py-1 !px-2 text-xs" onClick={() => setStatus(r, next)}>→ {t(STATUS_KEY[next])}</button>}
                        {r.status !== "rejected" && r.status !== "refunded" && (
                          <button className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => setStatus(r, "rejected")}><X size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
