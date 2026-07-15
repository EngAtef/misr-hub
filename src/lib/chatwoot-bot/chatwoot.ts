// Chatwoot API calls used by the bot. Built-in fetch — no HTTP client dependency.

import type { BotConfig } from "./config.ts";

function api(cfg: BotConfig): string {
  return `${cfg.chatwootUrl}/api/v1/accounts/${cfg.accountId}`;
}

function headers(cfg: BotConfig): Record<string, string> {
  return { api_access_token: cfg.botToken ?? "", "Content-Type": "application/json" };
}

/** Post a bot reply to the conversation. Throws on failure (caller logs). */
export async function sendMessage(cfg: BotConfig, conversationId: number, content: string): Promise<void> {
  const res = await fetch(`${api(cfg)}/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify({ content, message_type: "outgoing" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`chatwoot send failed: HTTP ${res.status}`);
}

/** Move the conversation to the human queue. Throws on failure (caller logs). */
export async function openConversation(cfg: BotConfig, conversationId: number): Promise<void> {
  const res = await fetch(`${api(cfg)}/conversations/${conversationId}/toggle_status`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify({ status: "open" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`chatwoot toggle_status failed: HTTP ${res.status}`);
}
