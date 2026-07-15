// Routing acceptance tests — the table from the project brief.
// Run: npm run test:bot   (Node's built-in runner, no dependencies)

import { test } from "node:test";
import assert from "node:assert/strict";
import { route, norm, tokenize, withinHours, replyFor, MIN_SCORE } from "./engine.ts";
import { HANDOFF_AR, FOOTER_AR, INTENTS } from "./script.ts";

// [input, expected intent] — null means fallback ("I don't understand").
const CASES: Array<[string, string | null]> = [
  // Menu digits
  ["1", "shipping"],
  ["3", "returns"],
  ["7", "bulk"],
  ["0", "handoff"],
  // Shipping (Arabic)
  ["كام سعر الشحن للاسكندرية؟", "shipping"],
  ["الشحن مجاني للقليوبية؟", "shipping"],
  ["انا في المنصورة كام التوصيل", "shipping"],
  ["كام الشحن لمرسى مطروح", "shipping"],
  ["بالشحن كام؟", "shipping"], // the "ال/بال" prefix bug
  // Payment
  ["هل تقبلوا فودافون كاش؟", "payment"],
  ["أقدر أقسط؟", "payment"], // the "؟ inside the Arabic block" bug
  ["التقسيط متاح؟", "payment"],
  ["عايز أدفع بالفيزا", "payment"],
  ["الدفع عند الاستلام متاح؟", "payment"],
  // Returns
  ["عايز أستبدل كتاب", "returns"],
  ["الكتاب وصل تالف", "returns"],
  ["عايز أرجع الكتاب وأخد فلوسي", "returns"],
  // Tracking
  ["فين طلبي رقم 12345", "track"],
  ["امتي يوصل الاوردر بتاعي", "track"],
  // Categories
  ["عندكم كتب فرنسية؟", "categories"],
  ["عايز كتاب لطفل عنده 5 سنين", "categories"],
  ["عندكم كوميكس مارفل؟", "categories"],
  // Hours & contact
  ["إيه مواعيد العمل؟", "hours"],
  ["رقم التليفون بتاعكم كام", "hours"],
  // Bulk
  ["عايز أطلب 200 نسخة لمدرسة", "bulk"],
  ["فيه خصم للجملة؟", "bulk"],
  // Handoff
  ["عايز أكلم موظف", "handoff"],
  ["عايز أكلّم حد مسؤول", "handoff"],
  ["عندي شكوى", "handoff"],
  // English
  ["How much is shipping to Aswan?", "shipping"],
  ["I want to speak to a human", "handoff"],
  ["do you accept cash on delivery", "payment"], // must beat shipping on "delivery"
  ["what are your working hours", "hours"],
  ["how do I return a book", "returns"],
  // Must fall back — never guess
  ["إيه أحسن مطعم في القاهرة؟", null], // the سن/أحسن substring trap
  ["ما هي عاصمة فرنسا", null],
  ["مرحبا", null],
  ["asdkjhasd", null],
];

for (const [input, expected] of CASES) {
  test(`route(${JSON.stringify(input)}) -> ${expected ?? "fallback"}`, () => {
    assert.equal(route(input), expected);
  });
}

test("normalisation: hamza forms, taa marbuta, tashkeel", () => {
  assert.equal(norm("أُقَسِّط؟"), "اقسط");
  assert.equal(norm("الإسكندرية"), "الاسكندريه");
});

test("tokeniser emits prefix-stripped variants", () => {
  const tokens = tokenize(norm("بالشحن للجملة والكتاب"));
  assert.ok(tokens.has("شحن"));
  assert.ok(tokens.has("جمله"));
  assert.ok(tokens.has("كتاب"));
});

test("Arabic-Indic menu digit works", () => {
  assert.equal(route("١"), "shipping");
  assert.equal(route("٠"), "handoff");
});

test("MIN_SCORE guards weak matches", () => {
  assert.ok(MIN_SCORE >= 3);
});

test("intent replies carry the footer; handoff does not", () => {
  assert.ok(replyFor("shipping", true).endsWith(FOOTER_AR));
  assert.equal(replyFor("handoff", true), HANDOFF_AR);
});

test("every intent has a unique menu digit and both languages", () => {
  const digits = new Set<string>();
  for (const [key, cfg] of Object.entries(INTENTS)) {
    assert.ok(cfg.menu && !digits.has(cfg.menu), `duplicate menu digit on ${key}`);
    digits.add(cfg.menu);
    assert.ok(cfg.ar.length > 0 && cfg.en.length > 0, `missing reply text on ${key}`);
  }
});

test("withinHours: Sunday 10:00 Cairo is inside, Friday and 20:00 are outside", () => {
  const cfg = {
    timezone: "Africa/Cairo",
    days: new Set(["sun", "mon", "tue", "wed", "thu"]),
    startHour: 9,
    endHour: 18,
  };
  // 2026-07-12 is a Sunday. Cairo is UTC+3 in July (EEST).
  assert.equal(withinHours(cfg, new Date("2026-07-12T07:00:00Z")), true);  // 10:00 Cairo
  assert.equal(withinHours(cfg, new Date("2026-07-12T17:00:00Z")), false); // 20:00 Cairo
  assert.equal(withinHours(cfg, new Date("2026-07-17T07:00:00Z")), false); // Friday
  assert.equal(withinHours(cfg, new Date("2026-07-12T06:00:00Z")), true);  // 09:00 boundary
  assert.equal(withinHours(cfg, new Date("2026-07-12T15:00:00Z")), false); // 18:00 boundary
});
