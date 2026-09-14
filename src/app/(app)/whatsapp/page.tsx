"use client";

// WhatsApp campaigns — send an approved Meta template to a segment.
// The audience comes from the same engine as /segments (a saved segment or
// a definition handed over by the "WhatsApp" button there); the message is
// one of the templates Meta approved on the WABA; the send runs through
// /api/whatsapp/send in batches while this page is open and pg_cron picks
// up whatever is left. Delivery / read / replies come back over the webhook.
//
// Meta bills every delivered marketing template (WA_PRICE_EGP), so the
// dialog shows the sendable count and the cost before anything is queued,
// and by default only people who opted in are included.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MessageCircle, Plug, RefreshCw, Send, CheckCircle2, AlertTriangle, Pause, Play, XCircle,
  Ban, UserCheck, Inbox, ChevronDown, ChevronUp, FlaskConical,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner } from "@/components/ui";
import { formatMoney, formatNumber, formatDateTimeEg, cn } from "@/lib/utils";
import { confirmDialog, notifyDialog } from "@/components/dialog";

const WA_PRICE_EGP = 3.18;

// ------------------------------------------------------------ copy

const T = {
  title: { ar: "حملات واتساب", en: "WhatsApp campaigns" },
  subtitle: { ar: "ابعت قالب معتمد من Meta لشريحة من العملاء، وتابع التسليم والقراءة والردود", en: "Send a Meta-approved template to a customer segment and track delivery, reads and replies" },
  connection: { ar: "الاتصال", en: "Connection" },
  refresh: { ar: "تحديث", en: "Refresh" },
  notConfigured: { ar: "واتساب غير مضبوط بعد — افتح الإعدادات ← WhatsApp Business API واحفظ Phone Number ID والـ WABA ID والتوكن.", en: "WhatsApp is not configured yet — open Settings → WhatsApp Business API and save the Phone Number ID, WABA ID and token." },
  disabled: { ar: "التكامل متوقف من الإعدادات.", en: "The integration is switched off in Settings." },
  number: { ar: "الرقم", en: "Number" },
  quality: { ar: "جودة الرقم", en: "Quality rating" },
  tier: { ar: "حد الإرسال", en: "Messaging tier" },
  webhook: { ar: "الويبهوك", en: "Webhook" },
  webhookHint: { ar: "في Meta: WhatsApp ← Configuration ← Callback URL. الصق الرابط ده والـ Verify token المحفوظ في الإعدادات، واشترك في messages.", en: "In Meta: WhatsApp → Configuration → Callback URL. Paste this URL and the verify token saved in Settings, then subscribe to `messages`." },
  noVerify: { ar: "لم يُحفظ Verify token في الإعدادات بعد — الويبهوك لن يتأكد.", en: "No verify token saved in Settings yet — the webhook cannot verify." },
  noSecret: { ar: "App Secret غير محفوظ — الويبهوك يقبل أي طلب. أضفه من الإعدادات.", en: "App Secret not saved — the webhook accepts unsigned requests. Add it in Settings." },
  templates: { ar: "القوالب", en: "Templates" },
  noTemplates: { ar: "لا توجد قوالب — أنشئها في WhatsApp Manager (Message templates) وانتظر الاعتماد.", en: "No templates — create them in WhatsApp Manager (Message templates) and wait for approval." },
  newCampaign: { ar: "حملة جديدة", en: "New campaign" },
  campaignName: { ar: "اسم الحملة", en: "Campaign name" },
  audienceSrc: { ar: "الجمهور", en: "Audience" },
  savedSeg: { ar: "شريحة محفوظة", en: "Saved segment" },
  fromSegments: { ar: "من صفحة الشرائح", en: "From the Segments page" },
  pickSeg: { ar: "اختر شريحة…", en: "Pick a segment…" },
  goSegments: { ar: "أو ابنِ شريحة في مركز الشرائح واضغط «واتساب» هناك", en: "or build one in Segments and press “WhatsApp” there" },
  template: { ar: "القالب", en: "Template" },
  pickTemplate: { ar: "اختر قالبًا معتمدًا…", en: "Pick an approved template…" },
  variables: { ar: "متغيرات القالب", en: "Template variables" },
  nameHint: { ar: "اكتب {{name}} ليتحول لاسم العميل الأول تلقائيًا", en: "Type {{name}} and it becomes the customer's first name" },
  headerImage: { ar: "رابط صورة الهيدر (https)", en: "Header image URL (https)" },
  headerText: { ar: "نص الهيدر", en: "Header text" },
  buttonSuffix: { ar: "تكملة رابط الزر", en: "Button URL suffix" },
  preview: { ar: "معاينة", en: "Preview" },
  audienceMode: { ar: "من نرسل له", en: "Who receives it" },
  optedInOnly: { ar: "الموافقون فقط (موصى به)", en: "Opted-in only (recommended)" },
  allReachable: { ar: "كل الأرقام الصالحة", en: "Every reachable number" },
  allWarn: { ar: "Meta تشترط موافقة مسبقة على الرسائل التسويقية. الإرسال بدون موافقة يرفع الحظر ويوقف القالب أو الرقم.", en: "Meta requires prior opt-in for marketing messages. Sending without it raises blocks and can pause the template or the number." },
  cap: { ar: "لا ترسل لمن وصلته رسالة واتساب خلال", en: "Skip anyone messaged on WhatsApp in the last" },
  days: { ar: "يوم", en: "days" },
  any: { ar: "بدون حد", en: "no limit" },
  count: { ar: "احسب الجمهور", en: "Count audience" },
  reachable: { ar: "أرقام صالحة", en: "Reachable" },
  optedIn: { ar: "موافقون", en: "Opted in" },
  optedOut: { ar: "رافضون", en: "Opted out" },
  recent: { ar: "وصلتهم رسالة مؤخرًا", en: "Messaged recently" },
  sendable: { ar: "سيُرسَل إلى", en: "Will be sent to" },
  estCost: { ar: "التكلفة التقديرية", en: "Estimated cost" },
  perMsg: { ar: "لكل رسالة مُسلَّمة", en: "per delivered message" },
  queue: { ar: "ابدأ الإرسال", en: "Start sending" },
  queueConfirm: { ar: "سيتم إرسال «{t}» إلى {n} رقم بتكلفة تقديرية {c}. نبدأ؟", en: "Send “{t}” to {n} numbers at an estimated {c}. Start?" },
  sending: { ar: "جاري الإرسال…", en: "Sending…" },
  progress: { ar: "تم {s} · فشل {f} · متبقي {r}", en: "sent {s} · failed {f} · remaining {r}" },
  throttled: { ar: "Meta طلبت الإبطاء — الباقي سيُرسَل تلقائيًا خلال دقائق.", en: "Meta asked us to slow down — the rest goes out automatically over the next minutes." },
  testTitle: { ar: "رسالة تجريبية", en: "Test message" },
  testHint: { ar: "مع رقم Meta التجريبي لا يصل إلا للأرقام المضافة في API Setup.", en: "With Meta's test number only recipients added in API Setup receive it." },
  testTo: { ar: "رقم الموبايل", en: "Mobile number" },
  testName: { ar: "الاسم (للمعاينة)", en: "Name (for {{name}})" },
  sendTest: { ar: "ابعت تجربة", en: "Send test" },
  campaigns: { ar: "الحملات", en: "Campaigns" },
  noCampaigns: { ar: "لا توجد حملات بعد.", en: "No campaigns yet." },
  colName: { ar: "الحملة", en: "Campaign" },
  colTemplate: { ar: "القالب", en: "Template" },
  colStatus: { ar: "الحالة", en: "Status" },
  colRecipients: { ar: "المستلمون", en: "Recipients" },
  colSent: { ar: "أُرسل", en: "Sent" },
  colDelivered: { ar: "وصل", en: "Delivered" },
  colRead: { ar: "قُرئ", en: "Read" },
  colFailed: { ar: "فشل", en: "Failed" },
  colReplies: { ar: "ردود", en: "Replies" },
  colCost: { ar: "التكلفة", en: "Cost" },
  colDate: { ar: "التاريخ", en: "Date" },
  pause: { ar: "إيقاف مؤقت", en: "Pause" },
  resume: { ar: "استكمال", en: "Resume" },
  cancel: { ar: "إلغاء", en: "Cancel" },
  cancelConfirm: { ar: "إلغاء الحملة؟ المتبقي لن يُرسَل.", en: "Cancel this campaign? Nothing else will be sent." },
  failures: { ar: "أسباب الفشل", en: "Failure reasons" },
  st_queued: { ar: "في الانتظار", en: "Queued" },
  st_sending: { ar: "جاري الإرسال", en: "Sending" },
  st_paused: { ar: "متوقفة", en: "Paused" },
  st_done: { ar: "اكتملت", en: "Done" },
  st_canceled: { ar: "ملغاة", en: "Canceled" },
  consent: { ar: "الموافقات", en: "Consent" },
  consentHint: { ar: "الموافقة تُسجَّل تلقائيًا لما العميل يرد «نعم» أو «اشتراك» على الرقم، والرفض لما يرد «إلغاء». تقدر تضيف أرقامًا يدويًا (رقم في كل سطر) لعملاء وافقوا في مكان آخر.", en: "Opt-in is recorded automatically when a customer replies “نعم” / “اشتراك”, opt-out on “إلغاء” / STOP. Add numbers manually (one per line) for customers who consented elsewhere." },
  addOptIns: { ar: "إضافة موافقين", en: "Add opt-ins" },
  addOptOuts: { ar: "إضافة رافضين", en: "Add opt-outs" },
  added: { ar: "تمت إضافة {n}", en: "Added {n}" },
  inbox: { ar: "الردود الأخيرة", en: "Recent replies" },
  noReplies: { ar: "لا توجد ردود بعد.", en: "No replies yet." },
  invalidTo: { ar: "أدخل رقم موبايل صحيح", en: "Enter a valid mobile number" },
} as const;

type TKey = keyof typeof T;

// ------------------------------------------------------------ types

interface TemplateComponent {
  type: string;
  format?: string;
  text?: string;
  buttons?: { type: string; text?: string; url?: string }[];
}
interface WaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components: TemplateComponent[];
}
interface StatusResp {
  configured: boolean;
  enabled?: boolean;
  has_waba?: boolean;
  has_app_secret?: boolean;
  verify_token?: string | null;
  webhook_url: string;
  phone?: { display_phone_number?: string; verified_name?: string; quality_rating?: string; messaging_limit_tier?: string; name_status?: string };
  phone_error?: string;
  templates?: WaTemplate[];
  templates_error?: string;
}
interface SavedSegment {
  id: string;
  name: string;
  definition: Record<string, unknown>;
}
interface AudienceCount {
  reachable: number;
  opted_in: number;
  opted_out: number;
  recently_sent: number;
  sendable_opted_in: number;
  sendable_all: number;
}
interface CampaignRow {
  id: string;
  name: string;
  template_name: string;
  template_lang: string;
  audience: string;
  status: string;
  recipients: number;
  n_queued: number;
  n_sent: number;
  n_delivered: number;
  n_read: number;
  n_failed: number;
  n_replies: number;
  last_error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}
interface InboundRow {
  id: number;
  phone_norm: string;
  name: string | null;
  body: string | null;
  received_at: string;
  campaign_id: string | null;
}

// ------------------------------------------------------------ template helpers

/** placeholders in order of appearance: "1","2" (positional) or names */
function placeholders(text: string | undefined): string[] {
  const out: string[] = [];
  for (const m of (text ?? "").matchAll(/\{\{\s*([\w]+)\s*\}\}/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

function fill(text: string | undefined, values: Record<string, string>, name: string): string {
  return (text ?? "").replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, k: string) => (values[k] ?? `{{${k}}}`).replace(/\{\{\s*name\s*\}\}/gi, name));
}

function buildComponents(tpl: WaTemplate, body: Record<string, string>, header: string, buttons: Record<number, string>): unknown[] {
  const out: unknown[] = [];
  const h = tpl.components.find((c) => c.type === "HEADER");
  if (h) {
    const fmt = (h.format ?? "TEXT").toUpperCase();
    if (fmt === "IMAGE" && header) out.push({ type: "header", parameters: [{ type: "image", image: { link: header } }] });
    else if (fmt === "VIDEO" && header) out.push({ type: "header", parameters: [{ type: "video", video: { link: header } }] });
    else if (fmt === "DOCUMENT" && header) out.push({ type: "header", parameters: [{ type: "document", document: { link: header } }] });
    else if (fmt === "TEXT") {
      const keys = placeholders(h.text);
      if (keys.length && header) {
        const k = keys[0];
        out.push({ type: "header", parameters: [/^\d+$/.test(k) ? { type: "text", text: header } : { type: "text", parameter_name: k, text: header }] });
      }
    }
  }
  const b = tpl.components.find((c) => c.type === "BODY");
  const keys = placeholders(b?.text);
  if (keys.length) {
    out.push({
      type: "body",
      parameters: keys.map((k) => (/^\d+$/.test(k) ? { type: "text", text: body[k] ?? "" } : { type: "text", parameter_name: k, text: body[k] ?? "" })),
    });
  }
  const btns = tpl.components.find((c) => c.type === "BUTTONS")?.buttons ?? [];
  btns.forEach((bt, i) => {
    if (bt.type === "URL" && /\{\{\s*1\s*\}\}/.test(bt.url ?? "") && buttons[i]) {
      out.push({ type: "button", sub_type: "url", index: i, parameters: [{ type: "text", text: buttons[i] }] });
    }
  });
  return out;
}

function normPhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  const ten = d.startsWith("20") && d.length === 12 ? d.slice(2) : d.startsWith("0") && d.length === 11 ? d.slice(1) : d.length === 10 ? d : null;
  return ten && /^1[0125]\d{8}$/.test(ten) ? ten : null;
}

// ------------------------------------------------------------ page

export default function WhatsAppPage() {
  const { lang, t: tt } = useLang();
  const t = useCallback((k: TKey) => T[k][lang], [lang]);
  const supabase = useMemo(() => createClient(), []);

  // connection
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch("/api/whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status" }) });
      setStatus((await res.json()) as StatusResp);
    } catch {
      setStatus(null);
    }
    setStatusLoading(false);
  }, []);
  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const approved = useMemo(() => (status?.templates ?? []).filter((x) => x.status === "APPROVED"), [status]);

  // audience
  const [saved, setSaved] = useState<SavedSegment[]>([]);
  const [source, setSource] = useState<"saved" | "custom">("saved");
  const [savedId, setSavedId] = useState("");
  const [customDef, setCustomDef] = useState<Record<string, unknown> | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  useEffect(() => {
    supabase
      .from("saved_segments")
      .select("id, name, definition")
      .order("name")
      .then(({ data }) => setSaved((data as SavedSegment[]) ?? []));
    // handed over from /segments: ?def=<json>&label=…&sid=…
    try {
      const p = new URLSearchParams(window.location.search);
      const def = p.get("def");
      if (def) {
        setCustomDef(JSON.parse(def) as Record<string, unknown>);
        setCustomLabel(p.get("label") ?? "");
        setSource("custom");
        const sid = p.get("sid");
        if (sid) setSavedId(sid);
        setName(p.get("label") ?? "");
      }
    } catch {
      // bad param — ignore
    }
  }, [supabase]);

  const activeDef: Record<string, unknown> | null =
    source === "custom" ? customDef : saved.find((s) => s.id === savedId)?.definition ?? null;

  // form
  const [name, setName] = useState("");
  const [tplKey, setTplKey] = useState("");
  const tpl = approved.find((x) => `${x.name}|${x.language}` === tplKey) ?? null;
  const [bodyVals, setBodyVals] = useState<Record<string, string>>({});
  const [headerVal, setHeaderVal] = useState("");
  const [buttonVals, setButtonVals] = useState<Record<number, string>>({});
  const [audience, setAudience] = useState<"opted_in" | "all_reachable">("opted_in");
  const [capDays, setCapDays] = useState(14);
  const [count, setCount] = useState<AudienceCount | null>(null);
  const [counting, setCounting] = useState(false);

  useEffect(() => {
    setBodyVals({});
    setHeaderVal("");
    setButtonVals({});
  }, [tplKey]);

  const bodyText = tpl?.components.find((c) => c.type === "BODY")?.text;
  const bodyKeys = placeholders(bodyText);
  const header = tpl?.components.find((c) => c.type === "HEADER");
  const headerFmt = (header?.format ?? "TEXT").toUpperCase();
  const headerNeedsMedia = !!header && ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFmt);
  const headerNeedsText = !!header && headerFmt === "TEXT" && placeholders(header.text).length > 0;
  const dynButtons = (tpl?.components.find((c) => c.type === "BUTTONS")?.buttons ?? [])
    .map((b, i) => ({ ...b, i }))
    .filter((b) => b.type === "URL" && /\{\{\s*1\s*\}\}/.test(b.url ?? ""));
  const components = tpl ? buildComponents(tpl, bodyVals, headerVal, buttonVals) : [];
  const previewName = lang === "ar" ? "أحمد" : "Ahmed";

  async function countAudience() {
    if (!activeDef) return;
    setCounting(true);
    const { data, error } = await supabase.rpc("fn_wa_audience_count", { p_def: activeDef, p_cap_days: capDays });
    setCounting(false);
    if (error) {
      await notifyDialog(error.message);
      return;
    }
    setCount(data as AudienceCount);
  }
  useEffect(() => {
    setCount(null);
  }, [activeDef, capDays]);

  const sendable = count ? (audience === "opted_in" ? count.sendable_opted_in : count.sendable_all) : 0;
  const formReady = !!activeDef && !!tpl && name.trim().length > 0 && bodyKeys.every((k) => (bodyVals[k] ?? "").trim()) && (!headerNeedsMedia || headerVal.trim()) && (!headerNeedsText || headerVal.trim());

  // campaigns + sending loop
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const loadCampaigns = useCallback(async () => {
    const { data } = await supabase.rpc("fn_wa_campaigns", { p_limit: 50 });
    setCampaigns((data as CampaignRow[]) ?? []);
  }, [supabase]);
  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  const [run, setRun] = useState<{ active: boolean; sent: number; failed: number; remaining: number; throttled: string | null }>({ active: false, sent: 0, failed: 0, remaining: 0, throttled: null });

  const drive = useCallback(async () => {
    setRun({ active: true, sent: 0, failed: 0, remaining: 0, throttled: null });
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < 200; i++) {
      const res = await fetch("/api/whatsapp/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch: 150 }) });
      const j = (await res.json()) as { sent?: number; failed?: number; remaining?: number; throttled?: string | null; idle?: boolean; done?: boolean; error?: string; skipped?: string };
      if (j.error || j.skipped) {
        await notifyDialog(j.error ?? j.skipped ?? "");
        break;
      }
      sent += j.sent ?? 0;
      failed += j.failed ?? 0;
      setRun({ active: true, sent, failed, remaining: j.remaining ?? 0, throttled: j.throttled ?? null });
      await loadCampaigns();
      if (j.idle || j.throttled || (j.done && (j.remaining ?? 0) === 0)) {
        // one more pass picks up the next queued campaign, if any
        if (j.done && !j.idle) continue;
        break;
      }
    }
    setRun((r) => ({ ...r, active: false }));
    await loadCampaigns();
  }, [loadCampaigns]);

  // resume driving if something is still queued when the page opens
  useEffect(() => {
    if (!run.active && campaigns.some((c) => c.status === "sending" || c.status === "queued")) void drive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns.length]);

  async function queueCampaign() {
    if (!activeDef || !tpl || !count) return;
    const cost = formatMoney(sendable * WA_PRICE_EGP, lang);
    const ok = await confirmDialog(t("queueConfirm").replace("{t}", tpl.name).replace("{n}", formatNumber(sendable)).replace("{c}", cost));
    if (!ok) return;
    const { data, error } = await supabase.rpc("fn_wa_queue_campaign", {
      p_def: activeDef,
      p_name: name.trim(),
      p_template: tpl.name,
      p_lang: tpl.language,
      p_components: components,
      p_segment_id: source === "saved" ? savedId || null : savedId || null,
      p_audience: audience,
      p_cap_days: capDays,
    });
    if (error) {
      await notifyDialog(error.message);
      return;
    }
    const r = data as { campaign_id: string; recipients: number };
    setName("");
    setCount(null);
    await loadCampaigns();
    if (r.recipients > 0) void drive();
  }

  async function setCampaignStatus(id: string, st: "paused" | "queued" | "canceled") {
    if (st === "canceled" && !(await confirmDialog(t("cancelConfirm")))) return;
    const { error } = await supabase.rpc("fn_wa_campaign_set_status", { p_id: id, p_status: st });
    if (error) await notifyDialog(error.message);
    await loadCampaigns();
    if (st === "queued" && !run.active) void drive();
  }

  // test
  const [testTo, setTestTo] = useState("");
  const [testName, setTestName] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function sendTest() {
    if (!tpl) return;
    if (!normPhone(testTo)) {
      setTestMsg({ ok: false, text: t("invalidTo") });
      return;
    }
    setTestBusy(true);
    setTestMsg(null);
    const res = await fetch("/api/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send_test", to: testTo, name: testName, template: tpl.name, lang: tpl.language, components }),
    });
    const j = (await res.json()) as { ok: boolean; message?: string; wamid?: string };
    setTestBusy(false);
    setTestMsg({ ok: j.ok, text: j.ok ? `✓ ${j.wamid ?? ""}` : j.message ?? "failed" });
  }

  // consent + inbox
  const [optIns, setOptIns] = useState(0);
  const [optOuts, setOptOuts] = useState(0);
  const [inbox, setInbox] = useState<InboundRow[]>([]);
  const loadConsent = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.from("wa_opt_ins").select("phone_norm", { count: "exact", head: true }),
      supabase.from("wa_opt_outs").select("phone_norm", { count: "exact", head: true }),
      supabase.from("wa_inbound").select("id, phone_norm, name, body, received_at, campaign_id").order("received_at", { ascending: false }).limit(50),
    ]);
    setOptIns(a.count ?? 0);
    setOptOuts(b.count ?? 0);
    setInbox((c.data as InboundRow[]) ?? []);
  }, [supabase]);
  useEffect(() => {
    void loadConsent();
  }, [loadConsent]);

  const configured = !!status?.configured;
  const enabled = status?.enabled !== false;

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {/* connection */}
      <div className="card mb-6 p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Plug size={18} className="text-emerald-600" /> {t("connection")}</h2>
          <button className="btn-secondary !py-1.5 text-xs" onClick={loadStatus} disabled={statusLoading}>
            <RefreshCw size={14} className={statusLoading ? "animate-spin" : ""} /> {t("refresh")}
          </button>
        </div>
        {statusLoading && !status ? (
          <Spinner />
        ) : !configured ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t("notConfigured")}</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 text-sm">
              {!enabled && <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">{t("disabled")}</div>}
              {status?.phone_error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800" dir="ltr">{status.phone_error}</div>
              ) : (
                <>
                  <Row label={t("number")} value={<span dir="ltr">{status?.phone?.display_phone_number ?? "—"} {status?.phone?.verified_name ? `· ${status.phone.verified_name}` : ""}</span>} />
                  <Row label={t("quality")} value={<Badge tone={qualityTone(status?.phone?.quality_rating)}>{status?.phone?.quality_rating ?? "—"}</Badge>} />
                  <Row label={t("tier")} value={<span dir="ltr">{status?.phone?.messaging_limit_tier ?? "—"}</span>} />
                </>
              )}
              <div className="pt-2">
                <div className="mb-1 font-semibold">{t("webhook")}</div>
                <code className="block rounded bg-slate-100 px-2 py-1 text-xs" dir="ltr">{status?.webhook_url}</code>
                <p className="mt-1 text-xs text-slate-500">{t("webhookHint")}</p>
                {!status?.verify_token && <p className="mt-1 text-xs text-amber-700">⚠ {t("noVerify")}</p>}
                {!status?.has_app_secret && <p className="mt-1 text-xs text-amber-700">⚠ {t("noSecret")}</p>}
              </div>
            </div>
            <div>
              <div className="mb-1 text-sm font-semibold">{t("templates")} ({status?.templates?.length ?? 0})</div>
              {status?.templates_error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800" dir="ltr">{status.templates_error}</div>
              ) : !status?.templates?.length ? (
                <p className="text-xs text-slate-500">{t("noTemplates")}</p>
              ) : (
                <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
                  <table className="table-base text-xs">
                    <tbody>
                      {status.templates.map((x) => (
                        <tr key={x.id}>
                          <td dir="ltr" className="font-mono">{x.name}</td>
                          <td dir="ltr">{x.language}</td>
                          <td>{x.category}</td>
                          <td><Badge tone={x.status === "APPROVED" ? "green" : x.status === "REJECTED" || x.status === "PAUSED" ? "red" : "amber"}>{x.status}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* new campaign */}
      <div className="card mb-6 p-5">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold"><Send size={18} className="text-brand-600" /> {t("newCampaign")}</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <Field label={t("campaignName")}>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("audienceSrc")}>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={source === "saved"} onChange={() => setSource("saved")} /> {t("savedSeg")}
                </label>
                {customDef && (
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={source === "custom"} onChange={() => setSource("custom")} /> {t("fromSegments")}{customLabel ? `: ${customLabel}` : ""}
                  </label>
                )}
              </div>
              {source === "saved" && (
                <select className="input mt-2" value={savedId} onChange={(e) => setSavedId(e.target.value)}>
                  <option value="">{t("pickSeg")}</option>
                  {saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              <p className="mt-1 text-xs text-slate-500">{t("goSegments")}</p>
            </Field>
            <Field label={t("template")}>
              <select className="input" value={tplKey} onChange={(e) => setTplKey(e.target.value)} dir="ltr">
                <option value="">{t("pickTemplate")}</option>
                {approved.map((x) => <option key={x.id} value={`${x.name}|${x.language}`}>{x.name} · {x.language} · {x.category}</option>)}
              </select>
            </Field>
            {tpl && (bodyKeys.length > 0 || headerNeedsMedia || headerNeedsText || dynButtons.length > 0) && (
              <Field label={t("variables")}>
                <p className="mb-2 text-xs text-slate-500" dir="ltr">{t("nameHint")}</p>
                {headerNeedsMedia && (
                  <input className="input mb-2" dir="ltr" placeholder={t("headerImage")} value={headerVal} onChange={(e) => setHeaderVal(e.target.value)} />
                )}
                {headerNeedsText && (
                  <input className="input mb-2" placeholder={t("headerText")} value={headerVal} onChange={(e) => setHeaderVal(e.target.value)} />
                )}
                {bodyKeys.map((k) => (
                  <div key={k} className="mb-2 flex items-center gap-2">
                    <span className="w-16 shrink-0 font-mono text-xs text-slate-500" dir="ltr">{`{{${k}}}`}</span>
                    <input className="input" value={bodyVals[k] ?? ""} onChange={(e) => setBodyVals((v) => ({ ...v, [k]: e.target.value }))} />
                  </div>
                ))}
                {dynButtons.map((b) => (
                  <div key={b.i} className="mb-2 flex items-center gap-2">
                    <span className="w-16 shrink-0 text-xs text-slate-500">{t("buttonSuffix")}</span>
                    <input className="input" dir="ltr" placeholder={b.url?.replace(/\{\{\s*1\s*\}\}/, "…")} value={buttonVals[b.i] ?? ""} onChange={(e) => setButtonVals((v) => ({ ...v, [b.i]: e.target.value }))} />
                  </div>
                ))}
              </Field>
            )}
            <Field label={t("audienceMode")}>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="radio" checked={audience === "opted_in"} onChange={() => setAudience("opted_in")} /> {t("optedInOnly")}
              </label>
              <label className="mt-1 flex items-center gap-1.5 text-sm">
                <input type="radio" checked={audience === "all_reachable"} onChange={() => setAudience("all_reachable")} /> {t("allReachable")}
              </label>
              {audience === "all_reachable" && (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {t("allWarn")}
                </div>
              )}
            </Field>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              {t("cap")}
              <select className="input !w-auto !py-1" value={capDays} onChange={(e) => setCapDays(Number(e.target.value))}>
                <option value={0}>{t("any")}</option>
                {[3, 7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} {t("days")}</option>)}
              </select>
            </label>
          </div>

          <div className="space-y-3">
            {/* preview bubble */}
            <div className="text-xs font-semibold text-slate-600">{t("preview")}</div>
            <div className="rounded-xl bg-[#e5ddd5] p-4">
              <div className="ms-auto max-w-sm rounded-lg bg-white p-3 text-sm shadow" dir="rtl">
                {tpl ? (
                  <>
                    {headerNeedsMedia && headerVal && headerFmt === "IMAGE" && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={headerVal} alt="" className="mb-2 max-h-40 w-full rounded object-cover" />
                    )}
                    {header && headerFmt === "TEXT" && <div className="mb-1 font-bold">{fill(header.text, { [placeholders(header.text)[0] ?? ""]: headerVal }, previewName)}</div>}
                    <div className="whitespace-pre-wrap">{fill(bodyText, bodyVals, previewName)}</div>
                    {tpl.components.find((c) => c.type === "FOOTER")?.text && (
                      <div className="mt-1 text-xs text-slate-400">{tpl.components.find((c) => c.type === "FOOTER")?.text}</div>
                    )}
                    {(tpl.components.find((c) => c.type === "BUTTONS")?.buttons ?? []).map((b, i) => (
                      <div key={i} className="mt-2 border-t border-slate-100 pt-1 text-center text-sm text-sky-600">{b.text}</div>
                    ))}
                  </>
                ) : (
                  <span className="text-slate-400">…</span>
                )}
              </div>
            </div>

            {/* count + cost */}
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <button className="btn-secondary !py-1.5 text-xs" onClick={countAudience} disabled={!activeDef || counting}>
                  <RefreshCw size={14} className={counting ? "animate-spin" : ""} /> {t("count")}
                </button>
                <span className="text-xs text-slate-500">{formatMoney(WA_PRICE_EGP, lang)} {t("perMsg")}</span>
              </div>
              {count && (
                <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
                  <Mini label={t("reachable")} value={formatNumber(count.reachable)} />
                  <Mini label={t("optedIn")} value={formatNumber(count.opted_in)} tone="text-emerald-700" />
                  <Mini label={t("optedOut")} value={formatNumber(count.opted_out)} tone="text-red-600" />
                  <Mini label={t("recent")} value={formatNumber(count.recently_sent)} tone="text-amber-700" />
                  <Mini label={t("sendable")} value={formatNumber(sendable)} tone="text-brand-700" />
                  <Mini label={t("estCost")} value={formatMoney(sendable * WA_PRICE_EGP, lang)} tone="text-brand-700" />
                </div>
              )}
            </div>

            <button className="btn-primary w-full" onClick={queueCampaign} disabled={!formReady || !count || sendable === 0 || run.active || !configured || !enabled}>
              <Send size={16} /> {t("queue")} {count ? `(${formatNumber(sendable)})` : ""}
            </button>
            {run.active && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
                <Spinner /> {t("sending")} {t("progress").replace("{s}", formatNumber(run.sent)).replace("{f}", formatNumber(run.failed)).replace("{r}", formatNumber(run.remaining))}
              </div>
            )}
            {run.throttled && <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">{t("throttled")}</div>}

            {/* test */}
            <div className="rounded-lg border border-dashed border-slate-300 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><FlaskConical size={14} /> {t("testTitle")}</div>
              <p className="mb-2 text-xs text-slate-500">{t("testHint")}</p>
              <div className="flex flex-wrap gap-2">
                <input className="input !w-40" dir="ltr" placeholder={t("testTo")} value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                <input className="input !w-32" placeholder={t("testName")} value={testName} onChange={(e) => setTestName(e.target.value)} />
                <button className="btn-secondary !py-1.5 text-xs" onClick={sendTest} disabled={!tpl || testBusy || !configured}>
                  <Send size={14} /> {t("sendTest")}
                </button>
              </div>
              {testMsg && <div className={cn("mt-2 text-xs", testMsg.ok ? "text-emerald-700" : "text-red-700")} dir="ltr">{testMsg.text}</div>}
            </div>
          </div>
        </div>
      </div>

      {/* campaigns */}
      <div className="card mb-6 p-5">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><MessageCircle size={18} className="text-emerald-600" /> {t("campaigns")}</h2>
        {!campaigns.length ? (
          <p className="text-sm text-slate-500">{t("noCampaigns")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t("colName")}</th>
                  <th>{t("colTemplate")}</th>
                  <th>{t("colStatus")}</th>
                  <th>{t("colRecipients")}</th>
                  <th>{t("colSent")}</th>
                  <th>{t("colDelivered")}</th>
                  <th>{t("colRead")}</th>
                  <th>{t("colFailed")}</th>
                  <th>{t("colReplies")}</th>
                  <th>{t("colCost")}</th>
                  <th>{t("colDate")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <CampaignLine key={c.id} c={c} t={t} lang={lang} onStatus={setCampaignStatus} supabase={supabase} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* consent */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-bold"><UserCheck size={18} className="text-emerald-600" /> {t("consent")}</h2>
          <p className="mb-3 text-xs text-slate-500">{t("consentHint")}</p>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Mini label={t("optedIn")} value={formatNumber(optIns)} tone="text-emerald-700" />
            <Mini label={t("optedOut")} value={formatNumber(optOuts)} tone="text-red-600" />
          </div>
          <ConsentAdder table="wa_opt_ins" label={t("addOptIns")} icon={UserCheck} supabase={supabase} onDone={loadConsent} addedText={t("added")} />
          <ConsentAdder table="wa_opt_outs" label={t("addOptOuts")} icon={Ban} supabase={supabase} onDone={loadConsent} addedText={t("added")} />
        </div>
        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Inbox size={18} className="text-brand-600" /> {t("inbox")}</h2>
          {!inbox.length ? (
            <p className="text-sm text-slate-500">{t("noReplies")}</p>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200">
              <table className="table-base text-sm">
                <thead>
                  <tr><th>{tt("customer")}</th><th>{tt("phone")}</th><th></th><th>{t("colDate")}</th></tr>
                </thead>
                <tbody>
                  {inbox.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name ?? "—"}</td>
                      <td dir="ltr" className="text-xs text-slate-600">0{r.phone_norm}</td>
                      <td className="max-w-xs whitespace-pre-wrap text-xs">{r.body ?? "—"}</td>
                      <td className="text-xs text-slate-500" dir="ltr">{formatDateTimeEg(r.received_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ pieces

function qualityTone(q?: string): "green" | "amber" | "red" | "slate" {
  if (q === "GREEN") return "green";
  if (q === "YELLOW") return "amber";
  if (q === "RED") return "red";
  return "slate";
}

function Badge({ tone, children }: { tone: "green" | "amber" | "red" | "slate"; children: React.ReactNode }) {
  const cls = { green: "bg-emerald-100 text-emerald-700", amber: "bg-amber-100 text-amber-700", red: "bg-red-100 text-red-700", slate: "bg-slate-100 text-slate-600" }[tone];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", cls)}>{children}</span>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-1">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={cn("text-base font-bold", tone)}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-600">{label}</label>
      {children}
    </div>
  );
}

function CampaignLine({
  c, t, lang, onStatus, supabase,
}: {
  c: CampaignRow;
  t: (k: TKey) => string;
  lang: "ar" | "en";
  onStatus: (id: string, st: "paused" | "queued" | "canceled") => void;
  supabase: ReturnType<typeof createClient>;
}) {
  const [open, setOpen] = useState(false);
  const [fails, setFails] = useState<{ wa_to: string; error: string | null }[] | null>(null);
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && fails === null) {
      const { data } = await supabase.from("wa_sends").select("wa_to, error").eq("campaign_id", c.id).eq("status", "failed").limit(50);
      setFails((data as { wa_to: string; error: string | null }[]) ?? []);
    }
  }
  const tone = c.status === "done" ? "green" : c.status === "canceled" ? "slate" : c.status === "paused" ? "amber" : "green";
  const live = c.status === "queued" || c.status === "sending";
  return (
    <>
      <tr>
        <td className="font-medium">{c.name}</td>
        <td dir="ltr" className="font-mono text-xs">{c.template_name}</td>
        <td><Badge tone={tone}>{t(`st_${c.status}` as TKey)}</Badge>{c.last_error && <span className="ms-1 text-[11px] text-amber-700" title={c.last_error}>⚠</span>}</td>
        <td>{formatNumber(c.recipients)}</td>
        <td>{formatNumber(c.n_sent)}</td>
        <td className="text-emerald-700">{formatNumber(c.n_delivered)}</td>
        <td className="text-sky-700">{formatNumber(c.n_read)}</td>
        <td className={c.n_failed ? "text-red-600" : ""}>{formatNumber(c.n_failed)}</td>
        <td>{formatNumber(c.n_replies)}</td>
        <td className="text-xs">{formatMoney(c.n_delivered * WA_PRICE_EGP, lang)}</td>
        <td className="text-xs text-slate-500" dir="ltr">{formatDateTimeEg(c.created_at)}</td>
        <td className="whitespace-nowrap">
          {live && <button className="btn-secondary !px-2 !py-1 text-xs" title={t("pause")} onClick={() => onStatus(c.id, "paused")}><Pause size={12} /></button>}
          {c.status === "paused" && <button className="btn-secondary !px-2 !py-1 text-xs" title={t("resume")} onClick={() => onStatus(c.id, "queued")}><Play size={12} /></button>}
          {(live || c.status === "paused") && <button className="btn-secondary ms-1 !px-2 !py-1 text-xs text-red-600" title={t("cancel")} onClick={() => onStatus(c.id, "canceled")}><XCircle size={12} /></button>}
          {c.n_failed > 0 && <button className="btn-secondary ms-1 !px-2 !py-1 text-xs" title={t("failures")} onClick={toggle}>{open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={12} className="bg-red-50/50">
            {fails === null ? <Spinner /> : (
              <ul className="max-h-40 overflow-y-auto text-xs" dir="ltr">
                {fails.map((f, i) => <li key={i}><span className="font-mono">{f.wa_to}</span> — {f.error ?? "—"}</li>)}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function ConsentAdder({
  table, label, icon: Icon, supabase, onDone, addedText,
}: {
  table: "wa_opt_ins" | "wa_opt_outs";
  label: string;
  icon: React.ElementType;
  supabase: ReturnType<typeof createClient>;
  onDone: () => void;
  addedText: string;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(0);
  async function add() {
    const phones = Array.from(new Set(text.split(/[\s,;]+/).map(normPhone).filter((x): x is string => !!x)));
    if (!phones.length) return;
    setBusy(true);
    const { error } = await supabase.from(table).upsert(phones.map((p) => ({ phone_norm: p, source: "manual" })), { onConflict: "phone_norm" });
    setBusy(false);
    if (error) {
      await notifyDialog(error.message);
      return;
    }
    setAdded(phones.length);
    setText("");
    onDone();
    setTimeout(() => setAdded(0), 4000);
  }
  return (
    <div className="mb-3">
      <textarea className="input h-16 text-xs" dir="ltr" placeholder="01xxxxxxxxx" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn-secondary mt-1 !py-1 text-xs" onClick={add} disabled={busy || !text.trim()}>
        {added ? <CheckCircle2 size={14} /> : <Icon size={14} />} {added ? addedText.replace("{n}", formatNumber(added)) : label}
      </button>
    </div>
  );
}
