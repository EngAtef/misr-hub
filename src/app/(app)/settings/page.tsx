"use client";

import { useEffect, useMemo, useState } from "react";
import { Save, Plug, CheckCircle2, XCircle, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner } from "@/components/ui";
import { ChatwootBotSettings } from "@/components/chatwoot-bot-settings";

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

      <ChatwootBotSettings />

      <div className="mt-8 mb-3">
        <h2 className="text-lg font-bold">{t("integrations")}</h2>
        <p className="text-sm text-slate-500">{t("integrationsHint")}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <IntegrationCard
          settingKey="meta"
          title="Meta (Facebook & Instagram) Ads"
          description="Marketing API — pulls ad spend & results automatically instead of CSV exports. Needs a Meta system-user access token + Ad Account ID from business.facebook.com."
          fields={[
            { key: "ad_account_id", label: "Ad Account ID", placeholder: "act_1234567890" },
            { key: "access_token", label: "Access Token", secret: true },
          ]}
          steps={[
            { text: "Open Meta Business Settings", url: "https://business.facebook.com/settings" },
            { text: "Users → System Users → Add → give it 'Admin' + assign your Ad Account" },
            { text: "Generate New Token → select the ads_read and read_insights permissions → copy the token" },
            { text: "Ad Accounts → copy your Ad Account ID (the number after 'act_')" },
            { text: "Paste both below. Docs:", url: "https://developers.facebook.com/docs/marketing-api/get-started" },
          ]}
        />
        <IntegrationCard
          settingKey="chatwoot"
          title="Chatwoot"
          description="Customer conversations — send WhatsApp/messenger follow-ups from the app via your Chatwoot inbox. Needs your Chatwoot URL + API access token (Profile Settings → Access Token)."
          fields={[
            { key: "base_url", label: "Chatwoot URL", placeholder: "https://app.chatwoot.com" },
            { key: "account_id", label: "Account ID", placeholder: "1" },
            { key: "api_token", label: "API Access Token", secret: true },
          ]}
          steps={[
            { text: "Sign in to your Chatwoot", url: "https://app.chatwoot.com" },
            { text: "Profile Settings → Access Token → copy it" },
            { text: "Your Account ID is the number in the dashboard URL: /app/accounts/<ID>/" },
            { text: "Paste URL + Account ID + token below. API docs:", url: "https://www.chatwoot.com/developers/api/" },
          ]}
        />
        <IntegrationCard
          settingKey="ga4_api"
          title="Google Analytics 4 (API)"
          description="Today GA4 works via monthly CSV upload in the Data Center. For live sync, add a Google Cloud service-account JSON key with GA4 Data API access + your property ID."
          fields={[
            { key: "property_id", label: "GA4 Property ID", placeholder: "123456789" },
            { key: "service_account_json", label: "Service Account JSON", secret: true },
          ]}
          steps={[
            { text: "Google Cloud Console → create a project", url: "https://console.cloud.google.com/" },
            { text: "Enable the 'Google Analytics Data API'", url: "https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com" },
            { text: "IAM → Service Accounts → Create → download the JSON key" },
            { text: "In GA4 Admin → Property Access Management, add the service-account email as Viewer" },
            { text: "GA4 Admin → Property Settings → copy the Property ID (a number). Paste both below." },
          ]}
        />
        <IntegrationCard
          settingKey="courier"
          title="Courier / Shipping (Bosta · Mylerz · Aramex · R2S)"
          description="Live AWB tracking — real-time delivery status, actual SLA per city, failed-delivery reasons, and stuck-shipment detection before the customer complains. Needs your courier's API key."
          fields={[
            { key: "provider", label: "Provider (bosta / mylerz / aramex / r2s)", placeholder: "bosta" },
            { key: "base_url", label: "API Base URL", placeholder: "https://app.bosta.co/api/v2" },
            { key: "api_key", label: "API Key", secret: true },
          ]}
          steps={[
            { text: "Log in to your courier's business dashboard (e.g. Bosta):", url: "https://business.bosta.co" },
            { text: "Settings → Integrations / API → generate an API key (read/tracking scope is enough)" },
            { text: "Copy the API base URL from their developer docs. Bosta:", url: "https://docs.bosta.co" },
            { text: "Mylerz API:", url: "https://mylerz.com.eg" },
            { text: "Paste provider + base URL + key below. We only READ tracking — never create shipments." },
          ]}
        />
        <IntegrationCard
          settingKey="payment"
          title="Payment Gateway (Paymob · Fawry · Valu)"
          description="Reconcile settled payments vs orders, see real transaction fees eating margin, and flag failed/pending online payments. Needs your gateway's secret/API key (read scope)."
          fields={[
            { key: "provider", label: "Provider (paymob / fawry / valu)", placeholder: "paymob" },
            { key: "base_url", label: "API Base URL", placeholder: "https://accept.paymob.com/api" },
            { key: "api_key", label: "Secret / API Key", secret: true },
          ]}
          steps={[
            { text: "Paymob dashboard → Settings → Account Info → API Key:", url: "https://accept.paymob.com" },
            { text: "Fawry merchant portal → Integration → credentials:", url: "https://developer.fawrystaging.com" },
            { text: "Valu merchant portal → API credentials (contact your Valu account manager)" },
            { text: "Paste provider + base URL + key. Docs — Paymob:", url: "https://docs.paymob.com" },
          ]}
        />
        <IntegrationCard
          settingKey="whatsapp"
          title="WhatsApp Business API (official)"
          description="Automated messages: order confirmation, 'shipped', delivery reminders, birthday vouchers, and abandoned-cart recovery. Needs a WhatsApp Cloud API phone-number ID + permanent token."
          fields={[
            { key: "phone_number_id", label: "Phone Number ID", placeholder: "1029384756" },
            { key: "business_account_id", label: "WABA ID", placeholder: "9988776655" },
            { key: "access_token", label: "Permanent Access Token", secret: true },
          ]}
          steps={[
            { text: "Meta for Developers → create/select an app → add 'WhatsApp':", url: "https://developers.facebook.com/apps" },
            { text: "WhatsApp → API Setup → copy the Phone Number ID and WABA ID" },
            { text: "Create a System User with a permanent token (whatsapp_business_messaging scope)" },
            { text: "Register & verify your sender number; get message templates approved" },
            { text: "Cloud API docs:", url: "https://developers.facebook.com/docs/whatsapp/cloud-api" },
          ]}
        />
        <IntegrationCard
          settingKey="tiktok_ads"
          title="TikTok Ads"
          description="Live daily spend & results alongside Meta, for true blended ROAS with no manual CSV. Needs a TikTok Marketing API access token + Advertiser ID."
          fields={[
            { key: "advertiser_id", label: "Advertiser ID", placeholder: "700000000000000" },
            { key: "access_token", label: "Access Token", secret: true },
          ]}
          steps={[
            { text: "TikTok for Business → Marketing API → create a developer app:", url: "https://ads.tiktok.com/marketing_api/homepage" },
            { text: "Authorize your Ad Account → generate a long-lived access token (reporting scope)" },
            { text: "Copy your Advertiser ID from Ads Manager → Account settings" },
            { text: "Paste both below. Docs:", url: "https://business-api.tiktok.com/portal/docs" },
          ]}
        />
        <IntegrationCard
          settingKey="accounting"
          title="Accounting / ERP (Odoo · Zoho Books · QuickBooks)"
          description="Push profit and purchase-order data to finance so nobody re-keys it. Also a bridge for SAP SKU↔Material mapping. Needs your accounting platform's API credentials."
          fields={[
            { key: "provider", label: "Provider (odoo / zoho / quickbooks / sap)", placeholder: "odoo" },
            { key: "base_url", label: "API Base URL / Instance", placeholder: "https://mycompany.odoo.com" },
            { key: "api_key", label: "API Key / Token", secret: true },
          ]}
          steps={[
            { text: "Odoo → Settings → Users → API Keys → generate:", url: "https://www.odoo.com/documentation" },
            { text: "Zoho Books → Settings → API → self-client OAuth token:", url: "https://www.zoho.com/books/api/v3/" },
            { text: "QuickBooks → developer.intuit.com → create app → OAuth 2.0:", url: "https://developer.intuit.com" },
            { text: "Paste provider + instance URL + key below." },
          ]}
        />
        <div className="card p-5 space-y-2">
          <h3 className="font-bold text-sm">AI Assistant (Claude)</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            The assistant works out of the box using your live data. To upgrade to full conversational AI, add an
            <code className="rounded bg-slate-100 px-1 text-xs mx-1">ANTHROPIC_API_KEY</code>
            environment variable in Vercel and redeploy — it upgrades automatically.
          </p>
        </div>
      </div>
    </div>
  );
}

function IntegrationCard({
  settingKey,
  title,
  description,
  fields,
  steps,
}: {
  settingKey: string;
  title: string;
  description: string;
  fields: { key: string; label: string; placeholder?: string; secret?: boolean }[];
  steps?: { text: string; url?: string }[];
}) {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [values, setValues] = useState<Record<string, string>>({});
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", settingKey)
      .maybeSingle()
      .then(({ data }) => {
        const v = (data?.value ?? {}) as Record<string, string>;
        setConfigured(Object.values(v).some((x) => x));
        const nonSecret: Record<string, string> = {};
        for (const f of fields) {
          if (!f.secret && v[f.key]) nonSecret[f.key] = v[f.key];
        }
        setValues(nonSecret);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingKey]);

  async function save() {
    setSaving(true);
    setSaved(false);
    const { data } = await supabase.from("app_settings").select("value").eq("key", settingKey).maybeSingle();
    const existing = (data?.value ?? {}) as Record<string, string>;
    const merged = { ...existing };
    for (const f of fields) {
      if (values[f.key] !== undefined && values[f.key] !== "") merged[f.key] = values[f.key];
    }
    await supabase.from("app_settings").upsert({ key: settingKey, value: merged, updated_at: new Date().toISOString() }, { onConflict: "key" });
    setConfigured(Object.values(merged).some((x) => x));
    setSaving(false);
    setSaved(true);
    setValues((prev) => {
      const next = { ...prev };
      for (const f of fields) if (f.secret) next[f.key] = "";
      return next;
    });
  }

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm">{title}</h3>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${configured ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
        >
          {configured ? t("connected") : t("notConnected")}
        </span>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
      {fields.map((f) => (
        <input
          key={f.key}
          className="input !py-1.5 text-sm"
          dir="ltr"
          type={f.secret ? "password" : "text"}
          placeholder={f.secret && configured ? `${f.label} (saved — leave blank to keep)` : f.placeholder ?? f.label}
          value={values[f.key] ?? ""}
          onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
        />
      ))}
      <div className="flex items-center gap-2">
        <button className="btn-secondary !py-1.5 text-xs" onClick={save} disabled={saving}>
          {t("saveSettings")}
        </button>
        {saved && <CheckCircle2 size={15} className="text-emerald-600" />}
        {steps && steps.length > 0 && (
          <button className="ms-auto text-xs font-semibold text-brand-600 hover:underline" onClick={() => setShowSteps((s) => !s)}>
            {showSteps ? t("hideGuide") : t("showGuide")}
          </button>
        )}
      </div>
      {showSteps && steps && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
          <div className="mb-2 text-xs font-bold text-slate-600">{t("integGuide")}</div>
          <ol className="space-y-1.5 text-xs text-slate-600">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700">{i + 1}</span>
                <span dir="ltr" className="text-start">
                  {s.text}{" "}
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline break-all">
                      {s.url}
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
