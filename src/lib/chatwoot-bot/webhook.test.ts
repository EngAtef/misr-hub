// Behavioural tests for the webhook handler: auth, loop protection,
// business-hours gate, handoff, and error containment.

import { test } from "node:test";
import assert from "node:assert/strict";
import { handleWebhook, mergeScript, type WebhookContext } from "./engine.ts";
import { GREETING_AR, HANDOFF_EN } from "./script.ts";

interface Recorded {
  sent: Array<{ convId: number; content: string }>;
  opened: number[];
  labeled: number[];
  unassigned: number[];
  menus: number[];
  notes: string[];
  attrs: Array<Record<string, unknown>>;
  contacts: Array<{ id: number; fields: Record<string, unknown> }>;
  events: Array<{ intent: string; message?: string }>;
  logs: string[];
}

function makeCtx(overrides: Partial<WebhookContext> = {}): { ctx: WebhookContext; rec: Recorded } {
  const rec: Recorded = {
    sent: [], opened: [], labeled: [], unassigned: [],
    menus: [], notes: [], attrs: [], contacts: [], events: [], logs: [],
  };
  const ctx: WebhookContext = {
    webhookToken: "secret-token",
    afterHoursOnly: true,
    withinHours: () => false, // default: after hours, bot active
    send: async (convId, content) => {
      rec.sent.push({ convId, content });
    },
    openConversation: async (convId) => {
      rec.opened.push(convId);
    },
    labelConversation: async (convId) => {
      rec.labeled.push(convId);
    },
    unassignConversation: async (convId) => {
      rec.unassigned.push(convId);
    },
    getBotAgentId: async () => 55, // the bot's own agent id in these tests
    sendMenu: async (convId) => {
      rec.menus.push(convId);
    },
    sendPrivateNote: async (_convId, content) => {
      rec.notes.push(content);
    },
    setAttributes: async (_convId, attributes) => {
      rec.attrs.push(attributes);
    },
    saveContact: async (id, fields) => {
      rec.contacts.push({ id, fields });
    },
    recordEvent: async (_convId, intent, message) => {
      rec.events.push({ intent, message });
    },
    log: (m) => rec.logs.push(m),
    ...overrides,
  };
  return { ctx, rec };
}

const incoming = (content: string) => ({
  event: "message_created",
  message_type: "incoming",
  content,
  conversation: { id: 42 },
});

test("wrong webhook token -> 403, nothing sent", async () => {
  const { ctx, rec } = makeCtx();
  const res = await handleWebhook("wrong", incoming("1"), ctx);
  assert.equal(res.status, 403);
  assert.equal(rec.sent.length, 0);
});

test("missing configured token -> 403 even if caller token matches empty", async () => {
  const { ctx } = makeCtx({ webhookToken: undefined });
  const res = await handleWebhook("", incoming("1"), ctx);
  assert.equal(res.status, 403);
});

test("outgoing message -> no reply (loop protection)", async () => {
  const { ctx, rec } = makeCtx();
  const res = await handleWebhook(
    "secret-token",
    { ...incoming("hello"), message_type: "outgoing" },
    ctx
  );
  assert.equal(res.status, 200);
  assert.equal(rec.sent.length, 0);
});

test("agent_bot sender -> no reply (loop protection)", async () => {
  const { ctx, rec } = makeCtx();
  const res = await handleWebhook(
    "secret-token",
    { ...incoming("hello"), sender: { type: "agent_bot" } },
    ctx
  );
  assert.equal(res.status, 200);
  assert.equal(rec.sent.length, 0);
});

test("within working hours: pending conversation is opened once, then handed to humans", async () => {
  const { ctx, rec } = makeCtx({ withinHours: () => true });
  const payload = {
    ...incoming("كام الشحن؟"),
    conversation: { id: 42, status: "pending" },
  };
  const res = await handleWebhook("secret-token", payload, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.body.skipped, "working_hours");
  assert.equal(rec.sent.length, 0); // fully silent — the team replies
  assert.deepEqual(rec.opened, [42]);
  // toggle_status self-assigns the bot — must be cleared right away.
  assert.deepEqual(rec.unassigned, [42]);
});

test("within hours: open unassigned conversation is not touched at all (no churn)", async () => {
  const { ctx, rec } = makeCtx({ withinHours: () => true });
  const payload = {
    ...incoming("طيب هستني"),
    conversation: { id: 42, status: "open" },
  };
  const res = await handleWebhook("secret-token", payload, ctx);
  assert.equal(res.body.skipped, "working_hours");
  assert.equal(rec.sent.length, 0);
  assert.deepEqual(rec.opened, []);     // already open — no toggle_status
  assert.deepEqual(rec.unassigned, []); // nothing to hand back — no timeline noise
});

test("within hours: bot-owned open conversation is unassigned once, not reopened", async () => {
  const { ctx, rec } = makeCtx({ withinHours: () => true });
  const payload = {
    ...incoming("السلام عليكم"),
    conversation: { id: 42, status: "open", meta: { assignee: { id: 55 } } }, // assigned to the bot itself
  };
  const res = await handleWebhook("secret-token", payload, ctx);
  assert.equal(res.body.skipped, "working_hours");
  assert.equal(rec.sent.length, 0); // silent even while handing back
  assert.deepEqual(rec.unassigned, [42]); // handed back so agents see it
  assert.deepEqual(rec.opened, []); // already open — reopening would re-self-assign the bot
});

test("within hours: a human agent's conversation is never unassigned", async () => {
  const { ctx, rec } = makeCtx({ withinHours: () => true });
  const payload = {
    ...incoming("سؤال تاني"),
    conversation: { id: 42, meta: { assignee: { id: 77 } } }, // human agent
  };
  await handleWebhook("secret-token", payload, ctx);
  assert.deepEqual(rec.unassigned, []);
  assert.deepEqual(rec.opened, [42]);
  assert.equal(rec.sent.length, 0); // agent is chatting — bot fully silent
});

test("after hours: customer returning to a bot-owned resolved conversation gets replies", async () => {
  const { ctx, rec } = makeCtx();
  const payload = {
    ...incoming("السلام عليكم"),
    conversation: { id: 42, meta: { assignee: { id: 55 } } },
  };
  const res = await handleWebhook("secret-token", payload, ctx);
  assert.equal(res.body.intent, "greet");
  assert.equal(rec.sent.length, 1);
});

test("AFTER_HOURS_ONLY=false -> replies even within working hours", async () => {
  const { ctx, rec } = makeCtx({ afterHoursOnly: false, withinHours: () => true });
  await handleWebhook("secret-token", incoming("1"), ctx);
  assert.equal(rec.sent.length, 1);
});

test("conversation_created -> bilingual greeting", async () => {
  const { ctx, rec } = makeCtx();
  const res = await handleWebhook(
    "secret-token",
    { event: "conversation_created", id: 7 },
    ctx
  );
  assert.equal(res.status, 200);
  assert.equal(rec.sent.length, 1);
  assert.equal(rec.sent[0].convId, 7);
  assert.ok(rec.sent[0].content.startsWith(GREETING_AR));
});

test("unknown event -> 200, nothing sent", async () => {
  const { ctx, rec } = makeCtx();
  const res = await handleWebhook(
    "secret-token",
    { event: "conversation_updated", conversation: { id: 9 } },
    ctx
  );
  assert.equal(res.status, 200);
  assert.equal(rec.sent.length, 0);
});

test("handoff intent -> handoff message + conversation opened", async () => {
  const { ctx, rec } = makeCtx();
  const res = await handleWebhook("secret-token", incoming("I want to speak to a human"), ctx);
  assert.equal(res.body.intent, "handoff");
  assert.equal(rec.sent[0].content, HANDOFF_EN);
  assert.deepEqual(rec.opened, [42]);
});

test("English message gets English reply; Arabic gets Arabic", async () => {
  const { ctx, rec } = makeCtx();
  await handleWebhook("secret-token", incoming("how much is shipping to Aswan?"), ctx);
  await handleWebhook("secret-token", incoming("كام سعر الشحن للاسكندرية؟"), ctx);
  assert.ok(rec.sent[0].content.includes("Upper Egypt")); // variant answer, in English
  assert.ok(rec.sent[1].content.includes("99.83")); // Alexandria variant, in Arabic
  assert.ok(rec.sent[1].content.includes("سكندرية"));
});

test("every replied conversation gets the triage label (fallback included)", async () => {
  const { ctx, rec } = makeCtx();
  await handleWebhook("secret-token", incoming("asdkjhasd"), ctx);
  await handleWebhook("secret-token", incoming("1"), ctx);
  assert.deepEqual(rec.labeled, [42, 42]);
});

test("gibberish -> fallback, no guessed intent, and the team really gets it", async () => {
  const { ctx, rec } = makeCtx();
  const res = await handleWebhook("secret-token", incoming("asdkjhasd"), ctx);
  assert.equal(res.body.intent, "fallback");
  assert.equal(rec.sent.length, 1);
  assert.deepEqual(rec.opened, [42]); // fallback promises follow-up → queue it
});

test("specific-book availability question gets the search-and-confirm answer", async () => {
  const { ctx, rec } = makeCtx();
  // Real customer message from the fallback inbox.
  const res = await handleWebhook("secret-token", incoming("لو سمحت عايزه اطلب الخمس اجزاء من سلسله ليمون ونعناع"), ctx);
  assert.equal(res.body.intent, "categories");
  assert.ok(rec.sent[0].content.includes("nahdetmisrbookstore.com"));
  assert.ok(rec.sent[0].content.includes("أتأكد من التوفر"));
});

test("delivery time is quoted as 1-7 days depending on governorate", async () => {
  const { ctx, rec } = makeCtx();
  await handleWebhook("secret-token", incoming("كام الشحن للجيزه؟"), ctx);
  assert.ok(rec.sent[0].content.includes("7 أيام عمل"));
  assert.ok(!rec.sent[0].content.includes("3 أيام"));
});

test("Chatwoot API error -> logged, still returns 200", async () => {
  const { ctx, rec } = makeCtx({
    send: async () => {
      throw new Error("HTTP 500");
    },
  });
  const res = await handleWebhook("secret-token", incoming("1"), ctx);
  assert.equal(res.status, 200);
  assert.ok(rec.logs.some((l) => l.includes("HTTP 500") || l.includes("error")));
});

test("malformed payload -> 200, nothing sent", async () => {
  const { ctx, rec } = makeCtx();
  for (const payload of [null, {}, { event: "message_created" }, "junk"]) {
    const res = await handleWebhook("secret-token", payload, ctx);
    assert.equal(res.status, 200);
  }
  assert.equal(rec.sent.length, 0);
});

test("cancel intent replies, labels, unassigns, and opens the conversation", async () => {
  const { ctx, rec } = makeCtx();
  const res = await handleWebhook("secret-token", incoming("عايزه الغي"), ctx);
  assert.equal(res.body.intent, "cancel");
  assert.equal(rec.sent.length, 1);
  assert.deepEqual(rec.opened, [42]);
  assert.deepEqual(rec.labeled, [42]);
  assert.deepEqual(rec.unassigned, [42]);
});

test("handoff labels and unassigns so the conversation shows in the unassigned queue", async () => {
  const { ctx, rec } = makeCtx();
  await handleWebhook("secret-token", incoming("عايز أكلم موظف"), ctx);
  assert.deepEqual(rec.opened, [42]);
  assert.deepEqual(rec.labeled, [42]);
  assert.deepEqual(rec.unassigned, [42]);
});

test("greeting labels the conversation for morning triage", async () => {
  const { ctx, rec } = makeCtx();
  await handleWebhook("secret-token", { event: "conversation_created", id: 7 }, ctx);
  assert.deepEqual(rec.labeled, [7]);
});

test("conversation assigned to a human agent -> bot stays silent", async () => {
  const { ctx, rec } = makeCtx();
  const payload = {
    ...incoming("كام الشحن؟"),
    conversation: { id: 42, meta: { assignee: { id: 77 } } }, // human agent 77
  };
  const res = await handleWebhook("secret-token", payload, ctx);
  assert.equal(res.body.skipped, "assigned_to_agent");
  assert.equal(rec.sent.length, 0);
});

test("conversation self-assigned to the bot -> bot keeps replying", async () => {
  const { ctx, rec } = makeCtx();
  const payload = {
    ...incoming("كام الشحن؟"),
    conversation: { id: 42, meta: { assignee: { id: 55 } } }, // the bot itself
  };
  const res = await handleWebhook("secret-token", payload, ctx);
  assert.equal(res.body.intent, "shipping");
  assert.equal(rec.sent.length, 1);
});

test("agent's outgoing message during working hours is not touched at all", async () => {
  const { ctx, rec } = makeCtx({ withinHours: () => true });
  const res = await handleWebhook(
    "secret-token",
    { ...incoming("reply to customer"), message_type: "outgoing" },
    ctx
  );
  assert.equal(res.status, 200);
  assert.equal(rec.sent.length, 0);
  assert.equal(rec.opened.length, 0); // must NOT reopen agents' conversations
});

test("custom script from settings is used for greeting and replies", async () => {
  const script = mergeScript({
    greeting_ar: "أهلا مخصص",
    greeting_en: "Custom hello",
    intents: { hours: { en: "Custom hours answer" } },
  });
  const { ctx, rec } = makeCtx({ script });
  await handleWebhook("secret-token", { event: "conversation_created", id: 3 }, ctx);
  assert.ok(rec.sent[0].content.startsWith("أهلا مخصص"));
  await handleWebhook("secret-token", incoming("what are your working hours"), ctx);
  assert.ok(rec.sent[1].content.startsWith("Custom hours answer"));
});

test("photo with no text gets the attachment reply and reaches the team", async () => {
  const { ctx, rec } = makeCtx();
  const res = await handleWebhook(
    "secret-token",
    { event: "message_created", message_type: "incoming", content: "", attachments: [{}], conversation: { id: 42 } },
    ctx
  );
  assert.equal(res.body.intent, "attachment");
  assert.ok(rec.sent[0].content.includes("📷"));
  assert.deepEqual(rec.opened, [42]);
  assert.deepEqual(rec.unassigned, [42]);
  assert.equal(rec.notes.length, 1);
});

test("generic shipping question triggers ask-then-answer flow", async () => {
  const { ctx, rec } = makeCtx();
  const res = await handleWebhook("secret-token", incoming("how much is shipping?"), ctx);
  assert.equal(res.body.asked, true);
  assert.ok(rec.sent[0].content.includes("Which governorate"));
  assert.equal(rec.attrs.at(-1)?.bot_pending, "shipping"); // topic remembered
});

test("pending topic: a bare governorate reply gets the specific rate", async () => {
  const { ctx, rec } = makeCtx();
  const payload = {
    ...incoming("Giza"),
    conversation: { id: 42, custom_attributes: { bot_pending: "shipping" } },
  };
  const res = await handleWebhook("secret-token", payload, ctx);
  assert.equal(res.body.intent, "shipping");
  assert.ok(rec.sent[0].content.includes("85.56"));
  assert.equal(rec.attrs.at(-1)?.bot_pending, ""); // cleared
});

test("pending topic: asking for the full list sends the generic answer", async () => {
  const { ctx, rec } = makeCtx();
  const payload = {
    ...incoming("all"),
    conversation: { id: 42, custom_attributes: { bot_pending: "shipping" } },
  };
  await handleWebhook("secret-token", payload, ctx);
  assert.ok(rec.sent[0].content.includes("199.64")); // full list includes Sinai
  assert.equal(rec.attrs.at(-1)?.bot_pending, "");
});

test("customer details are saved to the contact panel and conversation", async () => {
  const { ctx, rec } = makeCtx();
  const payload = {
    ...incoming("انا اسمي محمد عاطف ورقمي ٠١٠١٢٣٤٥٦٧٨ ورقم الطلب 22002"),
    sender: { id: 9, name: "Fragrant-Frost-773", email: null, phone_number: null },
  };
  await handleWebhook("secret-token", payload, ctx);
  assert.equal(rec.contacts.length, 1);
  assert.equal(rec.contacts[0].id, 9);
  assert.equal(rec.contacts[0].fields.phone_number, "+201012345678");
  assert.equal(rec.contacts[0].fields.name, "محمد عاطف");
  assert.equal(rec.attrs.at(-1)?.order_number, "22002");
});

test("existing contact phone is never overwritten", async () => {
  const { ctx, rec } = makeCtx();
  const payload = {
    ...incoming("رقمي 01012345678"),
    sender: { id: 9, phone_number: "+201000000000", email: null },
  };
  await handleWebhook("secret-token", payload, ctx);
  assert.equal(rec.contacts.length, 0);
});

test("attribute writes merge — order number does not wipe bot_pending", async () => {
  const { ctx, rec } = makeCtx();
  const payload = {
    ...incoming("Giza 22002"),
    conversation: { id: 42, custom_attributes: { bot_pending: "shipping" } },
  };
  await handleWebhook("secret-token", payload, ctx);
  const orderWrite = rec.attrs.find((a) => a.order_number === "22002");
  assert.ok(orderWrite, "order number recorded");
  assert.equal(orderWrite!.bot_pending, "shipping", "existing attributes preserved in the write");
});

test("menu buttons are sent with greeting and fallback", async () => {
  const { ctx, rec } = makeCtx();
  await handleWebhook("secret-token", { event: "conversation_created", id: 7 }, ctx);
  await handleWebhook("secret-token", incoming("asdkjhasd"), ctx);
  assert.deepEqual(rec.menus, [7, 42]);
});

test("analytics: fallback records the message text, other intents do not", async () => {
  const { ctx, rec } = makeCtx();
  await handleWebhook("secret-token", incoming("asdkjhasd"), ctx);
  await handleWebhook("secret-token", incoming("عايز أكلم موظف"), ctx);
  assert.deepEqual(rec.events[0], { intent: "fallback", message: "asdkjhasd" });
  assert.equal(rec.events[1].intent, "handoff");
  assert.equal(rec.events[1].message, undefined);
});

test("handoff private note includes the detected order number", async () => {
  const { ctx, rec } = makeCtx();
  await handleWebhook("secret-token", incoming("عايز الغي الاوردر رقم 4522"), ctx);
  assert.equal(rec.notes.length, 1);
  assert.ok(rec.notes[0].includes("4522"));
  assert.ok(rec.notes[0].includes("cancel"));
});

test("logs never contain message content (PII rule)", async () => {
  const { ctx, rec } = makeCtx();
  const secretText = "انا محمد رقمي 01000000000 عايز اكلم موظف";
  await handleWebhook("secret-token", incoming(secretText), ctx);
  for (const line of rec.logs) {
    assert.ok(!line.includes("محمد"), "log line leaked a name");
    assert.ok(!line.includes("01000000000"), "log line leaked a phone number");
  }
});
