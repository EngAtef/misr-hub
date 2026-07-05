"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Plus, X, Trash2, Pencil, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";
import { formatMoney, formatNumber, formatDate, cn } from "@/lib/utils";

interface Campaign {
  id: string;
  name: string;
  channel: string;
  status: "draft" | "active" | "paused" | "completed";
  budget: number | null;
  spent: number | null;
  start_date: string | null;
  end_date: string | null;
  promo_code: string | null;
  campaign_key: string | null;
  target_audience: string | null;
  notes: string | null;
}

interface CampaignStats {
  orders: number;
  revenue: number;
  delivered: number;
  cancelled: number;
  unique_customers: number;
  avg_order_value: number;
}

const CHANNELS = ["facebook", "instagram", "tiktok", "google", "email", "sms", "whatsapp", "influencer", "offline", "other"];

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  active: "bg-emerald-100 text-emerald-800",
  paused: "bg-amber-100 text-amber-800",
  completed: "bg-blue-100 text-blue-800",
};

export default function CampaignsPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [stats, setStats] = useState<Record<string, CampaignStats>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Campaign | null | "new">(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("campaigns").select("*").order("created_at", { ascending: false });
    const list = (data as Campaign[]) ?? [];
    setCampaigns(list);
    setLoading(false);

    const entries = await Promise.all(
      list.map(async (c) => {
        const { data: s } = await supabase.rpc("fn_campaign_stats", {
          p_promo: c.promo_code,
          p_campaign_key: c.campaign_key,
          p_from: c.start_date,
          p_to: c.end_date,
        });
        return [c.id, s as CampaignStats] as const;
      })
    );
    setStats(Object.fromEntries(entries));
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    await supabase.from("campaigns").delete().eq("id", id);
    load();
  }

  return (
    <div>
      <PageHeader
        title={t("campaigns")}
        actions={
          <button className="btn-primary" onClick={() => setEditing("new")}>
            <Plus size={16} />
            {t("newCampaign")}
          </button>
        }
      />

      <div className="mb-4 flex items-center gap-2 rounded-lg bg-brand-50 border border-brand-100 px-4 py-3 text-sm text-brand-800">
        <Info size={16} className="shrink-0" />
        {t("campaignHint")}
      </div>

      {loading ? (
        <Spinner />
      ) : campaigns.length === 0 ? (
        <EmptyState message={t("noResults")} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {campaigns.map((c) => {
            const s = stats[c.id];
            const spent = Number(c.spent ?? 0);
            const roas = s && spent > 0 ? s.revenue / spent : null;
            return (
              <div key={c.id} className="card p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-slate-900">{c.name}</h3>
                      <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_STYLES[c.status])}>
                        {t(
                          (c.status === "active"
                            ? "activeCampaign"
                            : c.status) as DictKey
                        )}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500 capitalize">
                      {c.channel} · {formatDate(c.start_date)} → {formatDate(c.end_date)}
                      {c.promo_code && (
                        <span className="ms-2 rounded bg-gold/20 px-1.5 py-0.5 font-mono text-[11px] text-amber-800" dir="ltr">
                          {c.promo_code}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setEditing(c)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => remove(c.id)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-lg font-bold">{s ? formatNumber(s.orders) : "…"}</div>
                    <div className="text-[11px] text-slate-500">{t("attributedOrders")}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-lg font-bold">{s ? formatMoney(s.revenue, lang) : "…"}</div>
                    <div className="text-[11px] text-slate-500">{t("attributedRevenue")}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className={cn("text-lg font-bold", roas !== null && (roas >= 3 ? "text-emerald-600" : roas >= 1 ? "text-amber-600" : "text-red-600"))}>
                      {roas !== null ? `${roas.toFixed(1)}x` : "—"}
                    </div>
                    <div className="text-[11px] text-slate-500">{t("roi")}</div>
                  </div>
                </div>

                <div className="mt-3 flex justify-between text-xs text-slate-500">
                  <span>
                    {t("budget")}: <b>{formatMoney(c.budget, lang)}</b>
                  </span>
                  <span>
                    {t("spent")}: <b>{formatMoney(c.spent, lang)}</b>
                  </span>
                  {c.target_audience && <span className="truncate max-w-[40%]">{c.target_audience}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <CampaignModal
          campaign={editing === "new" ? null : editing}
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

function CampaignModal({
  campaign,
  onClose,
  onSaved,
}: {
  campaign: Campaign | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [form, setForm] = useState({
    name: campaign?.name ?? "",
    channel: campaign?.channel ?? "facebook",
    status: campaign?.status ?? "draft",
    budget: campaign?.budget?.toString() ?? "",
    spent: campaign?.spent?.toString() ?? "",
    start_date: campaign?.start_date ?? "",
    end_date: campaign?.end_date ?? "",
    promo_code: campaign?.promo_code ?? "",
    campaign_key: campaign?.campaign_key ?? "",
    target_audience: campaign?.target_audience ?? "",
    notes: campaign?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      name: form.name,
      channel: form.channel,
      status: form.status,
      budget: form.budget ? Number(form.budget) : 0,
      spent: form.spent ? Number(form.spent) : 0,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      promo_code: form.promo_code || null,
      campaign_key: form.campaign_key || null,
      target_audience: form.target_audience || null,
      notes: form.notes || null,
      updated_at: new Date().toISOString(),
    };
    const q = campaign
      ? supabase.from("campaigns").update(payload).eq("id", campaign.id)
      : supabase.from("campaigns").insert(payload);
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
      <form onSubmit={submit} className="relative w-full max-w-lg card p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{campaign ? t("editCampaign") : t("newCampaign")}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">{t("campaignName")}</label>
          <input className="input" required value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-1">{t("channel")}</label>
            <select className="input capitalize" value={form.channel} onChange={(e) => set("channel", e.target.value)}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">{t("status")}</label>
            <select className="input" value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option value="draft">{t("draft")}</option>
              <option value="active">{t("activeCampaign")}</option>
              <option value="paused">{t("paused")}</option>
              <option value="completed">{t("completed")}</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-1">{t("budget")}</label>
            <input type="number" min="0" className="input" dir="ltr" value={form.budget} onChange={(e) => set("budget", e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">{t("spent")}</label>
            <input type="number" min="0" className="input" dir="ltr" value={form.spent} onChange={(e) => set("spent", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-1">{t("startDate")}</label>
            <input type="date" className="input" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">{t("endDate")}</label>
            <input type="date" className="input" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-1">{t("promoCode")}</label>
            <input className="input" dir="ltr" value={form.promo_code} onChange={(e) => set("promo_code", e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">{t("campaignKey")}</label>
            <input className="input" dir="ltr" value={form.campaign_key} onChange={(e) => set("campaign_key", e.target.value)} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">{t("targetAudience")}</label>
          <input className="input" value={form.target_audience} onChange={(e) => set("target_audience", e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">{t("notes")}</label>
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
        {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={saving}>
          {t("save")}
        </button>
      </form>
    </div>
  );
}
