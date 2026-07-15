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

/** Assign the conversation to an agent; 0 removes the assignee entirely. */
export async function assignConversation(cfg: BotConfig, conversationId: number, assigneeId: number): Promise<void> {
  const res = await fetch(`${api(cfg)}/conversations/${conversationId}/assignments`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify({ assignee_id: assigneeId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`chatwoot assignment failed: HTTP ${res.status}`);
}

/** Add a label without dropping existing ones (the POST replaces the list). */
export async function addLabel(cfg: BotConfig, conversationId: number, label: string): Promise<void> {
  const url = `${api(cfg)}/conversations/${conversationId}/labels`;
  let existing: string[] = [];
  try {
    const cur = await fetch(url, { headers: headers(cfg), signal: AbortSignal.timeout(10_000) });
    if (cur.ok) {
      const body = (await cur.json()) as { payload?: string[] };
      existing = body.payload ?? [];
    }
  } catch {
    // If reading fails we still try to set the label on its own.
  }
  if (existing.includes(label)) return;

  // Chatwoot silently drops labels that don't exist in the account, so
  // verify the response actually contains ours; if not, create the account
  // label and retry once.
  if (await postLabels(url, cfg, [...existing, label], label)) return;
  try {
    await fetch(`${api(cfg)}/labels`, {
      method: "POST",
      headers: headers(cfg),
      body: JSON.stringify({ title: label, color: "#F0B429", show_on_sidebar: true }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Creation may be forbidden for non-admin agents — the retry below tells us.
  }
  if (await postLabels(url, cfg, [...existing, label], label)) return;
  throw new Error(
    `label "${label}" was not applied — create it manually in Chatwoot (Settings → Labels)`
  );
}

async function postLabels(url: string, cfg: BotConfig, labels: string[], mustInclude: string): Promise<boolean> {
  const res = await fetch(url, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify({ labels }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`chatwoot labels failed: HTTP ${res.status}`);
  const body = (await res.json()) as { payload?: string[] };
  return (body.payload ?? []).includes(mustInclude);
}

/** Tappable topic buttons (Chatwoot input_select interactive message). */
export async function sendMenuButtons(
  cfg: BotConfig,
  conversationId: number,
  prompt: string,
  items: Array<{ title: string; value: string }>
): Promise<void> {
  const res = await fetch(`${api(cfg)}/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify({
      content: prompt,
      content_type: "input_select",
      content_attributes: { items },
      message_type: "outgoing",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`chatwoot menu failed: HTTP ${res.status}`);
}

/** Agent-only private note — customers never see these. */
export async function sendPrivateNote(cfg: BotConfig, conversationId: number, content: string): Promise<void> {
  const res = await fetch(`${api(cfg)}/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify({ content, message_type: "outgoing", private: true }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`chatwoot note failed: HTTP ${res.status}`);
}

/** Stores tiny bits of bot state (e.g. the pending topic) on the conversation. */
export async function setConversationAttributes(
  cfg: BotConfig,
  conversationId: number,
  attributes: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`${api(cfg)}/conversations/${conversationId}/custom_attributes`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify({ custom_attributes: attributes }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`chatwoot attributes failed: HTTP ${res.status}`);
}

/** The bot agent's own profile — used to recognise self-assigned conversations. */
export async function getProfile(cfg: BotConfig): Promise<{ id: number; name?: string; email?: string } | null> {
  const res = await fetch(`${cfg.chatwootUrl}/api/v1/profile`, {
    headers: headers(cfg),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return (await res.json()) as { id: number; name?: string; email?: string };
}
