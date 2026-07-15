"use client";

// After-Hours Bot management, split in two so access can differ:
//  - BotConnectionSettings: tokens, webhook, schedule — admins only.
//  - BotScriptEditor: greeting/answers/keywords/topics — anyone granted the
//    /bot page (RLS on app_settings key "chatwoot_bot_script" enforces it).
// Settings live in app_settings; the webhook reads them via a token-gated
// SQL function, so changes apply on Save with no redeploy.

import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, XCircle, Plug, Save, Copy, RefreshCw, ChevronDown, ChevronUp, Undo2, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { DEFAULT_SCRIPT, mergeScript, route, replyFor, isArabic, type ScriptOverrides } from "@/lib/chatwoot-bot/engine";
import type { Intent } from "@/lib/chatwoot-bot/script";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY_LABEL: Record<string, string> = {
  sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday",
  thu: "Thursday", fri: "Friday", sat: "Saturday",
};

type Schedule = Record<string, { start: number; end: number }>;

interface BotSettingsForm {
  enabled: boolean;
  chatwoot_url: string;
  account_id: string;
  webhook_token: string;
  after_hours_only: boolean;
  work_timezone: string;
  work_schedule: Schedule;
  label: string;
  menu_buttons: boolean;
  holidays: string;
}

const DEFAULT_SCHEDULE: Schedule = {
  sun: { start: 9, end: 18 },
  mon: { start: 9, end: 18 },
  tue: { start: 9, end: 18 },
  wed: { start: 9, end: 18 },
  thu: { start: 9, end: 18 },
};

const DEFAULT_FORM: BotSettingsForm = {
  enabled: true,
  chatwoot_url: "https://support.nmgdp.tech",
  account_id: "5",
  webhook_token: "",
  after_hours_only: true,
  work_timezone: "Africa/Cairo",
  work_schedule: DEFAULT_SCHEDULE,
  label: "after-hours",
  menu_buttons: true,
  holidays: "",
};

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

// ─────────────────────────────────────────────────────────────
// Connection & behaviour — admins only
// ─────────────────────────────────────────────────────────────

export function BotConnectionSettings() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [form, setForm] = useState<BotSettingsForm>(DEFAULT_FORM);
  const [botToken, setBotToken] = useState("");
  const [hasBotToken, setHasBotToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [health, setHealth] = useState<{ configured: boolean; within_hours: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "chatwoot_bot")
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const v = data.value as Partial<BotSettingsForm> & {
          bot_token?: string;
          work_days?: string;
          work_start?: number;
          work_end?: number;
        };
        let schedule: Schedule = v.work_schedule && Object.keys(v.work_schedule).length ? v.work_schedule : {};
        if (!Object.keys(schedule).length) {
          // Legacy single-range settings → same hours for each listed day.
          schedule = {};
          const days = (v.work_days ?? "sun,mon,tue,wed,thu").split(",").map((d) => d.trim()).filter(Boolean);
          for (const d of days) schedule[d] = { start: Number(v.work_start ?? 9), end: Number(v.work_end ?? 18) };
        }
        setForm({ ...DEFAULT_FORM, ...v, work_schedule: schedule });
        setHasBotToken(Boolean(v.bot_token));
      });
    fetch("/api/chatwoot/health").then((r) => r.json()).then(setHealth).catch(() => {});
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

  function setDay(day: string, range: { start: number; end: number } | null) {
    setForm((f) => {
      const schedule = { ...f.work_schedule };
      if (range) schedule[day] = range;
      else delete schedule[day];
      return { ...f, work_schedule: schedule };
    });
  }

  return (
    <div className="card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-brand-700">
          <Bot size={18} />
          <h3 className="font-bold">Connection &amp; behaviour (admin)</h3>
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
          Use a dedicated agent (e.g. &quot;Nahdet Misr Bot&quot;) so replies appear under that name.
          Tip: remove it from the inbox&apos;s auto-assignment so Chatwoot never routes customers to it.
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
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={form.menu_buttons}
            onChange={(e) => setForm((f) => ({ ...f, menu_buttons: e.target.checked }))} />
          Tappable topic buttons (with greeting &amp; fallback)
        </label>
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">Public holidays</label>
        <input className="input" dir="ltr" placeholder="2026-07-23, 2026-10-06"
          value={form.holidays}
          onChange={(e) => setForm((f) => ({ ...f, holidays: e.target.value }))} />
        <p className="mt-1 text-xs text-slate-400">
          Comma-separated dates (YYYY-MM-DD). On these days the bot treats the whole day as
          after-hours and answers customers even inside normal working times.
        </p>
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">Conversation label</label>
        <input className="input !w-56" dir="ltr" value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
        <p className="mt-1 text-xs text-slate-400">
          Added to every conversation the bot handles — create the same label in Chatwoot
          (Settings → Labels) so agents filter the overnight queue in one click.
        </p>
      </div>

      <div>
        <label className="block text-sm font-semibold mb-2">
          Working days &amp; hours — per day ({form.work_timezone}). The bot is silent during these hours.
        </label>
        <div className="space-y-1.5">
          {DAYS.map((d) => {
            const range = form.work_schedule[d];
            return (
              <div key={d} className="flex items-center gap-2">
                <label className="flex w-28 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(range)}
                    onChange={(e) => setDay(d, e.target.checked ? { start: 9, end: 18 } : null)}
                  />
                  {DAY_LABEL[d]}
                </label>
                {range ? (
                  <>
                    <select className="input !w-auto !py-1 text-sm" value={range.start}
                      onChange={(e) => setDay(d, { ...range, start: Number(e.target.value) })}>
                      {HOURS.map((h) => <option key={h} value={h}>{h}:00</option>)}
                    </select>
                    <span className="text-xs text-slate-400">to</span>
                    <select className="input !w-auto !py-1 text-sm" value={range.end}
                      onChange={(e) => setDay(d, { ...range, end: Number(e.target.value) })}>
                      {HOURS.map((h) => <option key={h} value={h}>{h}:00</option>)}
                    </select>
                  </>
                ) : (
                  <span className="text-xs text-slate-400">day off — the bot covers the whole day</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

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

// ─────────────────────────────────────────────────────────────
// Reply-script editor — for anyone granted the /bot page
// ─────────────────────────────────────────────────────────────

const splitKeywords = (s: string) => s.split(/[,،]/).map((x) => x.trim()).filter(Boolean);
const joinKeywords = (a: string[]) => a.join("، ");

interface IntentForm {
  menu: string;
  title_ar: string;
  title_en: string;
  keywords_ar: string;
  keywords_en: string;
  ar: string;
  en: string;
}

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
  intents: Record<string, IntentForm>;
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
      title_ar: v.title_ar ?? "",
      title_en: v.title_en ?? "",
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
      // Custom topic — stored whole. Incomplete ones are skipped at runtime.
      intents[key] = {
        menu: v.menu,
        title_ar: v.title_ar || undefined,
        title_en: v.title_en || undefined,
        keywords_ar: kwAr,
        keywords_en: kwEn,
        ar: v.ar,
        en: v.en,
      };
      continue;
    }
    const patch: Partial<Intent> = {};
    if (v.menu !== def.menu) patch.menu = v.menu;
    if (v.title_ar !== (def.title_ar ?? "")) patch.title_ar = v.title_ar;
    if (v.title_en !== (def.title_en ?? "")) patch.title_en = v.title_en;
    if (joinKeywords(kwAr) !== joinKeywords(def.keywords_ar)) patch.keywords_ar = kwAr;
    if (kwEn.join(", ") !== def.keywords_en.join(", ")) patch.keywords_en = kwEn;
    if (v.ar !== def.ar) patch.ar = v.ar;
    if (v.en !== def.en) patch.en = v.en;
    if (Object.keys(patch).length) intents[key] = patch;
  }
  if (Object.keys(intents).length) o.intents = intents;
  return o;
}

export function BotScriptEditor() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [script, setScript] = useState<ScriptForm>(() => scriptFormFromOverrides(null));
  const [openIntent, setOpenIntent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [testMsg, setTestMsg] = useState("");
  const [testResult, setTestResult] = useState<{ topic: string; reply: string } | null>(null);

  function runTest() {
    if (!testMsg.trim()) return;
    // Runs the real routing engine on the CURRENT (possibly unsaved) form.
    const merged = mergeScript(overridesFromForm(script));
    const topic = route(testMsg, merged);
    const arabic = isArabic(testMsg) || !/[a-zA-Z]/.test(testMsg);
    const reply =
      topic === null
        ? (arabic ? merged.fallbackAr : merged.fallbackEn)
        : replyFor(topic, arabic, merged, testMsg);
    setTestResult({ topic: topic ?? "fallback (no topic matched)", reply });
  }

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "chatwoot_bot_script")
      .maybeSingle()
      .then(({ data }) => {
        if (data) setScript(scriptFormFromOverrides(data.value as ScriptOverrides));
      });
  }, [supabase]);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError("");
    const overrides = overridesFromForm(script);
    const { error: err } = await supabase.from("app_settings").upsert(
      { key: "chatwoot_bot_script", value: overrides, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
    if (err) setError(`Could not save: ${err.message}`);
    else setSaved(true);
    setSaving(false);
  }

  function addTopic() {
    const usedDigits = new Set(Object.values(script.intents).map((i) => i.menu).filter(Boolean));
    let digit = 9;
    while (usedDigits.has(String(digit)) && digit > 0) digit--;
    let n = 1;
    while (`topic-${n}` in script.intents) n++;
    const key = `topic-${n}`;
    setScript((s) => ({
      ...s,
      intents: {
        ...s.intents,
        [key]: {
          menu: usedDigits.has(String(digit)) ? "" : String(digit),
          title_ar: "",
          title_en: "",
          keywords_ar: "",
          keywords_en: "",
          ar: "",
          en: "",
        },
      },
    }));
    setOpenIntent(key);
  }

  function removeTopic(key: string) {
    setScript((s) => {
      const intents = { ...s.intents };
      delete intents[key];
      return { ...s, intents };
    });
    if (openIntent === key) setOpenIntent(null);
  }

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-brand-700">Reply script — topics, answers &amp; keywords</h3>
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm text-emerald-600">
            <CheckCircle2 size={16} />
            Saved — live immediately
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">
        Everything the bot can say. Keywords are comma-separated; a customer message goes to the
        topic whose keywords score highest — weak matches get the fallback instead of a guess.
        Changes apply on Save, no deploy needed.
      </p>

      {/* Playground: test the current (unsaved) script instantly */}
      <div className="rounded-lg bg-brand-50 border border-brand-100 p-3 space-y-2">
        <div className="text-xs font-bold text-brand-800">🧪 Try a customer message (tests your unsaved edits)</div>
        <div className="flex gap-2">
          <input className="input text-sm flex-1" dir="auto" placeholder="e.g. كام الشحن للجيزة؟"
            value={testMsg}
            onChange={(e) => setTestMsg(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runTest()} />
          <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={runTest}>Test</button>
        </div>
        {testResult && (
          <div className="space-y-1 text-xs">
            <div><b>Topic:</b> <span dir="ltr">{testResult.topic}</span></div>
            <div className="whitespace-pre-wrap rounded bg-white border border-slate-200 p-2" dir="auto">{testResult.reply}</div>
          </div>
        )}
      </div>

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

      <div className="flex items-center justify-between">
        <div className="text-sm font-bold">Topics</div>
        <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={addTopic}>
          <Plus size={14} />
          Add topic
        </button>
      </div>
      <p className="text-xs text-slate-400 -mt-2">
        A new topic needs a unique menu digit, at least one keyword, and both answers — incomplete
        topics are ignored by the bot. Built-in topics can be edited but not deleted (reset any
        field by restoring the original text).
      </p>

      {Object.entries(script.intents).map(([key, intent]) => {
        const isCustom = !(key in DEFAULT_SCRIPT.intents);
        return (
          <div key={key} className="rounded-lg border border-slate-200">
            <div className="flex w-full items-center justify-between px-3 py-2">
              <button type="button" className="flex flex-1 items-center gap-2 text-sm font-semibold"
                onClick={() => setOpenIntent(openIntent === key ? null : key)}>
                <span dir="ltr">{intent.menu ? `${intent.menu} — ` : ""}{key}{isCustom ? " (custom)" : ""}</span>
              </button>
              <div className="flex items-center gap-2">
                {isCustom && (
                  <button type="button" className="text-red-500 hover:text-red-700" title="Delete topic"
                    onClick={() => removeTopic(key)}>
                    <Trash2 size={14} />
                  </button>
                )}
                <button type="button" onClick={() => setOpenIntent(openIntent === key ? null : key)}>
                  {openIntent === key ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
            </div>
            {openIntent === key && (
              <div className="space-y-2 border-t border-slate-100 p-3">
                <div className="grid gap-2 md:grid-cols-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Menu digit</label>
                    <input className="input text-sm" dir="ltr" value={intent.menu}
                      onChange={(e) => setScript((s) => ({ ...s, intents: { ...s.intents, [key]: { ...intent, menu: e.target.value } } }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Button label (Arabic)</label>
                    <input className="input text-sm" dir="rtl" value={intent.title_ar}
                      onChange={(e) => setScript((s) => ({ ...s, intents: { ...s.intents, [key]: { ...intent, title_ar: e.target.value } } }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Button label (English)</label>
                    <input className="input text-sm" dir="ltr" value={intent.title_en}
                      onChange={(e) => setScript((s) => ({ ...s, intents: { ...s.intents, [key]: { ...intent, title_en: e.target.value } } }))} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Keywords (Arabic, comma-separated)</label>
                  <input className="input text-sm" dir="rtl" value={intent.keywords_ar}
                    onChange={(e) => setScript((s) => ({ ...s, intents: { ...s.intents, [key]: { ...intent, keywords_ar: e.target.value } } }))} />
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
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={save} disabled={saving}>
          <Save size={16} />
          {t("saveSettings")}
        </button>
        <button type="button" className="btn-secondary !py-1.5 text-xs"
          onClick={() => setScript(scriptFormFromOverrides(null))}>
          <Undo2 size={14} />
          Reset script to defaults (saved on Save)
        </button>
      </div>
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <XCircle size={16} />
          {error}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Analytics & fallback inbox — the weekly improvement loop
// ─────────────────────────────────────────────────────────────

interface BotEvent {
  id: number;
  created_at: string;
  conversation_id: number | null;
  intent: string;
  message: string | null;
}

export function BotAnalytics() {
  const supabase = useMemo(() => createClient(), []);
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [addingFor, setAddingFor] = useState<BotEvent | null>(null);
  const [keyword, setKeyword] = useState("");
  const [topic, setTopic] = useState("shipping");
  const [added, setAdded] = useState("");

  useEffect(() => {
    supabase
      .from("bot_events")
      .select("id, created_at, conversation_id, intent, message")
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        setEvents((data as BotEvent[]) ?? []);
        setLoaded(true);
      });
  }, [supabase]);

  const stats = useMemo(() => {
    const byIntent: Record<string, number> = {};
    for (const e of events) byIntent[e.intent] = (byIntent[e.intent] ?? 0) + 1;
    const replied = events.filter((e) => e.intent !== "greeting").length;
    const fallbacks = byIntent["fallback"] ?? 0;
    const handoffs = (byIntent["handoff"] ?? 0) + (byIntent["cancel"] ?? 0) + (byIntent["attachment"] ?? 0);
    return { byIntent, replied, fallbacks, handoffs };
  }, [events]);

  const fallbackMessages = useMemo(
    () => events.filter((e) => e.intent === "fallback" && e.message).slice(0, 30),
    [events]
  );

  async function addKeyword() {
    if (!keyword.trim() || !addingFor) return;
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "chatwoot_bot_script")
      .maybeSingle();
    const overrides = (data?.value ?? {}) as ScriptOverrides;
    const form = scriptFormFromOverrides(overrides);
    const target = form.intents[topic];
    if (!target) return;
    const isAr = isArabic(keyword);
    if (isAr) target.keywords_ar = target.keywords_ar ? `${target.keywords_ar}، ${keyword.trim()}` : keyword.trim();
    else target.keywords_en = target.keywords_en ? `${target.keywords_en}, ${keyword.trim()}` : keyword.trim();
    const next = overridesFromForm(form);
    await supabase.from("app_settings").upsert(
      { key: "chatwoot_bot_script", value: next, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
    setAdded(`"${keyword.trim()}" → ${topic}`);
    setAddingFor(null);
    setKeyword("");
  }

  if (!loaded) return null;

  const pct = (n: number) => (stats.replied ? Math.round((n / stats.replied) * 100) : 0);
  const topIntents = Object.entries(stats.byIntent)
    .filter(([k]) => k !== "greeting")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <div className="card p-6 space-y-4">
      <h3 className="font-bold text-brand-700">Bot analytics — last 500 events</h3>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
          <div className="text-2xl font-bold">{stats.replied}</div>
          <div className="text-xs text-slate-500">messages handled</div>
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
          <div className="text-2xl font-bold">{pct(stats.fallbacks)}%</div>
          <div className="text-xs text-slate-500">fallback rate (your to-do list)</div>
        </div>
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
          <div className="text-2xl font-bold">{pct(stats.handoffs)}%</div>
          <div className="text-xs text-slate-500">handed to the team (20–30% is healthy)</div>
        </div>
      </div>

      {topIntents.length > 0 && (
        <div>
          <div className="text-xs font-bold text-slate-600 mb-1.5">Topics customers ask about</div>
          <div className="flex flex-wrap gap-1.5">
            {topIntents.map(([k, n]) => (
              <span key={k} className="rounded-full bg-brand-50 border border-brand-100 px-2.5 py-0.5 text-xs" dir="ltr">
                {k}: <b>{n}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="text-xs font-bold text-slate-600 mb-1.5">
          Fallback inbox — what the bot couldn&apos;t answer (teach it a keyword)
        </div>
        {fallbackMessages.length === 0 ? (
          <p className="text-xs text-slate-400">Nothing here — the bot understood everything so far 🎉</p>
        ) : (
          <div className="space-y-1.5">
            {fallbackMessages.map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5">
                <span className="flex-1 text-sm" dir="auto">{e.message}</span>
                <span className="text-[10px] text-slate-400 shrink-0">{new Date(e.created_at).toLocaleDateString()}</span>
                <button
                  type="button"
                  className="btn-secondary !py-1 text-xs shrink-0"
                  onClick={() => {
                    setAddingFor(e);
                    setKeyword(e.message ?? "");
                    setAdded("");
                  }}
                >
                  Teach
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {addingFor && (
        <div className="rounded-lg bg-brand-50 border border-brand-100 p-3 space-y-2">
          <div className="text-xs font-bold text-brand-800">
            Add a keyword so this routes correctly next time — trim it to the meaningful word or phrase.
          </div>
          <div className="flex flex-wrap gap-2">
            <input className="input text-sm flex-1 min-w-40" dir="auto" value={keyword}
              onChange={(e) => setKeyword(e.target.value)} />
            <select className="input !w-auto text-sm" value={topic} onChange={(e) => setTopic(e.target.value)}>
              {Object.keys(DEFAULT_SCRIPT.intents)
                .filter((k) => !["greet", "thanks"].includes(k))
                .map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="button" className="btn-primary !py-1.5 text-xs" onClick={addKeyword}>Add keyword</button>
            <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => setAddingFor(null)}>Cancel</button>
          </div>
        </div>
      )}
      {added && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
          <CheckCircle2 size={14} />
          Added {added} — live immediately.
        </div>
      )}
    </div>
  );
}
