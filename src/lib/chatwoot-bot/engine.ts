// ─────────────────────────────────────────────────────────────
// Chatwoot After-Hours Bot — routing engine
//
// Pure rules, no AI, no guessing. Default reply text lives in script.ts;
// admins can override any of it from Settings → Chatwoot Bot (stored in
// app_settings key "chatwoot_bot_script", merged over the defaults by
// mergeScript below). Ported from the tested nm_bot.py reference.
// ─────────────────────────────────────────────────────────────

import {
  INTENTS,
  HANDOFF_KEYWORDS_AR,
  HANDOFF_KEYWORDS_EN,
  HANDOFF_AR,
  HANDOFF_EN,
  FALLBACK_AR,
  FALLBACK_EN,
  FOOTER_AR,
  FOOTER_EN,
  GREETING_AR,
  GREETING_EN,
  type Intent,
} from "./script.ts";

// ── The script object the engine routes against ─────────────

export interface BotScript {
  greetingAr: string;
  greetingEn: string;
  fallbackAr: string;
  fallbackEn: string;
  handoffAr: string;
  handoffEn: string;
  footerAr: string;
  footerEn: string;
  handoffKeywordsAr: string[];
  handoffKeywordsEn: string[];
  intents: Record<string, Intent>;
}

export const DEFAULT_SCRIPT: BotScript = {
  greetingAr: GREETING_AR,
  greetingEn: GREETING_EN,
  fallbackAr: FALLBACK_AR,
  fallbackEn: FALLBACK_EN,
  handoffAr: HANDOFF_AR,
  handoffEn: HANDOFF_EN,
  footerAr: FOOTER_AR,
  footerEn: FOOTER_EN,
  handoffKeywordsAr: HANDOFF_KEYWORDS_AR,
  handoffKeywordsEn: HANDOFF_KEYWORDS_EN,
  intents: INTENTS,
};

/**
 * Shape of the overrides JSON stored in app_settings key
 * "chatwoot_bot_script" (snake_case, edited from the Settings UI).
 * Any field left out falls back to the built-in default.
 */
export interface ScriptOverrides {
  greeting_ar?: string;
  greeting_en?: string;
  fallback_ar?: string;
  fallback_en?: string;
  handoff_ar?: string;
  handoff_en?: string;
  footer_ar?: string;
  footer_en?: string;
  handoff_keywords_ar?: string[];
  handoff_keywords_en?: string[];
  intents?: Record<string, Partial<Intent>>;
}

export function mergeScript(overrides?: ScriptOverrides | null): BotScript {
  if (!overrides) return DEFAULT_SCRIPT;
  const intents: Record<string, Intent> = {};
  // Default intents first (preserving their order — score ties keep it),
  // each patched by its override; then any brand-new intents appended.
  for (const [key, cfg] of Object.entries(DEFAULT_SCRIPT.intents)) {
    intents[key] = { ...cfg, ...(overrides.intents?.[key] ?? {}) };
  }
  for (const [key, cfg] of Object.entries(overrides.intents ?? {})) {
    if (!(key in intents) && cfg.menu && cfg.ar && cfg.en) {
      intents[key] = {
        menu: cfg.menu,
        keywords_ar: cfg.keywords_ar ?? [],
        keywords_en: cfg.keywords_en ?? [],
        ar: cfg.ar,
        en: cfg.en,
      };
    }
  }
  return {
    greetingAr: overrides.greeting_ar || DEFAULT_SCRIPT.greetingAr,
    greetingEn: overrides.greeting_en || DEFAULT_SCRIPT.greetingEn,
    fallbackAr: overrides.fallback_ar || DEFAULT_SCRIPT.fallbackAr,
    fallbackEn: overrides.fallback_en || DEFAULT_SCRIPT.fallbackEn,
    handoffAr: overrides.handoff_ar || DEFAULT_SCRIPT.handoffAr,
    handoffEn: overrides.handoff_en || DEFAULT_SCRIPT.handoffEn,
    footerAr: overrides.footer_ar ?? DEFAULT_SCRIPT.footerAr,
    footerEn: overrides.footer_en ?? DEFAULT_SCRIPT.footerEn,
    handoffKeywordsAr: overrides.handoff_keywords_ar?.length
      ? overrides.handoff_keywords_ar
      : DEFAULT_SCRIPT.handoffKeywordsAr,
    handoffKeywordsEn: overrides.handoff_keywords_en?.length
      ? overrides.handoff_keywords_en
      : DEFAULT_SCRIPT.handoffKeywordsEn,
    intents,
  };
}

// ── Arabic normalisation ─────────────────────────────────────
// Without this, "الاسكندريه" never matches "الإسكندرية" and keyword
// routing silently fails for half the customers.

const TASHKEEL = /[\u0617-\u061A\u064B-\u0652\u0640]/g;
// Arabic punctuation (U+061F question mark, U+060C comma) lives INSIDE the
// \u0600-\u06FF block, so a naive "keep all Arabic" regex would preserve it
// as if it were a letter and turn an Arabic word ending in it into an
// unmatchable token. Restrict the keep-range to the letters \u0621-\u064A;
// every other non-word char becomes a space.
const PUNCT = /[^\w\s\u0621-\u064A]/g;
// Arabic-Indic digits (U+0660-U+0669) map to ASCII so an Arabic-keyboard "1"
// selects menu item 1 too.
const ARABIC_DIGITS = /[\u0660-\u0669]/g;

// Prefixes that glue onto Arabic nouns: الشحن / بالشحن / للشحن / والشحن.
// Longer prefixes first — checked in order, first match wins.
const PREFIXES = ["وال", "بال", "فال", "كال", "ال", "لل", "و", "ب", "ل", "ف", "ك"];

export function norm(text: string): string {
  if (!text) return "";
  let t = text.replace(TASHKEEL, "");
  t = t.replace(/[أإآٱ]/g, "ا");
  t = t.replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي");
  t = t.replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660));
  t = t.replace(PUNCT, " ");
  return t.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Tokens plus prefix-stripped variants, so "الشحن" also matches "شحن". */
export function tokenize(n: string): Set<string> {
  const out = new Set<string>();
  for (const tok of n.split(" ")) {
    if (!tok) continue;
    out.add(tok);
    for (const p of PREFIXES) {
      if (tok.startsWith(p) && tok.length - p.length >= 3) {
        out.add(tok.slice(p.length));
        break;
      }
    }
  }
  return out;
}

export function isArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text || "");
}

// ── Routing ──────────────────────────────────────────────────

/** Below this score we'd rather admit we don't know than guess. */
export const MIN_SCORE = 3;

/**
 * Score one keyword against the message. 0 = no match.
 *
 * Short keywords must match a WHOLE token. Without this, "سن" matches
 * inside "أحسن" and "إيه أحسن مطعم" gets routed to the books menu.
 * Longer keywords score higher, so "cash on delivery" beats a bare
 * "delivery".
 */
function matchScore(kw: string, text: string, tokens: Set<string>): number {
  const k = norm(kw);
  if (!k) return 0;
  if (k.includes(" ")) return text.includes(k) ? k.length : 0; // multi-word phrase
  if (k.length <= 4) return tokens.has(k) ? k.length + 2 : 0;  // short word — whole token only
  return text.includes(k) ? k.length : 0;                      // long word — substring is safe
}

/** Returns an intent key, "handoff", or null (= fallback). Never guesses. */
export function route(text: string, script: BotScript = DEFAULT_SCRIPT): string | null {
  const n = norm(text);
  if (!n) return null;
  const tokens = tokenize(n);

  // Menu selection wins — a bare "0" or "3"
  const stripped = n.replace(/^[ .\-]+|[ .\-]+$/g, "");
  if (stripped === "0") return "handoff";
  for (const [key, cfg] of Object.entries(script.intents)) {
    if (cfg.menu && stripped === cfg.menu) return key;
  }

  // Explicit handoff request
  for (const kw of [...script.handoffKeywordsAr, ...script.handoffKeywordsEn]) {
    if (matchScore(kw, n, tokens)) return "handoff";
  }

  // Keyword match — highest-scoring intent wins; ties keep intent order
  let best: string | null = null;
  let bestScore = 0;
  for (const [key, cfg] of Object.entries(script.intents)) {
    let score = 0;
    for (const kw of [...cfg.keywords_ar, ...cfg.keywords_en]) {
      score += matchScore(kw, n, tokens);
    }
    if (score > bestScore) {
      best = key;
      bestScore = score;
    }
  }
  if (bestScore >= MIN_SCORE) return best;

  // No keyword matched, but the message contains a 3+ digit number — almost
  // certainly an order number (customers often paste just the number). Route
  // to tracking, which explains the bot can't see live status and how to
  // leave details, instead of a blunt "I don't understand".
  if ("track" in script.intents && /\d{3,}/.test(n)) return "track";

  return null;
}

export function replyFor(intent: string, arabic: boolean, script: BotScript = DEFAULT_SCRIPT): string {
  if (intent === "handoff") return arabic ? script.handoffAr : script.handoffEn;
  const cfg = script.intents[intent];
  return (arabic ? cfg.ar : cfg.en) + (arabic ? script.footerAr : script.footerEn);
}

// ── Business hours ───────────────────────────────────────────

export interface WorkingHours {
  timezone: string;      // IANA name, e.g. "Africa/Cairo"
  days: Set<string>;     // lowercase 3-letter day names, e.g. "sun"
  startHour: number;     // inclusive
  endHour: number;       // exclusive
}

export function withinHours(cfg: WorkingHours, now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: cfg.timezone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const day = parts.find((p) => p.type === "weekday")?.value.toLowerCase() ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? -1);
  return cfg.days.has(day) && hour >= cfg.startHour && hour < cfg.endHour;
}

// ── Webhook handler ──────────────────────────────────────────
// Side effects (Chatwoot API calls, clock, config) are injected so the
// whole flow is unit-testable without a server.

export interface WebhookContext {
  webhookToken: string | undefined;
  afterHoursOnly: boolean;
  withinHours: () => boolean;
  /** The (possibly admin-edited) reply script. Defaults to the built-in. */
  script?: BotScript;
  /** Post a bot reply to the conversation. */
  send: (conversationId: number, content: string) => Promise<void>;
  /** Move the conversation to the human queue (status: open). */
  openConversation: (conversationId: number) => Promise<void>;
  /** PII-safe logger — receives conversation ids and intent names only. */
  log: (message: string) => void;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

interface ChatwootPayload {
  event?: string;
  id?: number;
  content?: string;
  message_type?: string;
  sender?: { type?: string };
  conversation?: { id?: number };
}

export async function handleWebhook(
  token: string,
  payload: unknown,
  ctx: WebhookContext
): Promise<WebhookResult> {
  if (!ctx.webhookToken || token !== ctx.webhookToken) {
    return { status: 403, body: { error: "forbidden" } };
  }

  // Chatwoot retries on non-200, so from here on nothing may throw.
  try {
    const script = ctx.script ?? DEFAULT_SCRIPT;
    const data = (payload ?? {}) as ChatwootPayload;
    const event = data.event;
    const convId =
      data.conversation?.id ?? (event === "conversation_created" ? data.id : undefined);
    if (!convId) return { status: 200, body: { ok: true } };

    // During working hours, stay out of the way — humans are on.
    if (ctx.afterHoursOnly && ctx.withinHours()) {
      await ctx.openConversation(convId);
      return { status: 200, body: { ok: true, skipped: "working_hours" } };
    }

    // Greet once, when the conversation opens
    if (event === "conversation_created") {
      await ctx.send(convId, script.greetingAr + "\n\n———\n" + script.greetingEn);
      return { status: 200, body: { ok: true } };
    }

    if (event !== "message_created") return { status: 200, body: { ok: true } };

    // Only react to the customer. Ignore our own messages or we loop forever.
    if (data.message_type !== "incoming") return { status: 200, body: { ok: true } };
    if (data.sender?.type === "agent_bot") return { status: 200, body: { ok: true } };

    const text = data.content ?? "";
    const arabic = isArabic(text) || !/[a-zA-Z]/.test(text);

    const intent = route(text, script);
    if (intent === null) {
      ctx.log(`conv=${convId} intent=fallback`);
      await ctx.send(convId, arabic ? script.fallbackAr : script.fallbackEn);
      return { status: 200, body: { ok: true, intent: "fallback" } };
    }

    ctx.log(`conv=${convId} intent=${intent}`);
    await ctx.send(convId, replyFor(intent, arabic, script));
    // Handoff — and any intent flagged open (e.g. cancel) — goes to the
    // human queue so the team follows up in the morning.
    if (intent === "handoff" || script.intents[intent]?.open) {
      await ctx.openConversation(convId);
    }
    return { status: 200, body: { ok: true, intent } };
  } catch (e) {
    // Log the error type only — never message content (PII).
    ctx.log(`webhook error: ${e instanceof Error ? e.message : "unknown"}`);
    return { status: 200, body: { ok: true, error: "handled" } };
  }
}
