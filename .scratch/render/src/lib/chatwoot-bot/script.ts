// ─────────────────────────────────────────────────────────────
// Chatwoot After-Hours Bot — THE SCRIPT
//
// Every customer-facing reply lives in THIS file and nowhere else.
// To fix wording or add a keyword: edit the text below, commit, deploy.
// Nothing in the routing code needs to change.
//
// Adding a new question type = adding one entry to INTENTS with a
// unique "menu" digit, keywords, and the ar/en reply text.
// ─────────────────────────────────────────────────────────────

export const HOTLINE = "16766";
export const TRACK_URL = "https://nahdetmisrbookstore.com/ar/account/track-your-order";
export const FAQ_URL = "https://nahdetmisrbookstore.com/ar/pages/faq";

/**
 * A specific answer inside a topic. After a topic wins the routing, its
 * variants are scored against the message and the best match replaces the
 * generic (full-list) answer — e.g. "shipping to Giza?" gets the Greater
 * Cairo rate only. No variant matched = the generic answer.
 */
export interface IntentVariant {
  keywords_ar: string[];
  keywords_en: string[];
  ar: string;
  en: string;
}

export interface Intent {
  menu: string;
  keywords_ar: string[];
  keywords_en: string[];
  ar: string;
  en: string;
  /** After replying, also move the conversation to the human queue. */
  open?: boolean;
  variants?: Record<string, IntentVariant>;
  /** Short labels for the tappable menu buttons (topics without them are text-only). */
  title_ar?: string;
  title_en?: string;
  /**
   * When set and no variant matched, the bot asks this instead of sending
   * the generic answer, and remembers the topic — the customer's next
   * message is matched against this topic's variants directly.
   */
  ask_ar?: string;
  ask_en?: string;
}

export const GREETING_AR =
  "أهلاً بك في متجر نهضة مصر! 👋\n" +
  "إحنا حاليًا خارج مواعيد العمل (الأحد – الخميس، 9 ص – 6 م)، ومعاك المساعد الآلي: " +
  "بجاوب فورًا على الأسئلة الشائعة، وأي حاجة تانية بوصّلها للفريق يرد عليك الصبح.\n\n" +
  "اكتب سؤالك على طول، أو اختر موضوعًا من الأزرار 👇\n" +
  "For English, just type in English 🙂";

export const GREETING_EN =
  "Welcome to Nahdet Misr Bookstore! 👋\n" +
  "We're outside working hours right now (Sun–Thu, 9 AM – 6 PM). I'm the automated assistant — " +
  "I answer common questions instantly and pass anything else to the team for the morning.\n\n" +
  "Just type your question, or pick a topic below 👇";

// Key order matters: when two intents tie on score, the earlier one wins
// (same behaviour as the tested reference implementation).
export const INTENTS: Record<string, Intent> = {
  shipping: {
    menu: "1",
    title_ar: "🚚 الشحن والتوصيل",
    title_en: "Shipping",
    ask_ar:
      "🚚 تمام! لأي محافظة حابب توصيل؟ ✍️\n" +
      "اكتب اسم المحافظة (مثلاً: الجيزة، الإسكندرية، أسوان…) وهقولك السعر فورًا.\n" +
      "أو اكتب *كل المحافظات* لعرض القائمة كاملة.",
    ask_en:
      "🚚 Sure! Which governorate should we deliver to? ✍️\n" +
      "Type its name (e.g. Giza, Alexandria, Aswan…) and I'll give you the rate right away.\n" +
      "Or type *all* to see the full list.",
    keywords_ar: ["شحن", "توصيل", "دليفري", "التوصيل", "سعر الشحن", "مصاريف", "يوصل",
      "مجاني", "محافظه", "المنصوره", "طنطا", "اسكندريه", "اسوان", "القليوبيه",
      "بورسعيد", "الاسماعيليه", "السويس", "الدقهليه", "الشرقيه", "الغربيه", "المنوفيه",
      "البحيره", "كفر الشيخ", "دمياط", "الفيوم", "بني سويف", "المنيا", "اسيوط",
      "سوهاج", "قنا", "الاقصر", "مطروح", "سيناء", "الوادي الجديد", "البحر الاحمر",
      "الغردقه", "شرم الشيخ", "الزقازيق", "المحله", "توصلوا", "بتوصلوا", "الشحن كام"],
    keywords_en: ["shipping", "delivery", "deliver", "ship", "postage", "free shipping",
      "aswan", "luxor", "sohag", "minya", "asyut", "qena", "fayoum", "suez", "ismailia",
      "port said", "damietta", "tanta", "mansoura", "matrouh", "sinai", "hurghada"],
    ar:
      "🚚 *الشحن والتوصيل*\n\n" +
      "*الشحن المجاني:* للطلبات من 999 جنيهًا فأكثر — للقاهرة والجيزة والإسكندرية فقط. " +
      "باقي المحافظات (بما فيها القليوبية) تُطبَّق عليها أسعار الشحن العادية.\n\n" +
      "*أسعار الشحن (تبدأ من — والسعر النهائي يظهر عند إتمام الطلب):*\n" +
      "• القاهرة الكبرى (القاهرة، الجيزة، القليوبية): من 85.56 ج.م\n" +
      "• الوجه البحري والقناة (الإسكندرية، بورسعيد، الإسماعيلية، السويس، الدقهلية، " +
      "الشرقية، الغربية، المنوفية، البحيرة، كفر الشيخ، دمياط): من 99.83 ج.م\n" +
      "• الوجه القبلي (الفيوم، بني سويف، المنيا، أسيوط، سوهاج، قنا، الأقصر، أسوان): من 128.34 ج.م\n" +
      "• سيناء: من 199.64 ج.م\n\n" +
      "*مدة التوصيل:* من 1 إلى 7 أيام عمل حسب المحافظة.\n" +
      "*شركة الشحن:* أرامكس. *الحد الأدنى للطلب:* 150 جنيهًا.\n" +
      "التوصيل خارج مصر غير متاح حاليًا.\n\n" +
      "لو محافظتك مش مذكورة، اكتب *0* واترك بياناتك والفريق هيتواصل معاك.",
    en:
      "🚚 *Shipping & delivery*\n\n" +
      "*Free shipping:* on orders of 999 EGP or more — Cairo, Giza, and Alexandria only. " +
      "All other governorates (including Qalyubia) pay standard rates.\n\n" +
      "*Rates (starting from — final price shows at checkout):*\n" +
      "• Greater Cairo (Cairo, Giza, Qalyubia): from 85.56 EGP\n" +
      "• Delta & Canal (Alexandria, Port Said, Ismailia, Suez, Dakahlia, Sharqia, " +
      "Gharbia, Monufia, Beheira, Kafr El Sheikh, Damietta): from 99.83 EGP\n" +
      "• Upper Egypt (Fayoum, Beni Suef, Minya, Asyut, Sohag, Qena, Luxor, Aswan): from 128.34 EGP\n" +
      "• Sinai: from 199.64 EGP\n\n" +
      "*Delivery time:* 1–7 business days depending on the governorate.\n" +
      "*Courier:* Aramex. *Minimum order:* 150 EGP.\n" +
      "International delivery is not available.\n\n" +
      "If your governorate isn't listed, reply *0* to leave your details.",
    variants: {
      greater_cairo: {
        keywords_ar: ["القاهره", "الجيزه", "القليوبيه", "جيزه", "قليوبيه", "قاهره"],
        keywords_en: ["cairo", "giza", "qalyubia"],
        ar:
          "🚚 *الشحن للقاهرة الكبرى (القاهرة، الجيزة، القليوبية)*\n\n" +
          "السعر يبدأ من *85.56 ج.م* — والسعر النهائي يظهر عند إتمام الطلب.\n" +
          "⏱ التوصيل خلال من 1 إلى 7 أيام عمل حسب المحافظة مع أرامكس. الحد الأدنى للطلب: 150 ج.م.\n\n" +
          "🎁 *الشحن المجاني* للطلبات من 999 ج.م متاح *للقاهرة والجيزة فقط* — " +
          "القليوبية يُطبَّق عليها سعر الشحن العادي.",
        en:
          "🚚 *Shipping to Greater Cairo (Cairo, Giza, Qalyubia)*\n\n" +
          "Rate starts from *85.56 EGP* — the final price shows at checkout.\n" +
          "⏱ Delivery in 1–7 business days depending on the governorate with Aramex. Minimum order: 150 EGP.\n\n" +
          "🎁 *Free shipping* on orders of 999 EGP+ applies to *Cairo and Giza only* — " +
          "Qalyubia pays the standard rate.",
      },
      alexandria: {
        keywords_ar: ["اسكندريه", "الاسكندريه", "اسكندريا"],
        keywords_en: ["alexandria", "alex"],
        ar:
          "🚚 *الشحن للإسكندرية*\n\n" +
          "السعر يبدأ من *99.83 ج.م* — والسعر النهائي يظهر عند إتمام الطلب.\n" +
          "⏱ التوصيل خلال من 1 إلى 7 أيام عمل حسب المحافظة مع أرامكس. الحد الأدنى للطلب: 150 ج.م.\n\n" +
          "🎁 *الشحن المجاني* متاح للإسكندرية على الطلبات من 999 ج.م فأكثر.",
        en:
          "🚚 *Shipping to Alexandria*\n\n" +
          "Rate starts from *99.83 EGP* — the final price shows at checkout.\n" +
          "⏱ Delivery in 1–7 business days depending on the governorate with Aramex. Minimum order: 150 EGP.\n\n" +
          "🎁 *Free shipping* applies to Alexandria on orders of 999 EGP or more.",
      },
      delta_canal: {
        keywords_ar: ["بورسعيد", "الاسماعيليه", "السويس", "الدقهليه", "المنصوره", "طنطا",
          "المحله", "الزقازيق", "الشرقيه", "الغربيه", "المنوفيه", "البحيره", "كفر الشيخ", "دمياط"],
        keywords_en: ["port said", "ismailia", "suez", "dakahlia", "mansoura", "tanta",
          "sharqia", "gharbia", "monufia", "beheira", "kafr", "damietta", "zagazig"],
        ar:
          "🚚 *الشحن للوجه البحري والقناة*\n\n" +
          "السعر لمحافظتك يبدأ من *99.83 ج.م* — والسعر النهائي يظهر عند إتمام الطلب.\n" +
          "⏱ التوصيل خلال من 1 إلى 7 أيام عمل حسب المحافظة مع أرامكس. الحد الأدنى للطلب: 150 ج.م.\n\n" +
          "*ملحوظة:* الشحن المجاني (999 ج.م+) متاح للقاهرة والجيزة والإسكندرية فقط.",
        en:
          "🚚 *Shipping to the Delta & Canal region*\n\n" +
          "Your governorate's rate starts from *99.83 EGP* — the final price shows at checkout.\n" +
          "⏱ Delivery in 1–7 business days depending on the governorate with Aramex. Minimum order: 150 EGP.\n\n" +
          "*Note:* free shipping (999 EGP+) applies to Cairo, Giza, and Alexandria only.",
      },
      upper_egypt: {
        keywords_ar: ["الفيوم", "بني سويف", "المنيا", "اسيوط", "سوهاج", "قنا", "الاقصر", "اسوان"],
        keywords_en: ["fayoum", "beni suef", "minya", "asyut", "sohag", "qena", "luxor", "aswan"],
        ar:
          "🚚 *الشحن للوجه القبلي*\n\n" +
          "السعر لمحافظتك يبدأ من *128.34 ج.م* — والسعر النهائي يظهر عند إتمام الطلب.\n" +
          "⏱ التوصيل خلال من 1 إلى 7 أيام عمل حسب المحافظة مع أرامكس. الحد الأدنى للطلب: 150 ج.م.\n\n" +
          "*ملحوظة:* الشحن المجاني (999 ج.م+) متاح للقاهرة والجيزة والإسكندرية فقط.",
        en:
          "🚚 *Shipping to Upper Egypt*\n\n" +
          "Your governorate's rate starts from *128.34 EGP* — the final price shows at checkout.\n" +
          "⏱ Delivery in 1–7 business days depending on the governorate with Aramex. Minimum order: 150 EGP.\n\n" +
          "*Note:* free shipping (999 EGP+) applies to Cairo, Giza, and Alexandria only.",
      },
      sinai: {
        keywords_ar: ["سيناء", "العريش", "شرم الشيخ", "دهب", "نويبع"],
        keywords_en: ["sinai", "arish", "sharm", "dahab", "nuweiba"],
        ar:
          "🚚 *الشحن لسيناء*\n\n" +
          "السعر يبدأ من *199.64 ج.م* — والسعر النهائي يظهر عند إتمام الطلب.\n" +
          "⏱ التوصيل خلال من 1 إلى 7 أيام عمل حسب المحافظة مع أرامكس. الحد الأدنى للطلب: 150 ج.م.",
        en:
          "🚚 *Shipping to Sinai*\n\n" +
          "Rate starts from *199.64 EGP* — the final price shows at checkout.\n" +
          "⏱ Delivery in 1–7 business days depending on the governorate with Aramex. Minimum order: 150 EGP.",
      },
      unlisted: {
        keywords_ar: ["مطروح", "مرسي مطروح", "الوادي الجديد", "البحر الاحمر", "الغردقه"],
        keywords_en: ["matrouh", "new valley", "red sea", "hurghada"],
        ar:
          "🚚 معلش، محافظتك مش ضمن القائمة المعلنة وأنا مش هخمّن سعر 🙏\n" +
          "اكتب *0* واترك (الاسم • المحافظة • رقم الهاتف) والفريق هيأكدلك سعر الشحن " +
          "أول ما الدوام يبدأ (الأحد – الخميس، 9 ص – 6 م).",
        en:
          "🚚 Sorry — your governorate isn't on the published list and I won't guess a price 🙏\n" +
          "Reply *0* with your name, governorate, and phone number, and the team will confirm " +
          "the exact rate first thing in the morning (Sun–Thu, 9 AM – 6 PM).",
      },
    },
  },
  payment: {
    menu: "2",
    title_ar: "💳 طرق الدفع",
    title_en: "Payment",
    keywords_ar: ["دفع", "الدفع", "ادفع", "فيزا", "كارت", "بطاقه", "تقسيط", "اقسط", "قسط",
      "اقساط", "فاليو", "فودافون كاش", "محفظه", "كاش", "الاستلام", "انستاباي", "ماستر كارد"],
    keywords_en: ["pay", "payment", "card", "visa", "mastercard", "installment", "instalment",
      "valu", "wallet", "cash on delivery", "cod", "accept cash"],
    ar:
      "💳 *طرق الدفع*\n\n" +
      "• الدفع عند الاستلام: ✅ متاح\n" +
      "• بطاقات الائتمان والخصم (Visa / Mastercard): ✅ متاح\n" +
      "• التقسيط عن طريق «فاليو» (ValU): ✅ متاح\n" +
      "• المحافظ الإلكترونية (فودافون كاش وغيرها): ❌ غير متاحة حاليًا\n\n" +
      "🔒 لن نطلب منك أبدًا بيانات بطاقتك أو رمز OTP داخل المحادثة.",
    en:
      "💳 *Payment methods*\n\n" +
      "• Cash on delivery: ✅ available\n" +
      "• Credit / debit cards (Visa / Mastercard): ✅ available\n" +
      "• Installments via ValU: ✅ available\n" +
      "• E-wallets (Vodafone Cash etc.): ❌ not available\n\n" +
      "🔒 We will never ask for your card details or OTP in this chat.",
    variants: {
      wallets: {
        keywords_ar: ["فودافون", "فودافون كاش", "محفظه", "محافظ", "انستاباي", "اورانج كاش", "اتصالات كاش"],
        keywords_en: ["wallet", "vodafone", "instapay", "orange cash"],
        ar:
          "💳 المحافظ الإلكترونية (فودافون كاش وغيرها): ❌ *غير متاحة حاليًا*.\n\n" +
          "المتاح للدفع:\n" +
          "• الدفع عند الاستلام ✅\n" +
          "• بطاقات Visa / Mastercard ✅\n" +
          "• التقسيط عن طريق «فاليو» ✅",
        en:
          "💳 E-wallets (Vodafone Cash etc.): ❌ *not available at the moment*.\n\n" +
          "You can pay with:\n" +
          "• Cash on delivery ✅\n" +
          "• Visa / Mastercard ✅\n" +
          "• Installments via ValU ✅",
      },
      installments: {
        keywords_ar: ["تقسيط", "اقسط", "قسط", "اقساط", "فاليو"],
        keywords_en: ["installment", "instalment", "valu"],
        ar:
          "💳 *التقسيط متاح* ✅ عن طريق «فاليو» (ValU) — اختاره كطريقة دفع عند إتمام الطلب.\n" +
          "ومتاح كمان: الدفع عند الاستلام وبطاقات Visa / Mastercard.",
        en:
          "💳 *Installments are available* ✅ via ValU — pick it as the payment method at checkout.\n" +
          "Also available: cash on delivery and Visa / Mastercard.",
      },
      cod: {
        keywords_ar: ["الاستلام", "عند الاستلام", "كاش"],
        keywords_en: ["cash on delivery", "cod", "accept cash"],
        ar:
          "💳 *الدفع عند الاستلام متاح* ✅ في كل المحافظات.\n" +
          "ومتاح كمان: بطاقات Visa / Mastercard والتقسيط عن طريق «فاليو».",
        en:
          "💳 *Cash on delivery is available* ✅ across all governorates.\n" +
          "Also available: Visa / Mastercard and installments via ValU.",
      },
    },
  },
  returns: {
    menu: "3",
    title_ar: "↩️ الاسترجاع",
    title_en: "Returns",
    keywords_ar: ["ارجاع", "استرجاع", "ارجع", "ارجعه", "استبدال", "استبدل", "ابدل",
      "بدل", "فلوسي", "استرداد", "مرتجع", "تالف", "مكسور", "غلط", "خطا",
      "معيوب", "ناقص", "مقطوع", "مش عاجبني"],
    keywords_en: ["return", "refund", "exchange", "damaged", "wrong item", "money back", "faulty"],
    ar:
      "↩️ *الاسترجاع*\n\n" +
      "• *المدة:* خلال 14 يومًا من تاريخ الاستلام.\n" +
      "• *الشروط:* الكتب غير مستخدمة وغير تالفة وفي حالتها الأصلية، ومعها الفاتورة.\n" +
      "• *الاستبدال:* غير متاح حاليًا.\n" +
      "• *مصاريف شحن الإرجاع:* على العميل، إلا إذا كان المنتج تالفًا أو وصلك كتاب خاطئ — " +
      "في الحالتين دول المتجر هو اللي بيتحمّلها.\n" +
      "• *ردّ المبلغ:* خلال 14 يوم عمل، بنفس طريقة الدفع أو بالطريقة اللي تختارها.\n\n" +
      "*خطوات الإرجاع:* من حسابك → «سجل الطلبات» → حدّد الطلب → اختر خيار الإرجاع.\n" +
      `${TRACK_URL}\n\n` +
      "لو الكتاب وصل تالف أو وصلك كتاب غلط، اكتب *0* واترك بياناتك مع وصف المشكلة " +
      "(وصورة لو أمكن) والفريق هيتابع معاك.",
    en:
      "↩️ *Returns*\n\n" +
      "• *Window:* within 14 days of receipt.\n" +
      "• *Conditions:* books unused, undamaged, original condition, with the invoice.\n" +
      "• *Exchanges:* not available.\n" +
      "• *Return shipping:* paid by the customer — unless the item is faulty or wrong, " +
      "in which case we cover it.\n" +
      "• *Refund:* within 14 business days, to your original payment method or one you choose.\n\n" +
      "*How:* your account → \"My Orders\" → select the order → choose return.\n" +
      `${TRACK_URL}\n\n` +
      "For a damaged or wrong item, reply *0* and leave your details with a description " +
      "(and a photo if possible).",
    variants: {
      damaged: {
        keywords_ar: ["تالف", "مكسور", "معيوب", "ناقص", "مقطوع", "غلط", "خطا"],
        keywords_en: ["damaged", "wrong item", "faulty", "broken"],
        ar:
          "↩️ لو الكتاب وصل *تالفًا* أو وصلك *كتاب خاطئ* — المتجر هو اللي بيتحمّل مصاريف " +
          "شحن الإرجاع بالكامل ✅ (خلال 14 يومًا من الاستلام).\n\n" +
          "اكتب *0* واترك بياناتك مع وصف المشكلة (وصورة لو أمكن) والفريق هيظبطها معاك.",
        en:
          "↩️ If the book arrived *damaged* or you received the *wrong item* — we cover the " +
          "return shipping in full ✅ (within 14 days of receipt).\n\n" +
          "Reply *0* and leave your details with a description (and a photo if possible).",
      },
      exchange: {
        keywords_ar: ["استبدال", "استبدل", "ابدل", "بدل"],
        keywords_en: ["exchange", "swap"],
        ar:
          "↩️ *الاستبدال غير متاح حاليًا* ❌ — لكن تقدر ترجع الكتاب خلال 14 يومًا من الاستلام " +
          "(بحالته الأصلية ومعاه الفاتورة) وتطلب اللي تحبه بدل منه.\n" +
          "مصاريف شحن الإرجاع على العميل — إلا لو المنتج تالف أو خاطئ فالمتجر بيتحمّلها.\n\n" +
          "*خطوات الإرجاع:* حسابك → «سجل الطلبات» → حدّد الطلب → اختر خيار الإرجاع.",
        en:
          "↩️ *Exchanges aren't available* ❌ — but you can return the book within 14 days of " +
          "receipt (original condition, with the invoice) and order the one you want instead.\n" +
          "Return shipping is on the customer — unless the item is faulty or wrong, then we cover it.\n\n" +
          "*How:* your account → \"My Orders\" → select the order → choose return.",
      },
      refund: {
        keywords_ar: ["فلوسي", "استرداد", "المبلغ"],
        keywords_en: ["refund", "money back"],
        ar:
          "↩️ *ردّ المبلغ* بيتم خلال 14 يوم عمل من استلام المرتجع — بنفس طريقة الدفع " +
          "أو بالطريقة اللي تختارها.\n" +
          "شرط الإرجاع: خلال 14 يومًا من الاستلام والكتاب بحالته الأصلية ومعاه الفاتورة.\n\n" +
          "*خطوات الإرجاع:* حسابك → «سجل الطلبات» → حدّد الطلب → اختر خيار الإرجاع.",
        en:
          "↩️ *Refunds* are issued within 14 business days of us receiving the return — to your " +
          "original payment method or one you choose.\n" +
          "Condition: return within 14 days of receipt, book in original condition with the invoice.\n\n" +
          "*How:* your account → \"My Orders\" → select the order → choose return.",
      },
    },
  },
  track: {
    menu: "4",
    title_ar: "📦 تتبّع طلبي",
    title_en: "Track order",
    keywords_ar: ["فين طلبي", "طلبي", "تتبع", "اتتبع", "شحنتي", "وصل", "الاوردر", "اوردر",
      "حاله الطلب", "امتي يوصل", "اتاخر", "متاخر", "تاخر", "تاخير", "موصلش", "وصلش",
      "مستني", "رقم الطلب", "رقم الاوردر"],
    keywords_en: ["where is my order", "track", "tracking", "my order", "order status",
      "delayed", "late", "not arrived", "hasn't arrived", "didn't arrive"],
    ar:
      "📦 *تتبّع الطلب*\n\n" +
      "تقدر تتابع حالة طلبك في أي وقت من هنا:\n" +
      `${TRACK_URL}\n\n` +
      "أو من قسم «طلباتي» في حسابك على الموقع.\n\n" +
      "معلش، أنا مساعد آلي ومش قادر أشوف حالة طلب معيّن. لو محتاج مساعدة في طلب بالتحديد، " +
      "اكتب *0* واترك اسمك ورقم الطلب ورقم هاتفك — والفريق هيتواصل معاك أول ما الدوام يبدأ.\n\n" +
      `وللأمور العاجلة: الخط الساخن ${HOTLINE} خلال مواعيد العمل.`,
    en:
      "📦 *Track your order*\n\n" +
      `You can check your order status any time here:\n${TRACK_URL}\n\n` +
      "Or via \"My Orders\" in your account.\n\n" +
      "I'm an automated assistant and can't see a specific order's status. If you need help " +
      "with a particular order, reply *0* and leave your name, order number, and phone — " +
      "the team will follow up as soon as we're back.\n\n" +
      `For anything urgent: hotline ${HOTLINE} during working hours.`,
  },
  categories: {
    menu: "5",
    title_ar: "📚 الأقسام واللغات",
    title_en: "Categories",
    keywords_ar: ["كتب", "كتاب", "اقسام", "قسم", "انجليزي", "فرنساوي", "فرنسي", "اطفال",
      "كوميكس", "ديزني", "مارفل", "روايات", "ترشيح", "اقترح", "سن", "سنه", "سنين",
      "سلسله", "اجزاء", "روايه", "قصص", "قصه"],
    keywords_en: ["books", "category", "categories", "english", "french", "kids", "children",
      "comics", "disney", "marvel", "recommend", "suggestion"],
    ar:
      "📚 *الأقسام واللغات*\n\n" +
      "*الأقسام:* كتب الأطفال والناشئة • الأدب والروايات • الكتب الثقافية والعامة • " +
      "القصص المصوّرة (كوميكس) • الكتب باللغات الأجنبية\n\n" +
      "*اللغات:* العربية، الإنجليزية، الفرنسية\n" +
      "*الفئات العمرية للأطفال:* 0–3 • 3–6 • 6–9 • 9–12 • 13–15\n" +
      "*العلامات المرخّصة:* Disney • National Geographic • DK • Marvel\n\n" +
      "تصفّح كل الأقسام من هنا: https://nahdetmisrbookstore.com/ar\n\n" +
      "عايز ترشيح لكتاب معيّن؟ اكتب *0* واترك بياناتك مع الفئة العمرية واللغة المفضّلة، " +
      "والفريق هيرشّحلك.",
    en:
      "📚 *Categories & languages*\n\n" +
      "*Categories:* children & young readers • literature & novels • cultural & general • " +
      "comics • foreign-language books\n\n" +
      "*Languages:* Arabic, English, French\n" +
      "*Children's age bands:* 0–3 • 3–6 • 6–9 • 9–12 • 13–15\n" +
      "*Licensed brands:* Disney • National Geographic • DK • Marvel\n\n" +
      "Browse: https://nahdetmisrbookstore.com/ar\n\n" +
      "Want a recommendation? Reply *0* with the age band and preferred language.",
    variants: {
      availability: {
        keywords_ar: ["متوفر", "موجود", "نسخه", "متاح", "سلسله", "اجزاء", "عايزه اطلب", "عايز اطلب"],
        keywords_en: ["available", "in stock", "stock", "copy", "series", "do you have"],
        ar:
          "🔎 سؤالك عن كتاب أو سلسلة معيّنة — وأنا للأسف مش بقدر أتأكد من التوفر بنفسي 🙏\n\n" +
          "أسرع طريقة: دوّر بالاسم مباشرة هنا 👈 https://nahdetmisrbookstore.com/ar\n" +
          "لو لقيته، اطلبه على طول من الموقع.\n\n" +
          "ولو مش لاقيه أو حابب تتأكد الأول: اكتب *0* واترك اسم الكتاب وبياناتك، " +
          "والفريق هيتأكدلك ويرد عليك في مواعيد العمل.",
        en:
          "🔎 You're asking about a specific title — I can't check live stock myself 🙏\n\n" +
          "Fastest way: search it by name here 👈 https://nahdetmisrbookstore.com/ar\n" +
          "If it's there, you can order it right away.\n\n" +
          "Can't find it, or want to be sure first? Reply *0* with the book's name and your " +
          "details — the team will confirm during working hours.",
      },
    },
  },
  hours: {
    menu: "6",
    title_ar: "🕘 مواعيد العمل",
    title_en: "Hours & contact",
    keywords_ar: ["مواعيد", "ميعاد", "شغالين", "فاتحين", "تليفون", "رقم", "ايميل",
      "تواصل", "الخط الساخن", "امتي", "الجمعه", "السبت", "اجازه", "عطله", "بتفتحوا", "بتقفلوا"],
    keywords_en: ["hours", "open", "closed", "contact", "phone", "email", "hotline",
      "friday", "saturday", "weekend"],
    ar:
      "🕘 *مواعيد العمل والتواصل*\n\n" +
      "• *المواعيد:* من الأحد إلى الخميس، 9 صباحًا – 6 مساءً\n" +
      "• *الإجازات:* الجمعة والسبت والعطلات الرسمية\n" +
      `• *الخط الساخن:* ${HOTLINE}\n` +
      "• *البريد الإلكتروني:* Supportstore@nahdetmisr.com\n" +
      "• *فيسبوك:* https://www.facebook.com/NahdetMisrBookstore\n" +
      "• *إنستجرام:* https://www.instagram.com/nahdetmisrbookstore\n" +
      `• *الأسئلة الشائعة:* ${FAQ_URL}`,
    en:
      "🕘 *Working hours & contact*\n\n" +
      "• *Hours:* Sunday–Thursday, 9 AM – 6 PM\n" +
      "• *Closed:* Friday, Saturday, and public holidays\n" +
      `• *Hotline:* ${HOTLINE}\n` +
      "• *Email:* Supportstore@nahdetmisr.com\n" +
      "• *Facebook:* https://www.facebook.com/NahdetMisrBookstore\n" +
      "• *Instagram:* https://www.instagram.com/nahdetmisrbookstore\n" +
      `• *FAQ:* ${FAQ_URL}`,
  },
  bulk: {
    menu: "7",
    title_ar: "🏫 طلبات الجملة",
    title_en: "Bulk orders",
    keywords_ar: ["جمله", "بالجمله", "مدرسه", "مدارس", "شركه", "كميه", "كميات",
      "خصم", "عرض سعر", "كوبون", "كود"],
    keywords_en: ["bulk", "wholesale", "school", "corporate", "quantity", "discount",
      "quote", "coupon", "promo"],
    ar:
      "🏫 *الطلبات بالجملة والمدارس والشركات*\n\n" +
      `للاستفسار وطلب عرض سعر، تواصل مع الخط الساخن *${HOTLINE}* خلال مواعيد العمل ` +
      "(الأحد – الخميس، 9 ص – 6 م).\n\n" +
      "أو اكتب *0* واترك بياناتك والفريق هيتواصل معاك.\n\n" +
      "*بخصوص الكوبونات:* تقدر تدخل كود الخصم في خانة كود الخصم عند إتمام الطلب. " +
      "معلش، مش قادر أتأكد من صلاحية كود معيّن.",
    en:
      "🏫 *Bulk, school & corporate orders*\n\n" +
      `To enquire or request a quote, please call our hotline *${HOTLINE}* during working ` +
      "hours (Sun–Thu, 9 AM – 6 PM).\n\n" +
      "Or reply *0* to leave your details.\n\n" +
      "*Coupons:* enter your code in the discount-code field at checkout. " +
      "I can't confirm whether a specific code is valid.",
  },
  cancel: {
    menu: "8",
    title_ar: "🚫 إلغاء أو تعديل طلب",
    title_en: "Cancel order",
    open: true,
    keywords_ar: ["الغي", "الغاء", "يلغي", "تلغي", "الغيه", "كنسل", "الغي الاوردر",
      "الغي الطلب", "الغاء الطلب", "الغاء الاوردر", "اعدل", "تعديل", "اغير",
      "اضيف", "اضيف عليه", "ازود", "ازود عليه", "اضافه",
      "مش قادر الغي", "مش عارف الغي", "معرفش الغي", "مقدرتش الغي"],
    keywords_en: ["cancel", "cancellation", "cancel my order", "cancel order", "modify", "change my order",
      "add to my order", "add another", "add more", "add item", "add a book", "add a product",
      "edit my order", "edit order",
      "cant cancel", "can't cancel", "cannot cancel", "unable to cancel", "not able to cancel"],
    ar:
      "🚫 *إلغاء طلب*\n\n" +
      "تمام، هسجّل طلبك للفريق. علشان نظبطها بسرعة، من فضلك اكتب في رسالة واحدة:\n" +
      "• *رقم الطلب*\n" +
      "• *رقم الهاتف*\n" +
      "• سبب الإلغاء (اختياري)\n\n" +
      "الفريق هيتواصل معاك أول ما الدوام يبدأ (الأحد – الخميس، 9 ص – 6 م). " +
      `وللأمور العاجلة: الخط الساخن ${HOTLINE}.\n\n` +
      "ملحوظة: مش متاح تعديل الطلب بعد تأكيده — تقدر تلغيه وتعمل طلب جديد. " +
      "ولو الطلب وصلك بالفعل، تقدر تسترجعه خلال 14 يوم — اكتب *3* للتفاصيل.",
    en:
      "🚫 *Cancel an order*\n\n" +
      "Got it — I'm flagging this for the team. To sort it quickly, please send in one message:\n" +
      "• *Order number*\n" +
      "• *Phone number*\n" +
      "• The reason (optional)\n\n" +
      "The team will contact you as soon as we're back (Sun–Thu, 9 AM – 6 PM). " +
      `Urgent? Hotline ${HOTLINE}.\n\n` +
      "Note: orders can't be changed once placed — you can cancel and place a new one. " +
      "If the order already arrived, you can return it within 14 days — reply *3* for details.",
    variants: {
      // "I can't cancel it" — checked first so it wins over generic modify words.
      cant_cancel: {
        keywords_ar: ["مش قادر الغي", "مش قادره الغي", "مش عارف الغي", "مش عارفه الغي",
          "معرفش الغي", "مقدرتش الغي", "مش راضي يتلغي", "مفيش الغاء", "مش لاقي الغاء"],
        keywords_en: ["cant cancel", "can't cancel", "cannot cancel", "unable to cancel",
          "not able to cancel", "wont let me cancel", "won't let me cancel"],
        ar:
          "🚚 *لو مش قادر تلغي الطلب*\n\n" +
          "استنى مكالمة مندوب الشحن، ولما يتواصل معاك *ارفض استلام الشحنة*، " +
          "وبعدها اعمل طلب جديد بكل المنتجات اللي محتاجها.",
        en:
          "🚚 *If you can't cancel the order*\n\n" +
          "Wait for the courier's call and *refuse the shipment* when they contact you, " +
          "then place a new order with everything you need.",
      },
      // "add to / change my existing order" — policy: not possible after checkout.
      modify: {
        keywords_ar: ["اضيف", "اضيف عليه", "ازود", "اضافه", "اعدل", "تعديل", "اغير",
          "عايز اضيف", "عايزه اضيف"],
        keywords_en: ["add", "add to my order", "add another", "add more", "add item",
          "add a book", "add a product", "edit", "modify", "change my order"],
        ar:
          "🚫 *الإضافة أو التعديل على طلب مؤكد*\n\n" +
          "للأسف مش متاح تعديل الطلب أو الإضافة عليه بعد تأكيده 🙏\n" +
          "الحل: *تلغي الطلب الحالي وتعمل طلب جديد* بكل المنتجات اللي محتاجها.",
        en:
          "🚫 *Adding to or changing a confirmed order*\n\n" +
          "Unfortunately an order can't be changed or added to once it's placed 🙏\n" +
          "The solution: *cancel the current order and place a new one* with everything you need.",
      },
    },
  },
  // greet/thanks have no menu digit and sit last so real topics win score ties.
  greet: {
    menu: "",
    keywords_ar: ["مرحبا", "اهلا", "هاي", "السلام عليكم", "صباح الخير", "مساء الخير",
      "ازيك", "ازيكم", "سلام"],
    keywords_en: ["hello", "hi", "hey", "good morning", "good evening"],
    ar:
      "أهلاً بيك في متجر نهضة مصر! 👋\n" +
      "أنا المساعد الآلي — أقدر أساعدك فورًا في الأسئلة الشائعة.\n\n" +
      "اكتب رقم الموضوع:\n" +
      "1️⃣ الشحن • 2️⃣ الدفع • 3️⃣ الاسترجاع • 4️⃣ تتبّع طلبي\n" +
      "5️⃣ الأقسام • 6️⃣ مواعيد العمل • 7️⃣ طلبات الجملة • 8️⃣ إلغاء طلب\n" +
      "0️⃣ التحدث مع موظف",
    en:
      "Welcome to Nahdet Misr Bookstore! 👋\n" +
      "I'm the automated assistant — I can help right away with common questions.\n\n" +
      "Pick a topic:\n" +
      "1️⃣ Shipping • 2️⃣ Payment • 3️⃣ Returns • 4️⃣ Track order\n" +
      "5️⃣ Categories • 6️⃣ Hours & contact • 7️⃣ Bulk orders • 8️⃣ Cancel an order\n" +
      "0️⃣ Talk to a human",
  },
  thanks: {
    menu: "",
    keywords_ar: ["شكرا", "متشكر", "متشكره", "تسلم", "تسلموا", "الف شكر"],
    keywords_en: ["thanks", "thank", "thx"],
    ar:
      "العفو يا فندم! 🙏 تحت أمرك في أي وقت.\n" +
      "لو احتجت حاجة تانية، اكتب رقم من القائمة أو *0* للتواصل مع موظف.",
    en:
      "You're welcome! 🙏 Happy to help.\n" +
      "If you need anything else, pick a menu number or reply *0* to reach the team.",
  },
};

export const HANDOFF_KEYWORDS_AR = ["موظف", "انسان", "بشري", "مندوب", "مدير", "شكوي", "حد يكلمني",
  "عايز اكلم", "مسئول", "مسؤول", "بني ادم"];
export const HANDOFF_KEYWORDS_EN = ["agent", "human", "representative", "manager", "complaint",
  "speak to someone", "call me", "supervisor", "person"];

export const HANDOFF_AR =
  "للأسف مفيش موظف متاح دلوقتي 🙏 — مواعيد الفريق من الأحد إلى الخميس، 9 ص – 6 م.\n" +
  "سيب بياناتك في رسالة واحدة وهنتواصل معاك أول ما نرجع:\n" +
  "• *الاسم*\n" +
  "• *رقم الهاتف*\n" +
  "• *رقم الطلب* (لو عندك)\n" +
  "• استفسارك باختصار\n\n" +
  `وللأمور العاجلة: الخط الساخن *${HOTLINE}* خلال مواعيد العمل.`;

export const HANDOFF_EN =
  "I'm sorry — no agent is available right now 🙏 The team works Sun–Thu, 9 AM – 6 PM.\n" +
  "Leave your details in one message and we'll contact you as soon as we're back:\n" +
  "• *Name*\n" +
  "• *Phone number*\n" +
  "• *Order number* (if you have one)\n" +
  "• Your question, briefly\n\n" +
  `Urgent? Call our hotline *${HOTLINE}* during working hours.`;

export const FALLBACK_AR =
  "سؤال حلو بس خارج معرفتي أنا 🙏 وصّلت رسالتك للفريق، وهيردوا عليك في مواعيد العمل " +
  "(الأحد – الخميس، 9 ص – 6 م).\n" +
  `لو مستعجل، كلمنا على الخط الساخن *${HOTLINE}*.\n` +
  "وفي اللي أقدر أساعدك فيه فورًا 👇";

export const FALLBACK_EN =
  "Good question — but it's beyond what I can answer 🙏 I've passed your message to the team; " +
  "they'll reply during working hours (Sun–Thu, 9 AM – 6 PM).\n" +
  `In a hurry? Call our hotline *${HOTLINE}*.\n` +
  "Here's what I can help with right away 👇";

export const FOOTER_AR = "\n\n———\nمحتاج حاجة تانية؟ اكتب سؤالك، أو *0* لترك بياناتك للفريق.";
export const FOOTER_EN = "\n\n———\nAnything else? Just ask — or reply *0* to leave your details for the team.";

// Shown above the tappable topic buttons (sent with the greeting/fallback).
export const MENU_PROMPT_AR = "اختر موضوعًا 👇";
export const MENU_PROMPT_EN = "Pick a topic 👇";
export const HANDOFF_TITLE_AR = "💬 التحدث مع موظف";
export const HANDOFF_TITLE_EN = "Talk to an agent";

// Reply when the customer sends a photo/file with no text — usually proof of
// a damaged or wrong item.
export const ATTACHMENT_AR =
  "وصلتنا الصورة 📷 شكرًا!\n" +
  "أنا مساعد آلي ومش بقدر أفتح المرفقات، لكن الفريق هيشوفها أول ما الدوام يبدأ.\n" +
  "علشان نسرّع الحل، اكتب في رسالة واحدة:\n" +
  "• *رقم الطلب*\n• *رقم الهاتف*\n• وصف قصير للمشكلة\n\n" +
  `وللأمور العاجلة: الخط الساخن ${HOTLINE}.`;
export const ATTACHMENT_EN =
  "Got your photo 📷 thanks!\n" +
  "I'm an automated assistant and can't open attachments, but the team will review it first " +
  "thing in the morning.\n" +
  "To speed things up, please send in one message:\n" +
  "• *Order number*\n• *Phone number*\n• A short description of the issue\n\n" +
  `Urgent? Hotline ${HOTLINE}.`;
