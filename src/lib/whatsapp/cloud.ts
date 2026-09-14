// WhatsApp Cloud API — the thin server-side client behind the campaign
// worker, the webhook and the Settings test button. Credentials come from
// app_settings.whatsapp (the Settings card); nothing here is imported by
// browser code.

import type { SupabaseClient } from "@supabase/supabase-js";

export const GRAPH = "https://graph.facebook.com/v26.0";

export interface WaConfig {
  phoneNumberId: string;
  wabaId: string | null;
  accessToken: string;
  appSecret: string | null;
  verifyToken: string | null;
  enabled: boolean;
}

export function parseWaSettings(value: Record<string, unknown> | null | undefined): WaConfig | null {
  const v = value ?? {};
  const phoneNumberId = String(v.phone_number_id ?? "").trim();
  const accessToken = String(v.access_token ?? "").trim();
  if (!phoneNumberId || !accessToken) return null;
  return {
    phoneNumberId,
    wabaId: String(v.business_account_id ?? "").trim() || null,
    accessToken,
    appSecret: String(v.app_secret ?? "").trim() || null,
    verifyToken: String(v.verify_token ?? "").trim() || null,
    // absent means on — same rule as every other integration card
    enabled: String(v.enabled ?? true) !== "false",
  };
}

export async function loadWaConfig(db: SupabaseClient): Promise<WaConfig | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", "whatsapp").maybeSingle();
  return parseWaSettings((data?.value ?? null) as Record<string, unknown> | null);
}

export class GraphError extends Error {
  code: number | null;
  subcode: number | null;
  details: string | null;
  status: number;
  constructor(message: string, opts: { code?: number | null; subcode?: number | null; details?: string | null; status: number }) {
    super(message);
    this.name = "GraphError";
    this.code = opts.code ?? null;
    this.subcode = opts.subcode ?? null;
    this.details = opts.details ?? null;
    this.status = opts.status;
  }
  /** Meta asks us to slow down — leave the queue alone and retry later. */
  get throttled(): boolean {
    return this.status === 429 || [4, 17, 32, 80007, 130429, 131048, 131056].includes(this.code ?? -1);
  }
}

async function graph<T>(cfg: WaConfig, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${GRAPH}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } } } | null)?.error;
    throw new GraphError(err?.message ?? `HTTP ${res.status}`, {
      code: err?.code ?? null,
      subcode: err?.error_subcode ?? null,
      details: err?.error_data?.details ?? null,
      status: res.status,
    });
  }
  return json as T;
}

export interface PhoneInfo {
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
  name_status?: string;
  messaging_limit_tier?: string;
}

export function getPhoneInfo(cfg: WaConfig): Promise<PhoneInfo> {
  const fields = "display_phone_number,verified_name,quality_rating,code_verification_status,name_status,messaging_limit_tier";
  return graph<PhoneInfo>(cfg, `${cfg.phoneNumberId}?fields=${fields}`);
}

export interface TemplateComponent {
  type: string; // HEADER | BODY | FOOTER | BUTTONS
  format?: string; // TEXT | IMAGE | VIDEO | DOCUMENT
  text?: string;
  buttons?: { type: string; text?: string; url?: string; example?: string[] }[];
  example?: unknown;
}

export interface WaTemplate {
  id: string;
  name: string;
  language: string;
  status: string; // APPROVED | PENDING | REJECTED | PAUSED | DISABLED
  category: string; // MARKETING | UTILITY | AUTHENTICATION
  components: TemplateComponent[];
}

export async function listTemplates(cfg: WaConfig): Promise<WaTemplate[]> {
  if (!cfg.wabaId) return [];
  const out: WaTemplate[] = [];
  let path: string | null = `${cfg.wabaId}/message_templates?fields=id,name,language,status,category,components&limit=100`;
  while (path) {
    const page: { data?: WaTemplate[]; paging?: { next?: string } } = await graph(cfg, path);
    out.push(...(page.data ?? []));
    const next = page.paging?.next;
    path = next ? next.replace(`${GRAPH}/`, "") : null;
    if (next && !next.startsWith(GRAPH)) break;
  }
  return out;
}

/** One template message. `components` is Meta's payload shape, already
 *  rendered for this recipient. Returns the message id (wamid). */
export async function sendTemplate(
  cfg: WaConfig,
  to: string,
  template: string,
  language: string,
  components: unknown[]
): Promise<string> {
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: template,
      language: { code: language },
      ...(components.length ? { components } : {}),
    },
  };
  const res = await graph<{ messages?: { id: string }[] }>(cfg, `${cfg.phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.messages?.[0]?.id ?? "";
}

/** Free-form text — only deliverable inside the 24h window a customer opens
 *  by writing to us, which is exactly when opt-in/opt-out confirmations go out. */
export async function sendText(cfg: WaConfig, to: string, text: string): Promise<string> {
  const res = await graph<{ messages?: { id: string }[] }>(cfg, `${cfg.phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: false } }),
  });
  return res.messages?.[0]?.id ?? "";
}

// ------------------------------------------------------------ rendering

export const NAME_FALLBACK_AR = "عميلنا العزيز";

export function firstName(name: string | null | undefined, fallback = NAME_FALLBACK_AR): string {
  const n = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return n.length >= 2 ? n : fallback;
}

/** Replaces {{name}} in every parameter text with the recipient's first
 *  name. Deep-clones so the campaign's stored payload is never mutated. */
export function renderComponents(components: unknown, name: string | null | undefined): unknown[] {
  const cloned = JSON.parse(JSON.stringify(components ?? [])) as unknown;
  const first = firstName(name);
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return node.replace(/\{\{\s*name\s*\}\}/gi, first);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = walk(v);
      return out;
    }
    return node;
  };
  const rendered = walk(cloned);
  return Array.isArray(rendered) ? rendered : [];
}

// ------------------------------------------------------------ consent keywords

// Same normalisation the Chatwoot bot uses: أإآ→ا, ة→ه, ى→ي, no tashkeel
function normalizeArabic(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const OUT_PHRASES = ["stop", "unsubscribe", "cancel", "block", "remove", "الغاء", "الغاء الاشتراك", "ايقاف", "وقف", "مش عايز", "لا اريد", "ما اريد", "كفايه", "بطلوا"];
const IN_PHRASES = ["yes", "subscribe", "start", "ok", "نعم", "اشتراك", "موافق", "ابدا", "عروض", "عايز العروض", "اه", "ايوه", "ايوا", "تمام"];

export type ConsentSignal = "in" | "out" | null;

/** A short reply that is clearly consent or clearly a refusal. Longer
 *  messages are left to a human — a question mentioning "عروض" is not an
 *  opt-in. */
export function consentSignal(text: string | null | undefined): ConsentSignal {
  const n = normalizeArabic(text ?? "");
  if (!n || n.length > 40) return null;
  const has = (phrases: string[]) => phrases.some((p) => n === p || n.split(" ").includes(p) || (p.includes(" ") && n.includes(p)));
  if (has(OUT_PHRASES)) return "out";
  if (has(IN_PHRASES)) return "in";
  return null;
}

export const OPT_OUT_REPLY_AR = "تم إلغاء اشتراكك في رسائل العروض من مكتبة نهضة مصر. لن نرسل لك عروضًا مرة أخرى. لو حبيت ترجع في أي وقت اكتب «اشتراك».";
export const OPT_IN_REPLY_AR = "تم تسجيلك لاستقبال عروض مكتبة نهضة مصر على واتساب 📚 هنبعتلك أهم العروض والإصدارات الجديدة فقط. لإلغاء الاشتراك في أي وقت اكتب «إلغاء».";

/** last 10 digits — the same key sms_opt_outs uses */
export function phoneNorm(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "").slice(-10);
}
