// Chatwoot After-Hours Bot — configuration (env vars only, no secrets in code).
//
// CHATWOOT_URL          e.g. https://support-nmgdp.tech
// CHATWOOT_ACCOUNT_ID   e.g. 5
// CHATWOOT_BOT_TOKEN    the Agent Bot's access token
// WEBHOOK_TOKEN         random secret in the webhook URL (openssl rand -hex 16)
// AFTER_HOURS_ONLY      default true; "false" makes the bot reply 24/7
// WORK_TIMEZONE         default Africa/Cairo
// WORK_DAYS             default sun,mon,tue,wed,thu
// WORK_START            default 9   (inclusive, 24h clock)
// WORK_END              default 18  (exclusive, 24h clock)

import type { WorkingHours } from "./engine.ts";

export interface BotConfig {
  chatwootUrl: string;
  accountId: string;
  botToken: string | undefined;
  webhookToken: string | undefined;
  afterHoursOnly: boolean;
  hours: WorkingHours;
}

export function getBotConfig(): BotConfig {
  return {
    chatwootUrl: (process.env.CHATWOOT_URL ?? "https://support-nmgdp.tech").replace(/\/$/, ""),
    accountId: process.env.CHATWOOT_ACCOUNT_ID ?? "5",
    botToken: process.env.CHATWOOT_BOT_TOKEN,
    webhookToken: process.env.WEBHOOK_TOKEN,
    afterHoursOnly: (process.env.AFTER_HOURS_ONLY ?? "true").toLowerCase() !== "false",
    hours: {
      timezone: process.env.WORK_TIMEZONE ?? "Africa/Cairo",
      days: new Set(
        (process.env.WORK_DAYS ?? "sun,mon,tue,wed,thu")
          .split(",")
          .map((d) => d.trim().toLowerCase().slice(0, 3))
          .filter(Boolean)
      ),
      startHour: Number(process.env.WORK_START ?? 9),
      endHour: Number(process.env.WORK_END ?? 18),
    },
  };
}

export function isConfigured(cfg: BotConfig): boolean {
  return Boolean(cfg.botToken && cfg.webhookToken);
}
