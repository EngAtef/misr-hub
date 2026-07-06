"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Plus, Mail, MessageCircle, Pencil, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";
import { normalizeEgyptPhone } from "@/lib/whatsapp";

interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  notes: string | null;
  is_active: boolean;
}

export default function TeamPage() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Contact | null | "new">(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("team_contacts").select("*").order("created_at");
    setRows((data as Contact[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    await supabase.from("team_contacts").delete().eq("id", id);
    load();
  }

  return (
    <div>
      <PageHeader
        title={t("teamContacts")}
        subtitle={t("teamSubtitle")}
        actions={
          <button className="btn-primary" onClick={() => setEditing("new")}>
            <Plus size={16} />
            {t("addContact")}
          </button>
        }
      />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message={t("noResults")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => {
            const wa = normalizeEgyptPhone(c.phone);
            return (
              <div key={c.id} className="card p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-bold">
                      {c.name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-bold">{c.name}</div>
                      <div className="text-xs text-slate-500">{c.title ?? "—"}</div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" onClick={() => setEditing(c)}>
                      <Pencil size={15} />
                    </button>
                    <button className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => remove(c.id)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <div className="mt-3 space-y-1 text-sm text-slate-600">
                  {c.email && <div dir="ltr" className="truncate">{c.email}</div>}
                  {c.phone && <div dir="ltr">{c.phone}</div>}
                  {c.notes && <div className="text-xs text-slate-400">{c.notes}</div>}
                </div>

                <div className="mt-4 flex gap-2">
                  <a
                    href={c.email ? `mailto:${c.email}` : undefined}
                    className={c.email ? "btn-secondary flex-1 !py-1.5 text-xs" : "btn-secondary flex-1 !py-1.5 text-xs opacity-40 pointer-events-none"}
                  >
                    <Mail size={14} />
                    {t("sendEmail")}
                  </a>
                  <a
                    href={wa ? `https://wa.me/${wa}` : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={wa ? "flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100" : "flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-300 pointer-events-none"}
                  >
                    <MessageCircle size={14} />
                    {t("sendWhatsapp")}
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ContactModal
          contact={editing === "new" ? null : editing}
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

function ContactModal({ contact, onClose, onSaved }: { contact: Contact | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [form, setForm] = useState({
    name: contact?.name ?? "",
    title: contact?.title ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    notes: contact?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      name: form.name,
      title: form.title || null,
      email: form.email || null,
      phone: form.phone || null,
      notes: form.notes || null,
    };
    const q = contact
      ? supabase.from("team_contacts").update(payload).eq("id", contact.id)
      : supabase.from("team_contacts").insert(payload);
    const { error: err } = await q;
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full max-w-md card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{contact ? t("editCampaign") : t("addContact")}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">{t("fullName")}</label>
          <input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">{t("role")}</label>
          <input className="input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">{t("email")}</label>
          <input type="email" className="input" dir="ltr" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">{t("phone")}</label>
          <input className="input" dir="ltr" placeholder="01xxxxxxxxx" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">{t("notes")}</label>
          <input className="input" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </div>
        {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={saving}>
          {t("save")}
        </button>
      </form>
    </div>
  );
}
