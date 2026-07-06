"use client";

import { useEffect, useMemo, useState } from "react";
import { Save, Plug, CheckCircle2, XCircle, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner } from "@/components/ui";

export default function SettingsPage() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState("super_commerce");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "ecommerce")
      .single()
      .then(({ data }) => {
        const v = (data?.value ?? {}) as { platform?: string; base_url?: string; has_key?: boolean };
        if (v.platform) setPlatform(v.platform);
        if (v.base_url) setBaseUrl(v.base_url);
        setHasKey(Boolean(v.has_key));
        setLoading(false);
      });
  }, [supabase]);

  async function save() {
    setSaving(true);
    setSaved(false);
    const res = await fetch("/api/ecommerce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", platform, base_url: baseUrl, api_key: apiKey || undefined }),
    });
    if (res.ok) {
      setSaved(true);
      if (apiKey) setHasKey(true);
      setApiKey("");
    }
    setSaving(false);
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    const res = await fetch("/api/ecommerce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "test" }),
    });
    const data = await res.json();
    setTestResult({ ok: data.ok, message: data.message ?? "" });
    setTesting(false);
  }

  if (loading) return <div><PageHeader title={t("settings")} /><Spinner /></div>;

  return (
    <div className="max-w-2xl">
      <PageHeader title={t("settings")} subtitle={t("settingsSubtitle")} />

      <div className="card p-6 space-y-5">
        <div className="flex items-center gap-2 text-brand-700">
          <Plug size={18} />
          <h3 className="font-bold">Super Commerce API</h3>
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-brand-50 border border-brand-100 px-4 py-3 text-sm text-brand-800">
          <Info size={16} className="shrink-0 mt-0.5" />
          <span>
            This key authenticates Misr Hub to your Super Commerce store so it can pull orders, products and
            inventory automatically — replacing the manual Excel upload. Paste your store&apos;s API base URL and the
            key below, then test the connection.
          </span>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Platform</label>
          <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="super_commerce">Super Commerce</option>
            <option value="shopify">Shopify</option>
            <option value="woocommerce">WooCommerce</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">{t("apiBaseUrl")}</label>
          <input
            className="input"
            dir="ltr"
            placeholder="https://api.super-commerce.com/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-400">The API endpoint from your Super Commerce dashboard.</p>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">{t("apiKey")}</label>
          <input
            className="input"
            dir="ltr"
            type="password"
            placeholder={hasKey ? "•••••••••• (saved — leave blank to keep)" : "Paste your API key"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          {hasKey && <p className="mt-1 text-xs text-emerald-600">A key is currently saved.</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={save} disabled={saving}>
            <Save size={16} />
            {t("saveSettings")}
          </button>
          <button className="btn-secondary" onClick={test} disabled={testing || !baseUrl}>
            <Plug size={16} />
            {testing ? "..." : t("testConnection")}
          </button>
          {saved && <span className="inline-flex items-center gap-1 text-sm text-emerald-600 self-center"><CheckCircle2 size={16} />Saved</span>}
        </div>

        {testResult && (
          <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${testResult.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>
            {testResult.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            {testResult.message}
          </div>
        )}
      </div>

      <div className="card p-6 mt-6 space-y-3">
        <h3 className="font-bold">AI Assistant</h3>
        <p className="text-sm text-slate-600">
          The assistant works out of the box using your live data. To upgrade it to full conversational Claude AI,
          add an <code className="rounded bg-slate-100 px-1 text-xs">ANTHROPIC_API_KEY</code> environment variable in
          Vercel and redeploy — the assistant will automatically use it.
        </p>
      </div>
    </div>
  );
}
