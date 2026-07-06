"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { UserPlus, X, Pencil, Trash2, Crown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { PageHeader, Spinner } from "@/components/ui";
import { formatDateTime, cn } from "@/lib/utils";
import type { Role } from "@/lib/types";

interface ProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  role: Role;
  is_active: boolean;
  is_owner: boolean;
  created_at: string;
}

const PAGE_LABELS: Record<string, DictKey> = {
  overview: "overview",
  orders: "orders",
  products: "productsPage",
  analytics: "analytics",
  traffic: "traffic",
  insights: "insights",
  customers: "customers",
  ads: "ads",
  campaigns: "campaigns",
  delivery: "deliveryReports",
  stock: "stock",
  catalog: "catalog",
  targets: "targets",
  reports: "reports",
  team: "teamContacts",
  "data-center": "dataCenter",
  studio: "studio",
  assistant: "assistant",
};

export default function UsersPage() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<ProfileRow | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*").order("created_at");
    setUsers((data as ProfileRow[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function deleteUser(u: ProfileRow) {
    if (!confirm(`${t("confirmDelete")} (${u.email})`)) return;
    setError("");
    const { error: err } = await supabase.rpc("admin_delete_user", { p_user_id: u.id });
    if (err) setError(err.message);
    await load();
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

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{error}</div>
      )}

      <div className="card overflow-x-auto mb-8">
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
                  <td className="font-semibold">
                    <span className="inline-flex items-center gap-2">
                      {u.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">
                          {(u.full_name ?? u.email).slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      {u.is_owner && <Crown size={14} className="text-gold" />}
                      {u.full_name ?? "—"}
                    </span>
                  </td>
                  <td dir="ltr">
                    <div>{u.email}</div>
                    {u.phone && <div className="text-xs text-slate-400">{u.phone}</div>}
                  </td>
                  <td>
                    <span className={cn(
                      "inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      u.role === "admin" ? "bg-brand-100 text-brand-800" : u.role === "manager" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
                    )}>
                      {u.is_owner ? t("owner") : t(u.role as DictKey)}
                    </span>
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
                    <div className="flex gap-1 justify-end">
                      <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setEditing(u)}>
                        <Pencil size={15} />
                      </button>
                      {!u.is_owner && (
                        <button className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => deleteUser(u)}>
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreated={load} />}
      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pageAccess, setPageAccess] = useState<Record<string, boolean>>(
    Object.fromEntries(Object.keys(PAGE_LABELS).map((k) => [k, true]))
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", email, password, fullName, phone, role }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed");
      setSaving(false);
      return;
    }

    // Save the manually-selected page checklist for this new account
    if (role !== "admin" && data.userId) {
      const rows = Object.entries(pageAccess).map(([page_key, allowed]) => ({
        user_id: data.userId,
        page_key,
        allowed,
      }));
      const { error: permErr } = await supabase.from("user_page_access").insert(rows);
      if (permErr) {
        setError(permErr.message);
        setSaving(false);
        return;
      }
    }
    onCreated();
    onClose();
  }

  return (
    <Modal title={t("addUser")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("fullName")}>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label={t("email")}>
          <input type="email" className="input" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t("phoneNumber")}>
          <input className="input" dir="ltr" placeholder="+2010..." value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label={t("password")}>
          <input type="text" className="input" dir="ltr" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label={t("role")}>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="viewer">{t("viewer")} — {t("roleViewerDesc")}</option>
            <option value="manager">{t("manager")} — {t("roleManagerDesc")}</option>
            <option value="admin">{t("admin")} — {t("roleAdminDesc")}</option>
          </select>
        </Field>

        {role !== "admin" && (
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="text-sm font-bold mb-1">{t("userAccessList")}</div>
            <p className="text-[11px] text-slate-400 mb-3">{t("accessControlHint")}</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {Object.entries(PAGE_LABELS).map(([key, labelKey]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-600"
                    checked={pageAccess[key] ?? true}
                    onChange={(e) => setPageAccess((p) => ({ ...p, [key]: e.target.checked }))}
                  />
                  {t(labelKey)}
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={saving}>
          {saving ? t("creating") : t("create")}
        </button>
      </form>
    </Modal>
  );
}

function EditUserModal({ user, onClose, onSaved }: { user: ProfileRow; onClose: () => void; onSaved: () => void }) {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [fullName, setFullName] = useState(user.full_name ?? "");
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(user.role);
  const [isActive, setIsActive] = useState(user.is_active);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [useDefaults, setUseDefaults] = useState(true);
  const [pageAccess, setPageAccess] = useState<Record<string, boolean>>(
    Object.fromEntries(Object.keys(PAGE_LABELS).map((k) => [k, true]))
  );

  useEffect(() => {
    supabase
      .from("user_page_access")
      .select("page_key, allowed")
      .eq("user_id", user.id)
      .then(({ data }) => {
        const rows = (data as { page_key: string; allowed: boolean }[]) ?? [];
        if (rows.length) {
          setUseDefaults(false);
          setPageAccess((prev) => {
            const next = { ...prev };
            for (const r of rows) next[r.page_key] = r.allowed;
            return next;
          });
        }
      });
  }, [supabase, user.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const { error: err } = await supabase.rpc("admin_update_user", {
      p_user_id: user.id,
      p_full_name: fullName || null,
      p_email: email !== user.email ? email : null,
      p_password: password || null,
      p_role: role !== user.role ? role : null,
      p_is_active: isActive !== user.is_active ? isActive : null,
    });
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }

    // Per-account page checklist (overrides role defaults)
    await supabase.from("user_page_access").delete().eq("user_id", user.id);
    if (!useDefaults && role !== "admin") {
      const rows = Object.entries(pageAccess).map(([page_key, allowed]) => ({
        user_id: user.id,
        page_key,
        allowed,
      }));
      const { error: permErr } = await supabase.from("user_page_access").insert(rows);
      if (permErr) {
        setError(permErr.message);
        setSaving(false);
        return;
      }
    }
    onSaved();
  }

  return (
    <Modal title={`${t("editUser")} — ${user.email}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("fullName")}>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label={t("email")}>
          <input type="email" className="input" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t("newPassword")}>
          <input type="text" className="input" dir="ltr" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("role")}>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={user.is_owner}>
              <option value="viewer">{t("viewer")}</option>
              <option value="manager">{t("manager")}</option>
              <option value="admin">{t("admin")}</option>
            </select>
          </Field>
          <Field label={t("status")}>
            <select className="input" value={isActive ? "1" : "0"} onChange={(e) => setIsActive(e.target.value === "1")} disabled={user.is_owner}>
              <option value="1">{t("active")}</option>
              <option value="0">{t("inactive")}</option>
            </select>
          </Field>
        </div>

        {role !== "admin" && (
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-bold">{t("userAccessList")}</div>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-brand-600"
                  checked={useDefaults}
                  onChange={(e) => setUseDefaults(e.target.checked)}
                />
                {t("useRoleDefaults")}
              </label>
            </div>
            <p className="text-[11px] text-slate-400 mb-3">{t("userAccessHint")}</p>
            <div className={cn("grid grid-cols-2 gap-x-3 gap-y-2", useDefaults && "opacity-40 pointer-events-none")}>
              {Object.entries(PAGE_LABELS).map(([key, labelKey]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-600"
                    checked={pageAccess[key] ?? true}
                    onChange={(e) => setPageAccess((p) => ({ ...p, [key]: e.target.checked }))}
                  />
                  {t(labelKey)}
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={saving}>
          {t("save")}
        </button>
      </form>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md card p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold truncate">{title}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 shrink-0">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold mb-1">{label}</label>
      {children}
    </div>
  );
}
