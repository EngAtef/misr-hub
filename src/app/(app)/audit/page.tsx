"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

interface AuditRow {
  id: number;
  user_email: string | null;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export default function AuditPage() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        setRows((data as AuditRow[]) ?? []);
        setLoading(false);
      });
  }, [supabase]);

  return (
    <div>
      <PageHeader title={t("auditLog")} />
      <div className="card overflow-x-auto">
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-slate-500">{t("noResults")}</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>{t("date")}</th>
                <th>{t("user")}</th>
                <th>{t("action")}</th>
                <th>{t("details")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="text-xs text-slate-500">{formatDateTime(r.created_at)}</td>
                  <td dir="ltr">{r.user_email ?? "—"}</td>
                  <td>
                    <span className="inline-block rounded-full bg-brand-50 text-brand-700 px-2.5 py-0.5 text-xs font-semibold">
                      {r.action}
                    </span>
                  </td>
                  <td className="text-xs text-slate-500 !whitespace-normal max-w-lg" dir="ltr">
                    {r.details ? JSON.stringify(r.details) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
