"use client";

// Settings → Chatwoot After-Hours Bot.
// Everything the bot needs is managed here (stored in app_settings, admin
// RLS): connection + working hours in "chatwoot_bot", reply-script overrides
// in "chatwoot_bot_script". The webhook reads them via a token-gated SQL
// function, so no env vars or redeploys are needed to change anything.

import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, XCircle, Plug, Save, Copy, RefreshCw, ChevronDown, ChevronUp, Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { DEFAULT_SCRIPT, type ScriptOverrides } from "@/lib/chatwoot-bot/engine";
import type { Intent } from "@/lib/chatwoot-bot/script";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

interface BotSettingsForm {
  enabled: boolean;
  chatwoot_url: string;
  account_id: string;
  webhook_token: string;
  after_hours_only: boolean;
  work_timezone: string;
  work_days: string;
  work_start: number;
  work_end: number;
}

const DEFAULT_FORM: BotSettingsForm = {
  enabled: true,
  chatwoot_url: "https://support.nmgdp.tech",
  account_id: "5",
  webhook_token: "",
  after_hours_only: true,
  work_timezone: "Africa/Cairo",
  work_days: "sun,mon,tue,wed,thu",
  work_start: 9,
  work_end: 18,
};

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const splitKeywords = (s: string) => s.split(/[,،]/).map((x) => x.trim()).filter(Boolean);
const joinKeywords = (a: string[]) => a.join("، ");

/** Editable copy of the full script (defaults + stored overrides). */
interface ScriptForm {
  greeting_ar: string;
  greeting_en: string;
  fallback_ar: string;
  fallback_en: string;
  handoff_ar: string;
  handoff_en: string;
  footer_ar: string;
  footer_en: string;
  handoff_keywords_ar: string;
  handoff_keywords_en: string;
  intents: Record<string, { menu: string; keywords_ar: string; keywords_en: string; ar: string; en: string }>;
}

function scriptFormFromOverrides(o: ScriptOverrides | null): ScriptForm {
  const d = DEFAULT_SCRIPT;
  const intents: ScriptForm["intents"] = {};
  const merged: Record<string, Partial<Intent>> = {};
  for (const [k, v] of Object.entries(d.intents)) merged[k] = { ...v, ...(o?.intents?.[k] ?? {}) };
  for (const [k, v] of Object.entries(o?.intents ?? {})) if (!(k in merged)) merged[k] = v;
  for (const [k, v] of Object.entries(merged)) {
    intents[k] = {
      menu: v.menu ?? "",
      keywords_ar: joinKeywords(v.keywords_ar ?? []),
      keywords_en: (v.keywords_en ?? []).join(", "),
      ar: v.ar ?? "",
      en: v.en ?? "",
    };
  }
  return {
    greeting_ar: o?.greeting_ar || d.greetingAr,
    greeting_en: o?.greeting_en || d.greetingEn,
    fallback_ar: o?.fallback_ar || d.fallbackAr,
    fallback_en: o?.fallback_en || d.fallbackEn,
    handoff_ar: o?.handoff_ar || d.handoffAr,
    handoff_en: o?.handoff_en || d.handoffEn,
    footer_ar: o?.footer_ar ?? d.footerAr,
    footer_en: o?.footer_en ?? d.footerEn,
    handoff_keywords_ar: joinKeywords(o?.handoff_keywords_ar?.length ? o.handoff_keywords_ar : d.handoffKeywordsAr),
    handoff_keywords_en: (o?.handoff_keywords_en?.length ? o.handoff_keywords_en : d.handoffKeywordsEn).join(", "),
    intents,
  };
}

/** Store only what differs from the built-in defaults. */
function overridesFromForm(f: ScriptForm): ScriptOverrides {
  const d = DEFAULT_SCRIPT;
  const o: ScriptOverrides = {};
  if (f.greeting_ar !== d.greetingAr) o.greeting_ar = f.greeting_ar;
  if (f.greeting_en !== d.greetingEn) o.greeting_en = f.greeting_en;
  if (f.fallback_ar !== d.fallbackAr) o.fallback_ar = f.fallback_ar;
  if (f.fallback_en !== d.fallbackEn) o.fallback_en = f.fallback_en;
  if (f.handoff_ar !== d.handoffAr) o.handoff_ar = f.handoff_ar;
  if (f.handoff_en !== d.handoffEn) o.handoff_en = f.handoff_en;
  if (f.footer_ar !== d.footerAr) o.footer_ar = f.footer_ar;
  if (f.footer_en !== d.footerEn) o.footer_en = f.footer_en;
  const hka = splitKeywords(f.handoff_keywords_ar);
  const hke = splitKeywords(f.handoff_keywords_en);
  if (joinKeywords(hka) !== joinKeywords(d.handoffKeywordsAr)) o.handoff_keywords_ar = hka;
  if (hke.join(", ") !== d.handoffKeywordsEn.join(", ")) o.handoff_keywords_en = hke;
  const intents: NonNullable<ScriptOverrides["intents"]> = {};
  for (const [key, v] of Object.entries(f.intents)) {
    const def = d.intents[key];
    const kwAr = splitKeywords(v.keywords_ar);
    const kwEn = splitKeywords(v.keywords_en);
    if (!def) {
      intents[key] = { menu: v.menu, keywords_ar: kwAr, keywords_en: kwEn, ar: v.ar, en: v.en };
      continue;
    }
    const patch: Partial<Intent> = {};
    if (v.menu !== def.menu) patch.menu = v.menu;
    if (joinKeywords(kwAr) !== joinKeywords(def.keywords_ar)) patch.keywords_ar = kwAr;
    if (kwEn.join(", ") !== def.keywords_en.join(", ")) patch.keywords_en = kwEn;
    if (v.ar !== def.ar) patch.ar = v.ar;
    if (v.en !== def.en) patch.en = v.en;
    if (Object.keys(patch).length) intents[key] = patch;
  }
  if (Object.keys(intents).length) o.intents = intents;
  return o;
}

export function ChatwootBotSettings() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [form, setForm] = useState<BotSettingsForm>(DEFAULT_FORM);
  const [botToken, setBotToken] = useState("");
  const [hasBotToken, setHasBotToken] = useState(false);
  const [script, setScript] = useState<ScriptForm>(() => scriptFormFromOverrides(null));
  const [hasOverrides, setHasOverrides] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [openIntent, setOpenIntent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [health, setHealth] = useState<{ configured: boolean; within_hours: boolean; source: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("key,value")
      .in("key", ["chatwoot_bot", "chatwoot_bot_script"])
      .then(({ data }) => {
        for (const row of data ?? []) {
          if (row.key === "chatwoot_bot") {
            const v = row.value as Partial<BotSettingsForm> & { bot_token?: string };
            setForm({
              ...DEFAULT_FORM,
              ...v,
              work_start: Number(v.work_start ?? DEFAULT_FORM.work_start),
              work_end: Number(v.work_end ?? DEFAULT_FORM.work_end),
            });
            setHasBotToken(Boolean(v.bot_token));
          }
          if (row.key === "chatwoot_bot_script") {
            const o = row.value as ScriptOverrides;
            setScript(scriptFormFromOverrides(o));
            setHasOverrides(Object.keys(o ?? {}).length > 0);
          }
        }
      });
    fetch("/api/chatwoot/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});
  }, [supabase]);

  const webhookUrl =
    typeof window !== "undefined" && form.webhook_token
      ? `${window.location.origin}/api/chatwoot/${form.webhook_token}`
      : "";

  async function save() {
    setSaving(true);
    setSaved(false);
    const { data } = await supabase.from("app_settings").select("value").eq("key", "chatwoot_bot").maybeSingle();
    const existing = (data?.value ?? {}) as Record<string, unknown>;
    const value: Record<string, unknown> = { ...existing, ...form };
    if (botToken) value.bot_token = botToken;
    await supabase.from("app_settings").upsert(
      { key: "chatwoot_bot", value, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
    const overrides = overridesFromForm(script);
    await supabase.from("app_settings").upsert(
      { key: "chatwoot_bot_script", value: overrides, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
    setHasOverrides(Object.keys(overrides).length > 0);
    if (botToken) setHasBotToken(true);
    setBotToken("");
    setSaving(false);
    setSaved(true);
    fetch("/api/chatwoot/health").then((r) => r.json()).then(setHealth).catch(() => {});
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    const res = await fetch("/api/chatwoot-bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "test" }),
    });
    const data = await res.json();
    setTestResult({ ok: Boolean(data.ok), message: data.message ?? "" });
    setTesting(false);
  }

  function resetScript() {
    setScript(scriptFormFromOverrides(null));
  }

  const setDays = (day: string, on: boolean) => {
    const days = new Set(form.work_days.split(",").map((d) => d.trim()).filter(Boolean));
    if (on) days.add(day);
    else days.delete(day);
    setForm((f) => ({ ...f, work_days: DAYS.filter((d) => days.has(d)).join(",") }));
  };
  const activeDays = new Set(form.work_days.split(",").map((d) => d.trim()));

  return (
    <div className="card p-6 space-y-5 mt-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-brand-700">
          <Bot size={18} />
          <h3 className="font-bold">Chatwoot After-Hours Bot</h3>
        </div>
        {health && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${health.configured ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
          >
            {health.configured
              ? `${t("connected")} · ${health.within_hours ? "working hours (silent)" : "after hours (active)"}`
              : t("notConnected")}
          </span>
        )}
      </div>

      <p className="text-xs text-slate-500 leading-relaxed">
        Scripted support bot (no AI, no per-message cost): outside working hours it answers shipping,
        payment, returns, tracking, categories, hours and bulk questions from the script below, collects
        the customer&apos;s details, and moves the conversation to your team&apos;s queue. It never sees order
        status and never invents a price — off-script questions get the menu or a handoff.
      </p>

      {/* Connection */}
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="block text-sm font-semibold mb-1">Chatwoot URL</label>
          <input className="input" dir="ltr" value={form.chatwoot_url}
            onChange={(e) => setForm((f) => ({ ...f, chatwoot_url: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">Account ID</label>
          <input className="input" dir="ltr" value={form.account_id}
            onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value }))} />
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">Bot agent access token</label>
        <input
          className="input"
          dir="ltr"
          type="password"
          placeholder={hasBotToken ? "•••••••••• (saved — leave blank to keep)" : "Paste the bot agent's access token (Profile Settings → Access Token)"}
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-400">
          Create a dedicated agent (e.g. &quot;Nahdet Misr Bot&quot;) in Chatwoot and paste its token — replies
          will appear under that name.
        </p>
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">Webhook</label>
        <div className="flex flex-wrap items-center gap-2">
          <input className="input flex-1 min-w-52" dir="ltr" readOnly
            placeholder="Generate a webhook token →"
            value={webhookUrl || form.webhook_token} />
          <button className="btn-secondary !py-1.5 text-xs" type="button"
            onClick={() => setForm((f) => ({ ...f, webhook_token: randomToken() }))}>
            <RefreshCw size={14} />
            {form.webhook_token ? "Regenerate" : "Generate"}
          </button>
          {webhookUrl && (
            <button className="btn-secondary !py-1.5 text-xs" type="button"
              onClick={() => { navigator.clipboard.writeText(webhookUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              <Copy size={14} />
              {copied ? "Copied!" : "Copy URL"}
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          In Chatwoot: Settings → Integrations → Webhooks → add this URL with events
          <b> Conversation Created</b> + <b>Message Created</b>. Regenerating invalidates the old URL.
        </p>
      </div>

      {/* Behaviour */}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
          Bot enabled
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={form.after_hours_only}
            onChange={(e) => setForm((f) => ({ ...f, after_hours_only: e.target.checked }))} />
          Reply outside working hours only
        </label>
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">Working days &amp; hours ({form.work_timezone})</label>
        <div className="flex flex-wrap items-center gap-1.5">
          {DAYS.map((d) => (
            <button key={d} type="button"
              className={`rounded-full px-2.5 py-1 text-xs font-semibold border ${activeDays.has(d) ? "bg-brand-600 text-white border-brand-600" : "bg-white text-slate-500 border-slate-200"}`}
              onClick={() => setDays(d, !activeDays.has(d))}>
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
          <select className="input !w-auto !py-1 text-sm" value={form.work_start}
            onChange={(e) => setForm((f) => ({ ...f, work_start: Number(e.target.value) }))}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
          </select>
          <span className="text-xs text-slate-400">to</span>
          <select className="input !w-auto !py-1 text-sm" value={form.work_end}
            onChange={(e) => setForm((f) => ({ ...f, work_end: Number(e.target.value) }))}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
          </select>
        </div>
      </div>

      {/* Script editor */}
      <div className="rounded-lg border border-slate-200">
        <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-sm font-bold"
          onClick={() => setShowScript((s) => !s)}>
          <span>Reply script (greeting, answers, keywords){hasOverrides ? " — customized" : ""}</span>
          {showScript ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {showScript && (
          <div className="space-y-4 border-t border-slate-200 p-4">
            <p className="text-xs text-slate-500">
              Everything the bot can say. Keywords are comma-separated; a message routes to the answer whose
              keywords score highest, and weak matches get the fallback instead of a guess. Leave a field as
              is to keep the built-in text.
            </p>
            {(
              [
                ["greeting_ar", "Greeting (Arabic)"], ["greeting_en", "Greeting (English)"],
                ["fallback_ar", "Fallback (Arabic)"], ["fallback_en", "Fallback (English)"],
                ["handoff_ar", "Handoff message (Arabic)"], ["handoff_en", "Handoff message (English)"],
                ["footer_ar", "Footer (Arabic)"], ["footer_en", "Footer (English)"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label className="block text-xs font-semibold mb-1">{label}</label>
                <textarea className="input text-sm !leading-relaxed" rows={key.startsWith("footer") ? 2 : 4}
                  dir={key.endsWith("_ar") ? "rtl" : "ltr"}
                  value={script[key]}
                  onChange={(e) => setScript((s) => ({ ...s, [key]: e.target.value }))} />
              </div>
            ))}
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold mb-1">Handoff trigger words (Arabic)</label>
                <input className="input text-sm" dir="rtl" value={script.handoff_keywords_ar}
                  onChange={(e) => setScript((s) => ({ ...s, handoff_keywords_ar: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Handoff trigger words (English)</label>
                <input className="input text-sm" dir="ltr" value={script.handoff_keywords_en}
                  onChange={(e) => setScript((s) => ({ ...s, handoff_keywords_en: e.target.value }))} />
              </div>
            </div>

            <div className="text-sm font-bold">Topics</div>
            {Object.entries(script.intents).map(([key, intent]) => (
              <div key={key} className="rounded-lg border border-slate-200">
                <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold"
                  onClick={() => setOpenIntent(openIntent === key ? null : key)}>
                  <span dir="ltr">{intent.menu ? `${intent.menu} — ` : ""}{key}</span>
                  {openIntent === key ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {openIntent === key && (
                  <div className="space-y-2 border-t border-slate-100 p-3">
                    <div className="grid gap-2 md:grid-cols-3">
                      <div>
                        <label className="block text-xs font-semibold mb-1">Menu digit</label>
                        <input className="input text-sm" dir="ltr" value={intent.menu}
                          onChange={(e) => setScript((s) => ({ ...s, intents: { ...s.intents, [key]: { ...intent, menu: e.target.value } } }))} />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold mb-1">Keywords (Arabic, comma-separated)</label>
                        <input className="input text-sm" dir="rtl" value={intent.keywords_ar}
                          onChange={(e) => setScript((s) => ({ ...s, intents: { ...s.intents, [key]: { ...intent, keywords_ar: e.target.value } } }))} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Keywords (English)</label>
                      <input className="input text-sm" dir="ltr" value={intent.keywords_en}
                        onChange={(e) => setScript((s) => ({ ...s, intents: { ...s.intents, [key]: { ...intent, keywords_en: e.target.value } } }))} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Answer (Arabic)</label>
                      <textarea className="input text-sm !leading-relaxed" rows={6} dir="rtl" value={intent.ar}
                        onChange={(e) => setScript((s) => ({ ...s, intents: { ...s.intents, [key]: { ...intent, ar: e.target.value } } }))} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Answer (English)</label>
                      <textarea className="input text-sm !leading-relaxed" rows={6} dir="ltr" value={intent.en}
                        onChange={(e) => setScript((s) => ({ ...s, intents: { ...s.intents, [key]: { ...intent, en: e.target.value } } }))} />
                    </div>
                  </div>
                )}
              </div>
            ))}
            <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={resetScript}>
              <Undo2 size={14} />
              Reset script to defaults (saved on Save)
            </button>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={save} disabled={saving}>
          <Save size={16} />
          {t("saveSettings")}
        </button>
        <button className="btn-secondary" onClick={test} disabled={testing}>
          <Plug size={16} />
          {testing ? "..." : t("testConnection")}
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm text-emerald-600 self-center">
            <CheckCircle2 size={16} />
            Saved
          </span>
        )}
      </div>

      {testResult && (
        <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${testResult.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>
          {testResult.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          {testResult.message}
        </div>
      )}
    </div>
  );
}
