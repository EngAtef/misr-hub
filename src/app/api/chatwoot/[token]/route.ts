import { NextRequest, NextResponse } from "next/server";
import { handleWebhook, withinHours, menuItems } from "@/lib/chatwoot-bot/engine";
import { MENU_PROMPT_AR, MENU_PROMPT_EN } from "@/lib/chatwoot-bot/script";
import { resolveBotConfig, logBotEvent } from "@/lib/chatwoot-bot/config";
import {
  sendMessage,
  openConversation,
  assignConversation,
  addLabel,
  getProfile,
  sendMenuButtons,
  sendPrivateNote,
  setConversationAttributes,
} from "@/lib/chatwoot-bot/chatwoot";

export const maxDuration = 30;

// Chatwoot webhook — the after-hours support bot.
// Scripted replies only: no AI, no order lookups, no invented numbers.
// Config + reply script come from Settings → Chatwoot Bot in the app
// (env vars as fallback). The URL path token is the shared secret.
// PII rule: log conversation ids and intent names only — never message
// content, phone numbers, or names.

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const cfg = await resolveBotConfig(token);

  if (!cfg) {
    // Neither in-app settings nor env vars are set. 503 (not 200) so
    // misconfiguration is visible in Chatwoot's webhook logs.
    return NextResponse.json({ error: "bot not configured" }, { status: 503 });
  }

  if (token === cfg.webhookToken && !cfg.enabled) {
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }

  let payload: unknown = {};
  try {
    payload = await request.json();
  } catch {
    // Not JSON — treat as an empty event; handler returns 200 below.
  }

  const log = (message: string) => console.log(`[chatwoot-bot] ${message}`);

  const result = await handleWebhook(token, payload, {
    webhookToken: cfg.webhookToken,
    afterHoursOnly: cfg.afterHoursOnly,
    withinHours: () => withinHours(cfg.hours),
    script: cfg.script,
    // Chatwoot API failures are logged but never fail the webhook —
    // Chatwoot retries on non-200 and we don't want duplicate replies.
    send: async (convId, content) => {
      try {
        await sendMessage(cfg, convId, content);
      } catch (e) {
        log(`send failed conv=${convId}: ${e instanceof Error ? e.message : "unknown"}`);
      }
    },
    openConversation: async (convId) => {
      try {
        await openConversation(cfg, convId);
      } catch (e) {
        log(`open failed conv=${convId}: ${e instanceof Error ? e.message : "unknown"}`);
      }
    },
    labelConversation: async (convId) => {
      try {
        await addLabel(cfg, convId, cfg.label);
      } catch (e) {
        log(`label failed conv=${convId}: ${e instanceof Error ? e.message : "unknown"}`);
      }
    },
    unassignConversation: async (convId) => {
      try {
        await assignConversation(cfg, convId, 0);
      } catch (e) {
        log(`unassign failed conv=${convId}: ${e instanceof Error ? e.message : "unknown"}`);
      }
    },
    getBotAgentId: async () => {
      if (cfg.botAgentId) return cfg.botAgentId;
      try {
        return (await getProfile(cfg))?.id ?? null;
      } catch {
        return null;
      }
    },
    sendMenu: cfg.menuButtons
      ? async (convId, arabic) => {
          try {
            await sendMenuButtons(cfg, convId, arabic ? MENU_PROMPT_AR : MENU_PROMPT_EN, menuItems(cfg.script, arabic));
          } catch (e) {
            log(`menu failed conv=${convId}: ${e instanceof Error ? e.message : "unknown"}`);
          }
        }
      : undefined,
    sendPrivateNote: async (convId, content) => {
      try {
        await sendPrivateNote(cfg, convId, content);
      } catch (e) {
        log(`note failed conv=${convId}: ${e instanceof Error ? e.message : "unknown"}`);
      }
    },
    setPendingTopic: async (convId, topic) => {
      try {
        await setConversationAttributes(cfg, convId, { bot_pending: topic ?? "" });
      } catch (e) {
        log(`pending failed conv=${convId}: ${e instanceof Error ? e.message : "unknown"}`);
      }
    },
    recordEvent: (convId, intent, message) => logBotEvent(token, convId, intent, message),
    log,
  });

  return NextResponse.json(result.body, { status: result.status });
}
