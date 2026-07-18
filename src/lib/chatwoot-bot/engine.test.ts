// Routing acceptance tests — the table from the project brief.
// Run: npm run test:bot   (Node's built-in runner, no dependencies)

import { test } from "node:test";
import assert from "node:assert/strict";
import { route, norm, tokenize, withinHours, replyFor, mergeScript, menuItems, DEFAULT_SCRIPT, MIN_SCORE } from "./engine.ts";
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
  // Cancel / modify (menu 8)
  ["8", "cancel"],
  ["عايزه الغي", "cancel"],       // real customer message that used to hit fallback
  ["عايز الغي الاوردر", "cancel"], // must beat track on "الاوردر"
  ["cancel my order please", "cancel"],
  // Bare order number → tracking, not "I don't understand"
  ["٢٢٠٠٢", "track"],              // real customer message (Arabic-Indic digits)
  ["22002", "track"],
  ["الاوردر اتأخر", "track"],
  // Social niceties get a warm reply instead of the fallback
  ["مرحبا", "greet"],
  ["السلام عليكم", "greet"],
  ["hello", "greet"],
  ["شكرا", "thanks"],
  ["thanks a lot", "thanks"],
  // Governorate coverage
  ["انا من سوهاج كام سعر الشحن؟", "shipping"],
  // Must fall back — never guess
  ["إيه أحسن مطعم في القاهرة؟", null], // the سن/أحسن substring trap
  ["ما هي عاصمة فرنسا", null],
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

test("variants: governorate questions get the specific zone, not the full list", () => {
  const answer = (msg: string) => replyFor(route(msg)!, true, DEFAULT_SCRIPT, msg);
  const answerEn = (msg: string) => replyFor(route(msg)!, false, DEFAULT_SCRIPT, msg);

  const giza = answer("كام الشحن للجيزه؟");
  assert.ok(giza.includes("85.56"), "Giza gets the Greater Cairo rate");
  assert.ok(!giza.includes("199.64"), "…and not the Sinai rate");

  const qalyubia = answer("الشحن مجاني للقليوبية؟");
  assert.ok(qalyubia.includes("سعر الشحن العادي"), "Qalyubia is told free shipping doesn't apply");

  const aswan = answerEn("How much is shipping to Aswan?");
  assert.ok(aswan.includes("128.34") && aswan.includes("Upper Egypt"));

  const matrouh = answer("كام الشحن لمرسى مطروح");
  assert.ok(matrouh.includes("*0*"), "unlisted governorate offers the handoff");
  assert.ok(!/\d+\.\d+/.test(matrouh), "…and quotes no rate at all");

  const generic = answer("كام سعر الشحن؟");
  assert.ok(generic.includes("85.56") && generic.includes("199.64"), "no governorate → full list");
});

test("variants: payment and returns sub-questions get targeted answers", () => {
  const answer = (msg: string) => replyFor(route(msg)!, true, DEFAULT_SCRIPT, msg);
  assert.ok(answer("هل تقبلوا فودافون كاش؟").includes("غير متاحة"), "wallet question → wallets answer");
  assert.ok(answer("أقدر أقسط؟").includes("فاليو"), "installment question → ValU answer");
  assert.ok(answer("عايز أستبدل كتاب").includes("الاستبدال غير متاح"), "exchange question → exchange answer");
  assert.ok(answer("الكتاب وصل تالف").includes("يتحمّل"), "damaged book → store-covers-shipping answer");
  assert.ok(answer("عايز أرجع الكتاب وأخد فلوسي").includes("ردّ المبلغ"), "refund question → refund answer");
});

test("intent replies carry the footer; handoff does not", () => {
  assert.ok(replyFor("shipping", true).endsWith(FOOTER_AR));
  assert.equal(replyFor("handoff", true), HANDOFF_AR);
});

test("menu digits are unique and every intent has both languages", () => {
  const digits = new Set<string>();
  for (const [key, cfg] of Object.entries(INTENTS)) {
    if (cfg.menu) {
      assert.ok(!digits.has(cfg.menu), `duplicate menu digit on ${key}`);
      digits.add(cfg.menu);
    }
    assert.ok(cfg.ar.length > 0 && cfg.en.length > 0, `missing reply text on ${key}`);
  }
});

test("mergeScript: null/empty overrides keep the defaults intact", () => {
  assert.deepEqual(mergeScript(null), DEFAULT_SCRIPT);
  const merged = mergeScript({});
  assert.equal(merged.greetingAr, DEFAULT_SCRIPT.greetingAr);
  assert.deepEqual(Object.keys(merged.intents), Object.keys(DEFAULT_SCRIPT.intents));
  // Routing through a merged-empty script matches the default behaviour.
  assert.equal(route("كام سعر الشحن للاسكندرية؟", merged), "shipping");
  assert.equal(route("إيه أحسن مطعم في القاهرة؟", merged), null);
});

test("mergeScript: edited keyword routes; edited text is used in reply", () => {
  const merged = mergeScript({
    intents: {
      track: { keywords_ar: [...DEFAULT_SCRIPT.intents.track.keywords_ar, "الاوردر بتاعي"] },
      shipping: { ar: "نص شحن معدل" },
    },
  });
  assert.equal(route("الاوردر بتاعي فين", merged), "track");
  assert.ok(replyFor("shipping", true, merged).startsWith("نص شحن معدل"));
  // Untouched intents stay default.
  assert.equal(merged.intents.payment.ar, DEFAULT_SCRIPT.intents.payment.ar);
});

test("mergeScript: a brand-new intent routes by menu digit and keywords", () => {
  const merged = mergeScript({
    intents: {
      giftwrap: {
        menu: "9",
        keywords_ar: ["تغليف هدايا"],
        keywords_en: ["gift wrap"],
        ar: "التغليف متاح",
        en: "Gift wrapping is available",
      },
    },
  });
  assert.equal(route("9", merged), "giftwrap");
  assert.equal(route("do you offer gift wrap?", merged), "giftwrap");
  assert.ok(replyFor("giftwrap", false, merged).startsWith("Gift wrapping is available"));
  // Incomplete new intents (no reply text) are ignored rather than crash.
  const bad = mergeScript({ intents: { broken: { menu: "6" } } });
  assert.ok(!("broken" in bad.intents));
});

test("withinHours: Sunday 10:00 Cairo is inside, Friday and 20:00 are outside", () => {
  const range = { start: 9, end: 18 };
  const cfg = {
    timezone: "Africa/Cairo",
    schedule: { sun: range, mon: range, tue: range, wed: range, thu: range },
  };
  // 2026-07-12 is a Sunday. Cairo is UTC+3 in July (EEST).
  assert.equal(withinHours(cfg, new Date("2026-07-12T07:00:00Z")), true);  // 10:00 Cairo
  assert.equal(withinHours(cfg, new Date("2026-07-12T17:00:00Z")), false); // 20:00 Cairo
  assert.equal(withinHours(cfg, new Date("2026-07-17T07:00:00Z")), false); // Friday
  assert.equal(withinHours(cfg, new Date("2026-07-12T06:00:00Z")), true);  // 09:00 boundary
  assert.equal(withinHours(cfg, new Date("2026-07-12T15:00:00Z")), false); // 18:00 boundary
});

test("public holidays count as after-hours all day", () => {
  const range = { start: 9, end: 18 };
  const cfg = {
    timezone: "Africa/Cairo",
    schedule: { sun: range, mon: range, tue: range, wed: range, thu: range },
    holidays: new Set(["2026-07-23"]), // a Thursday
  };
  // Thu 2026-07-23 11:00 Cairo — normally inside hours, but it's a holiday.
  assert.equal(withinHours(cfg, new Date("2026-07-23T08:00:00Z")), false);
  // The Thursday before is a normal working day.
  assert.equal(withinHours(cfg, new Date("2026-07-16T08:00:00Z")), true);
});

test("menu buttons cover every topic with a digit, plus the agent handoff", () => {
  const items = menuItems(DEFAULT_SCRIPT, true);
  const values = items.map((i) => i.value);
  for (const d of ["1", "2", "3", "4", "5", "6", "7", "8", "0"]) {
    assert.ok(values.includes(d), `missing menu button for ${d}`);
  }
  // Tapping a button routes correctly by its title text.
  for (const item of items) {
    const routed = route(item.title);
    assert.ok(routed !== null, `button title ${JSON.stringify(item.title)} does not route`);
  }
});

test("withinHours: per-day schedules differ (short Thursday, Saturday shift)", () => {
  const cfg = {
    timezone: "Africa/Cairo",
    schedule: {
      sun: { start: 9, end: 18 },
      thu: { start: 9, end: 14 },  // short day
      sat: { start: 12, end: 16 }, // weekend shift
    },
  };
  // 2026-07-16 is a Thursday; 2026-07-18 a Saturday. Cairo is UTC+3.
  assert.equal(withinHours(cfg, new Date("2026-07-16T08:00:00Z")), true);  // Thu 11:00 — inside short day
  assert.equal(withinHours(cfg, new Date("2026-07-16T12:00:00Z")), false); // Thu 15:00 — after 14:00
  assert.equal(withinHours(cfg, new Date("2026-07-18T10:00:00Z")), true);  // Sat 13:00 — inside shift
  assert.equal(withinHours(cfg, new Date("2026-07-18T07:00:00Z")), false); // Sat 10:00 — before shift
  assert.equal(withinHours(cfg, new Date("2026-07-13T07:00:00Z")), false); // Monday — day off entirely
});
