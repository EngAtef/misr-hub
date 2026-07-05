"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { UserPlus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { PageHeader, Spinner } from "@/components/ui";
import { formatDateTime, cn } from "@/lib/utils";
import type { Profile, Role } from "@/lib/types";

export default function UsersPage() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*").order("created_at");
    setUsers((data as Profile[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateUser(userId: string, patch: { role?: Role; isActive?: boolean }) {
    setBusy(userId);
    await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", userId, ...patch }),
    });
    await load();
    setBusy(null);
  }

  return (
    <div>
      <PageHeader
        title={t("users")}
        actions={
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <UserPlus size={16} />
            {t("addUser")}
          </button>
        }
      />

      <div className="grid gap-3 mb-6 md:grid-cols-3">
        {(["admin", "manager", "viewer"] as const).map((r) => (
          <div key={r} className="card p-4">
            <div className="font-bold">{t(r as DictKey)}</div>
            <div className="text-xs text-slate-500 mt-1">{t(`role${r.charAt(0).toUpperCase() + r.slice(1)}Desc` as DictKey)}</div>
          </div>
        ))}
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <Spinner />
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>{t("fullName")}</th>
                <th>{t("email")}</th>
                <th>{t("role")}</th>
                <th>{t("status")}</th>
                <th>{t("date")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="font-semibold">{u.full_name ?? "—"}</td>
                  <td dir="ltr">{u.email}</td>
                  <td>
                    <select
                      className="input !w-auto !py-1 text-xs"
                      value={u.role}
                      disabled={busy === u.id}
                      onChange={(e) => updateUser(u.id, { role: e.target.value as Role })}
                    >
                      <option value="admin">{t("admin")}</option>
                      <option value="manager">{t("manager")}</option>
                      <option value="viewer">{t("viewer")}</option>
                    </select>
                  </td>
                  <td>
                    <span
                      className={cn(
                        "inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        u.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
                      )}
                    >
                      {u.is_active ? t("active") : t("inactive")}
                    </span>
                  </td>
                  <td className="text-xs text-slate-500">{formatDateTime(u.created_at)}</td>
                  <td>
                    <button
                      className="btn-secondary !py-1 !px-3 text-xs"
                      disabled={busy === u.id}
                      onClick={() => updateUser(u.id, { isActive: !u.is_active })}
                    >
                      {u.is_active ? t("deactivate") : t("activate")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useLang();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", email, password, fullName, role }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed");
      setSaving(false);
      return;
    }
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full max-w-md card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{t("addUser")}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">{t("fullName")}</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">{t("email")}</label>
          <input type="email" className="input" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">{t("password")}</label>
          <input type="text" className="input" dir="ltr" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">{t("role")}</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="viewer">{t("viewer")} — {t("roleViewerDesc")}</option>
            <option value="manager">{t("manager")} — {t("roleManagerDesc")}</option>
            <option value="admin">{t("admin")} — {t("roleAdminDesc")}</option>
          </select>
        </div>
        {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={saving}>
          {saving ? t("creating") : t("create")}
        </button>
      </form>
    </div>
  );
}
