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
  ATTACHMENT_AR,
  ATTACHMENT_EN,
  MENU_PROMPT_AR,
  MENU_PROMPT_EN,
  HANDOFF_TITLE_AR,
  HANDOFF_TITLE_EN,
  WORKING_HOURS_ACK_AR,
  WORKING_HOURS_ACK_EN,
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

// \u2500\u2500 Contact-detail extraction \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Customers answer the handoff prompt with phone numbers, emails, names,
// and order numbers in free text. Parse what regexes can parse reliably so
// it lands in the Chatwoot contact panel instead of dying in the transcript.

export interface ExtractedDetails {
  phone?: string;       // E.164, e.g. +201012345678
  email?: string;
  name?: string;        // only from an explicit "\u0627\u0633\u0645\u064A \u2026" / "my name is \u2026"
  orderNumber?: string; // 4-8 digits that are not part of the phone number
}

export function extractDetails(text: string): ExtractedDetails {
  if (!text) return {};
  const out: ExtractedDetails = {};
  // Arabic-Indic digits \u2192 ASCII, then strip separators inside numbers.
  const ascii = text.replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660));
  const squeezed = ascii.replace(/[\s\-().]+/g, " ");

  const phoneMatch = squeezed.replace(/ /g, "").match(/(?:\+?20|0)?(1[0125]\d{8})/);
  if (phoneMatch) out.phone = `+20${phoneMatch[1]}`;

  const emailMatch = ascii.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (emailMatch) out.email = emailMatch[0];

  const nameMatch = ascii.match(/(?:\u0627\u0633\u0645\u064A|\u0627\u0646\u0627 \u0627\u0633\u0645\u064A|\u0623\u0633\u0645\u064A|my name is)[:\s]+([^\n\u2022,;0-9]{2,40})/i);
  if (nameMatch) {
    out.name = nameMatch[1]
      .replace(/\s*(?:\u0648?\u0631\u0642\u0645\u064A|\u0648?\u0631\u0642\u0645|\u062A\u0644\u064A\u0641\u0648\u0646\u064A|\u0645\u0648\u0628\u0627\u064A\u0644\u064A|\u0645\u0648\u0628\u0627\u064A\u0644|\u062A\u0644\u064A\u0641\u0648\u0646|phone).*$/i, "")
      .trim();
    if (out.name.length < 2) delete out.name;
  }

  // Order number: digits that are NOT the phone we just found.
  const withoutPhone = phoneMatch ? squeezed.replace(/ /g, "").replace(phoneMatch[0], " ") : ascii;
  const orderMatch = withoutPhone.match(/(?<!\d)(\d{4,8})(?!\d)/);
  if (orderMatch) out.orderNumber = orderMatch[1];

  return out;
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

/**
 * Second stage: once a topic has won, pick the most specific answer for the
 * question — "shipping to Giza?" gets the Greater Cairo rate, not the whole
 * 27-governorate list. Returns null when no variant matches.
 */
export function variantBody(
  intent: string,
  arabic: boolean,
  script: BotScript,
  messageText: string
): string | null {
  const cfg = script.intents[intent];
  if (!cfg?.variants || !messageText) return null;
  const n = norm(messageText);
  const tokens = tokenize(n);
  let body: string | null = null;
  let bestScore = 0;
  for (const v of Object.values(cfg.variants)) {
    let score = 0;
    for (const kw of [...v.keywords_ar, ...v.keywords_en]) {
      score += matchScore(kw, n, tokens);
    }
    if (score > bestScore) {
      bestScore = score;
      body = arabic ? v.ar : v.en;
    }
  }
  return body;
}

/** "Show me everything" replies inside an ask-flow (e.g. after "which governorate?"). */
const ALL_LIST_WORDS = ["كل المحافظات", "الكل", "كله", "القايمه", "القائمه", "all", "list", "everything"];

export function wantsFullList(messageText: string): boolean {
  const n = norm(messageText);
  const tokens = tokenize(n);
  return ALL_LIST_WORDS.some((kw) => matchScore(kw, n, tokens) > 0);
}

export function replyFor(
  intent: string,
  arabic: boolean,
  script: BotScript = DEFAULT_SCRIPT,
  messageText?: string
): string {
  if (intent === "handoff") return arabic ? script.handoffAr : script.handoffEn;
  const cfg = script.intents[intent];
  const body =
    (messageText ? variantBody(intent, arabic, script, messageText) : null) ??
    (arabic ? cfg.ar : cfg.en);
  return body + (arabic ? script.footerAr : script.footerEn);
}

/** Tappable topic buttons: every intent with a menu digit and a title, plus the agent handoff. */
export function menuItems(script: BotScript, arabic: boolean): Array<{ title: string; value: string }> {
  const items: Array<{ title: string; value: string }> = [];
  for (const cfg of Object.values(script.intents)) {
    const title = arabic ? cfg.title_ar : cfg.title_en;
    if (cfg.menu && title) items.push({ title, value: cfg.menu });
  }
  items.push({ title: arabic ? HANDOFF_TITLE_AR : HANDOFF_TITLE_EN, value: "0" });
  return items;
}

// ── Business hours ───────────────────────────────────────────

export interface DayHours {
  start: number; // inclusive, 24h clock
  end: number;   // exclusive, 24h clock
}

export interface WorkingHours {
  timezone: string; // IANA name, e.g. "Africa/Cairo"
  /** lowercase 3-letter day → active hours; a day missing here is off. */
  schedule: Partial<Record<string, DayHours>>;
  /** Public holidays as YYYY-MM-DD — treated as full days off (bot active). */
  holidays?: Set<string>;
}

export function withinHours(cfg: WorkingHours, now: Date = new Date()): boolean {
  if (cfg.holidays?.size) {
    const dateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: cfg.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    if (cfg.holidays.has(dateStr)) return false;
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: cfg.timezone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const day = parts.find((p) => p.type === "weekday")?.value.toLowerCase() ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? -1);
  const range = cfg.schedule[day];
  return Boolean(range) && hour >= range!.start && hour < range!.end;
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
  /** Tag the conversation for morning triage (e.g. "after-hours"). */
  labelConversation: (conversationId: number) => Promise<void>;
  /** Remove the bot as assignee so the conversation shows as unassigned. */
  unassignConversation: (conversationId: number) => Promise<void>;
  /** The bot agent's Chatwoot id — used to recognise self-assignments. */
  getBotAgentId: () => Promise<number | null>;
  /** Send the tappable topic buttons (input_select). Optional feature. */
  sendMenu?: (conversationId: number, arabic: boolean) => Promise<void>;
  /** Agent-only private note (handoff context for the morning team). */
  sendPrivateNote?: (conversationId: number, content: string) => Promise<void>;
  /**
   * Write conversation custom attributes. The engine always passes the FULL
   * merged map (existing payload attributes + changes) so implementations
   * may safely replace the whole object.
   */
  setAttributes?: (conversationId: number, attributes: Record<string, unknown>) => Promise<void>;
  /** Save extracted contact details (phone/email/name) to the Chatwoot contact. */
  saveContact?: (contactId: number, fields: { name?: string; phone_number?: string; email?: string }) => Promise<void>;
  /** Analytics: record the routed intent (message text only for fallbacks). */
  recordEvent?: (conversationId: number, intent: string, message?: string) => Promise<void>;
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
  sender?: { type?: string; id?: number; name?: string; email?: string | null; phone_number?: string | null };
  attachments?: unknown[];
  conversation?: {
    id?: number;
    meta?: { assignee?: { id?: number } | null };
    custom_attributes?: Record<string, unknown>;
  };
  meta?: { assignee?: { id?: number } | null };
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

    const withinHours = ctx.afterHoursOnly && ctx.withinHours();

    // Greet once, when the conversation opens (and label it for triage)
    if (event === "conversation_created") {
      if (withinHours) return { status: 200, body: { ok: true, skipped: "working_hours" } };
      await ctx.labelConversation(convId);
      // Arabic-first greeting (with an English hint inside) — no bilingual
      // wall of text. English speakers get English from their first message.
      await ctx.send(convId, script.greetingAr);
      await ctx.sendMenu?.(convId, true);
      await ctx.recordEvent?.(convId, "greeting");
      return { status: 200, body: { ok: true } };
    }

    if (event !== "message_created") return { status: 200, body: { ok: true } };

    // Only react to the customer. Ignore our own messages or we loop
    // forever — and never touch conversations because an agent replied.
    if (data.message_type !== "incoming") return { status: 200, body: { ok: true } };
    if (data.sender?.type === "agent_bot") return { status: 200, body: { ok: true } };

    const assigneeId = data.conversation?.meta?.assignee?.id ?? data.meta?.assignee?.id;
    const attrs = { ...(data.conversation?.custom_attributes ?? {}) };
    const setAttrs = async (patch: Record<string, unknown>) => {
      Object.assign(attrs, patch);
      await ctx.setAttributes?.(convId, { ...attrs });
    };

    // Capture any contact details the customer shared — phone/email/name go
    // to the Chatwoot contact panel, the order number onto the conversation.
    // Runs regardless of working hours or assignment; only fills gaps and
    // logs field names, never values.
    const details = extractDetails(data.content ?? "");
    const senderId = data.sender?.id;
    if (senderId) {
      const fields: { name?: string; phone_number?: string; email?: string } = {};
      if (details.phone && !data.sender?.phone_number) fields.phone_number = details.phone;
      if (details.email && !data.sender?.email) fields.email = details.email;
      if (details.name) fields.name = details.name;
      if (Object.keys(fields).length) {
        await ctx.saveContact?.(senderId, fields);
        ctx.log(`conv=${convId} contact_saved=${Object.keys(fields).join(",")}`);
      }
    }
    if (details.orderNumber && attrs.order_number !== details.orderNumber) {
      await setAttrs({ order_number: details.orderNumber });
    }

    // During working hours, humans answer. Make sure the customer's message
    // sits in the open queue; if the bot itself still owns the conversation
    // (from an overnight chat), hand it back so agents see it. Unless a
    // human agent is already on the conversation, acknowledge the customer
    // once so they know they were heard.
    if (withinHours) {
      let humanAssigned = false;
      if (assigneeId) {
        const botId = await ctx.getBotAgentId();
        if (botId && assigneeId === botId) await ctx.unassignConversation(convId);
        else humanAssigned = true;
      }
      await ctx.openConversation(convId);
      if (!humanAssigned && !attrs.bot_acked && ctx.setAttributes) {
        const arabicMsg = isArabic(data.content ?? "") || !/[a-zA-Z]/.test(data.content ?? "");
        await ctx.send(convId, arabicMsg ? WORKING_HOURS_ACK_AR : WORKING_HOURS_ACK_EN);
        await setAttrs({ bot_acked: true });
      }
      ctx.log(`conv=${convId} skipped=working_hours`);
      return { status: 200, body: { ok: true, skipped: "working_hours" } };
    }

    // A human agent owns this conversation — the bot must not butt in.
    // (Self-assignments happen when Chatwoot credits the bot's own replies.)
    if (assigneeId) {
      const botId = await ctx.getBotAgentId();
      if (!botId || assigneeId !== botId) {
        ctx.log(`conv=${convId} skipped=assigned_to_agent assignee=${assigneeId} bot=${botId ?? "unknown"}`);
        return { status: 200, body: { ok: true, skipped: "assigned_to_agent" } };
      }
    }

    const text = data.content ?? "";
    const arabic = isArabic(text) || !/[a-zA-Z]/.test(text);

    // Every conversation the bot participates in gets the triage label
    // (idempotent — the label helper skips if already present).
    await ctx.labelConversation(convId);

    // A photo/file with no text is almost always proof of a damaged or
    // wrong item — acknowledge it and queue for the team.
    if (!norm(text) && data.attachments?.length) {
      ctx.log(`conv=${convId} intent=attachment`);
      await ctx.send(convId, ATTACHMENT_AR + "\n\n———\n" + ATTACHMENT_EN);
      await ctx.sendPrivateNote?.(convId, "🤖 Bot: customer sent an attachment (likely a damaged/wrong item photo) — needs review.");
      await ctx.unassignConversation(convId);
      await ctx.openConversation(convId);
      await ctx.recordEvent?.(convId, "attachment");
      return { status: 200, body: { ok: true, intent: "attachment" } };
    }

    const rawPending = data.conversation?.custom_attributes?.bot_pending;
    const pending = typeof rawPending === "string" && rawPending ? rawPending : null;
    const intent = route(text, script);

    // Follow-up flow: the bot previously asked a narrowing question (e.g.
    // "which governorate?") — try that topic's specific answers directly.
    if (intent === null && pending && script.intents[pending]) {
      const specific = variantBody(pending, arabic, script, text);
      if (specific) {
        ctx.log(`conv=${convId} intent=${pending}:variant`);
        await ctx.send(convId, specific + (arabic ? script.footerAr : script.footerEn));
        await setAttrs({ bot_pending: "" });
        await ctx.recordEvent?.(convId, pending);
        return { status: 200, body: { ok: true, intent: pending } };
      }
      if (wantsFullList(text)) {
        ctx.log(`conv=${convId} intent=${pending}:full`);
        const cfg = script.intents[pending];
        await ctx.send(convId, (arabic ? cfg.ar : cfg.en) + (arabic ? script.footerAr : script.footerEn));
        await setAttrs({ bot_pending: "" });
        await ctx.recordEvent?.(convId, pending);
        return { status: 200, body: { ok: true, intent: pending } };
      }
    }

    if (intent === null) {
      ctx.log(`conv=${convId} intent=fallback`);
      await ctx.send(convId, arabic ? script.fallbackAr : script.fallbackEn);
      await ctx.sendMenu?.(convId, arabic);
      // The fallback text promises the team will follow up — make it true:
      // put the conversation in the open queue for the morning.
      await ctx.openConversation(convId);
      if (pending) await setAttrs({ bot_pending: "" });
      await ctx.recordEvent?.(convId, "fallback", text);
      return { status: 200, body: { ok: true, intent: "fallback" } };
    }

    const cfg = script.intents[intent];

    // Ask-then-answer: a generic question on a topic with specific answers
    // (e.g. "how much is shipping?") gets a narrowing question instead of
    // the full list; the reply is matched against the variants above.
    if (
      cfg?.ask_ar &&
      cfg.ask_en &&
      cfg.variants &&
      ctx.setAttributes &&
      !variantBody(intent, arabic, script, text) &&
      !wantsFullList(text)
    ) {
      ctx.log(`conv=${convId} intent=${intent}:ask`);
      await ctx.send(convId, arabic ? cfg.ask_ar : cfg.ask_en);
      await setAttrs({ bot_pending: intent });
      await ctx.recordEvent?.(convId, intent);
      return { status: 200, body: { ok: true, intent, asked: true } };
    }

    ctx.log(`conv=${convId} intent=${intent}`);
    await ctx.send(convId, replyFor(intent, arabic, script, text));
    if (pending) await setAttrs({ bot_pending: "" });
    await ctx.recordEvent?.(convId, intent);
    // Handoff — and any intent flagged open (e.g. cancel) — goes to the
    // human queue: drop the bot's assignment so it shows as unassigned,
    // and set the status to open, with a private note for context.
    if (intent === "handoff" || cfg?.open) {
      const digits = text.match(/\d{3,}/)?.[0];
      await ctx.sendPrivateNote?.(
        convId,
        `🤖 Bot handoff • topic: ${intent}${digits ? ` • possible order number: ${digits}` : ""} — customer is waiting for the morning team.`
      );
      await ctx.unassignConversation(convId);
      await ctx.openConversation(convId);
    }
    return { status: 200, body: { ok: true, intent } };
  } catch (e) {
    // Log the error type only — never message content (PII).
    ctx.log(`webhook error: ${e instanceof Error ? e.message : "unknown"}`);
    return { status: 200, body: { ok: true, error: "handled" } };
  }
}
