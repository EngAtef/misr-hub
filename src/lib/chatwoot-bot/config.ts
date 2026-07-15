// Chatwoot After-Hours Bot — configuration.
//
// Primary source: Settings → Chatwoot Bot in the app (app_settings keys
// "chatwoot_bot" + "chatwoot_bot_script"), read by the webhook through the
// token-gated SECURITY DEFINER function fn_chatwoot_bot_config — no service
// role key needed. Env vars remain as a fallback for the original setup:
//
// CHATWOOT_URL          e.g. https://support.nmgdp.tech
// CHATWOOT_ACCOUNT_ID   e.g. 5
// CHATWOOT_BOT_TOKEN    the bot agent's access token
// WEBHOOK_TOKEN         random secret in the webhook URL
// AFTER_HOURS_ONLY      default true; "false" makes the bot reply 24/7
// WORK_TIMEZONE         default Africa/Cairo
// WORK_DAYS             default sun,mon,tue,wed,thu
// WORK_START            default 9   (inclusive, 24h clock)
// WORK_END              default 18  (exclusive, 24h clock)

import { createClient } from "@supabase/supabase-js";
import { mergeScript, type BotScript, type ScriptOverrides, type WorkingHours } from "./engine.ts";

export interface BotConfig {
  enabled: boolean;
  chatwootUrl: string;
  accountId: string;
  botToken: string | undefined;
  webhookToken: string | undefined;
  afterHoursOnly: boolean;
  hours: WorkingHours;
  script: BotScript;
  source: "app_settings" | "env";
}

/** Settings JSON stored in app_settings key "chatwoot_bot". */
interface StoredBotSettings {
  enabled?: boolean;
  chatwoot_url?: string;
  account_id?: string;
  bot_token?: string;
  webhook_token?: string;
  after_hours_only?: boolean;
  work_timezone?: string;
  work_days?: string;
  work_start?: number | string;
  work_end?: number | string;
}

function parseDays(csv: string): Set<string> {
  return new Set(
    csv
      .split(",")
      .map((d) => d.trim().toLowerCase().slice(0, 3))
      .filter(Boolean)
  );
}

function hoursFrom(timezone?: string, days?: string, start?: number | string, end?: number | string): WorkingHours {
  return {
    timezone: timezone || "Africa/Cairo",
    days: parseDays(days || "sun,mon,tue,wed,thu"),
    startHour: Number(start ?? 9),
    endHour: Number(end ?? 18),
  };
}

export function getEnvBotConfig(): BotConfig {
  return {
    enabled: true,
    chatwootUrl: (process.env.CHATWOOT_URL ?? "https://support.nmgdp.tech").replace(/\/$/, ""),
    accountId: process.env.CHATWOOT_ACCOUNT_ID ?? "5",
    botToken: process.env.CHATWOOT_BOT_TOKEN,
    webhookToken: process.env.WEBHOOK_TOKEN,
    afterHoursOnly: (process.env.AFTER_HOURS_ONLY ?? "true").toLowerCase() !== "false",
    hours: hoursFrom(
      process.env.WORK_TIMEZONE,
      process.env.WORK_DAYS,
      process.env.WORK_START,
      process.env.WORK_END
    ),
    script: mergeScript(null),
    source: "env",
  };
}

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Resolve the bot config for an incoming webhook call. Tries the in-app
 * settings first (token-gated RPC — returns data only when the URL token
 * matches the stored webhook_token); falls back to env vars. Returns null
 * when neither source is configured.
 */
export async function resolveBotConfig(token: string): Promise<BotConfig | null> {
  try {
    const { data, error } = await anonClient().rpc("fn_chatwoot_bot_config", { p_token: token });
    if (!error && data && typeof data === "object" && (data as { config?: unknown }).config) {
      const stored = (data as { config: StoredBotSettings }).config;
      const overrides = (data as { script?: ScriptOverrides }).script;
      if (stored.bot_token && stored.webhook_token) {
        return {
          enabled: stored.enabled !== false,
          chatwootUrl: (stored.chatwoot_url || "https://support.nmgdp.tech").replace(/\/$/, ""),
          accountId: String(stored.account_id || "5"),
          botToken: stored.bot_token,
          webhookToken: stored.webhook_token,
          afterHoursOnly: stored.after_hours_only !== false,
          hours: hoursFrom(stored.work_timezone, stored.work_days, stored.work_start, stored.work_end),
          script: mergeScript(overrides),
          source: "app_settings",
        };
      }
    }
  } catch {
    // DB unreachable — fall through to env config.
  }
  const env = getEnvBotConfig();
  return isConfigured(env) ? env : null;
}

/** Non-secret health info: prefers in-app settings, falls back to env. */
export async function getBotHealth(): Promise<{
  configured: boolean;
  enabled: boolean;
  afterHoursOnly: boolean;
  hours: WorkingHours;
  source: "app_settings" | "env";
}> {
  try {
    const { data, error } = await anonClient().rpc("fn_chatwoot_bot_health");
    if (!error && data && typeof data === "object" && (data as { configured?: boolean }).configured !== undefined) {
      const h = data as {
        configured: boolean;
        enabled: boolean;
        after_hours_only: boolean;
        work_timezone: string;
        work_days: string;
        work_start: number;
        work_end: number;
      };
      if (h.configured) {
        return {
          configured: true,
          enabled: h.enabled,
          afterHoursOnly: h.after_hours_only,
          hours: hoursFrom(h.work_timezone, h.work_days, h.work_start, h.work_end),
          source: "app_settings",
        };
      }
    }
  } catch {
    // fall through
  }
  const env = getEnvBotConfig();
  return {
    configured: isConfigured(env),
    enabled: true,
    afterHoursOnly: env.afterHoursOnly,
    hours: env.hours,
    source: "env",
  };
}

export function isConfigured(cfg: BotConfig): boolean {
  return Boolean(cfg.botToken && cfg.webhookToken);
}
