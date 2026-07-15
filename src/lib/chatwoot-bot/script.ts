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

export interface Intent {
  menu: string;
  keywords_ar: string[];
  keywords_en: string[];
  ar: string;
  en: string;
}

export const GREETING_AR =
  "أهلاً بك في مكتبة نهضة مصر! 🌙\n" +
  "نحن الآن خارج مواعيد العمل (من الأحد إلى الخميس، 9 ص – 6 م)، " +
  "لكن يمكنني مساعدتك فورًا في الأسئلة الشائعة.\n\n" +
  "اكتب رقم الموضوع:\n" +
  "1️⃣ الشحن والتوصيل\n" +
  "2️⃣ طرق الدفع\n" +
  "3️⃣ الاسترجاع والاستبدال\n" +
  "4️⃣ تتبّع طلبي\n" +
  "5️⃣ الأقسام واللغات\n" +
  "6️⃣ مواعيد العمل والتواصل\n" +
  "7️⃣ الطلبات بالجملة والمدارس\n" +
  "0️⃣ أترك بياناتي ليتواصل معي موظف";

export const GREETING_EN =
  "Welcome to Nahdet Misr Bookstore! 🌙\n" +
  "We're currently outside working hours (Sun–Thu, 9 AM – 6 PM), " +
  "but I can help you right away with common questions.\n\n" +
  "Reply with a number:\n" +
  "1️⃣ Shipping & delivery\n" +
  "2️⃣ Payment methods\n" +
  "3️⃣ Returns\n" +
  "4️⃣ Track my order\n" +
  "5️⃣ Categories & languages\n" +
  "6️⃣ Working hours & contact\n" +
  "7️⃣ Bulk & school orders\n" +
  "0️⃣ Leave my details for an agent";

// Key order matters: when two intents tie on score, the earlier one wins
// (same behaviour as the tested reference implementation).
export const INTENTS: Record<string, Intent> = {
  shipping: {
    menu: "1",
    keywords_ar: ["شحن", "توصيل", "دليفري", "التوصيل", "سعر الشحن", "مصاريف", "يوصل",
      "مجاني", "محافظه", "المنصوره", "طنطا", "اسكندريه", "اسوان", "القليوبيه"],
    keywords_en: ["shipping", "delivery", "deliver", "ship", "postage", "free shipping"],
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
      "*مدة التوصيل:* 1 – 3 أيام عمل.\n" +
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
      "*Delivery time:* 1–3 business days.\n" +
      "*Courier:* Aramex. *Minimum order:* 150 EGP.\n" +
      "International delivery is not available.\n\n" +
      "If your governorate isn't listed, reply *0* to leave your details.",
  },
  payment: {
    menu: "2",
    keywords_ar: ["دفع", "الدفع", "ادفع", "فيزا", "كارت", "بطاقه", "تقسيط", "اقسط", "قسط",
      "فاليو", "فودافون كاش", "محفظه", "كاش", "الاستلام", "انستاباي", "ماستر كارد"],
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
  },
  returns: {
    menu: "3",
    keywords_ar: ["ارجاع", "استرجاع", "ارجع", "ارجعه", "استبدال", "استبدل", "ابدل",
      "بدل", "فلوسي", "استرداد", "مرتجع", "تالف", "مكسور", "غلط", "خطا"],
    keywords_en: ["return", "refund", "exchange", "damaged", "wrong item", "money back"],
    ar:
      "↩️ *الاسترجاع*\n\n" +
      "• *المدة:* خلال 14 يومًا من تاريخ الاستلام.\n" +
      "• *الشروط:* الكتب غير مستخدمة وغير تالفة وفي حالتها الأصلية، ومعها الفاتورة.\n" +
      "• *الاستبدال:* غير متاح حاليًا.\n" +
      "• *مصاريف شحن الإرجاع:* على العميل، إلا إذا كان المنتج تالفًا أو وصلك كتاب خاطئ — " +
      "في الحالتين دول المكتبة هي اللي بتتحمّلها.\n" +
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
  },
  track: {
    menu: "4",
    keywords_ar: ["فين طلبي", "طلبي", "تتبع", "اتتبع", "شحنتي", "وصل", "الاوردر", "اوردر",
      "حاله الطلب", "امتي يوصل"],
    keywords_en: ["where is my order", "track", "tracking", "my order", "order status"],
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
    keywords_ar: ["كتب", "كتاب", "اقسام", "قسم", "انجليزي", "فرنساوي", "فرنسي", "اطفال",
      "كوميكس", "ديزني", "مارفل", "روايات", "ترشيح", "اقترح", "سن", "سنه", "سنين"],
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
  },
  hours: {
    menu: "6",
    keywords_ar: ["مواعيد", "ميعاد", "شغالين", "فاتحين", "تليفون", "رقم", "ايميل",
      "تواصل", "الخط الساخن", "امتي"],
    keywords_en: ["hours", "open", "closed", "contact", "phone", "email", "hotline"],
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
};

export const HANDOFF_KEYWORDS_AR = ["موظف", "انسان", "بشري", "مندوب", "مدير", "شكوي", "حد يكلمني",
  "عايز اكلم", "مسئول", "مسؤول", "بني ادم"];
export const HANDOFF_KEYWORDS_EN = ["agent", "human", "representative", "manager", "complaint",
  "speak to someone", "call me", "supervisor", "person"];

export const HANDOFF_AR =
  "تمام ✅ سجّلت طلبك وهيتم تحويلك لفريق خدمة العملاء.\n\n" +
  "علشان نساعدك بسرعة، من فضلك اكتب في رسالة واحدة:\n" +
  "• *الاسم بالكامل*\n" +
  "• *رقم الطلب* (لو عندك)\n" +
  "• *رقم الهاتف*\n" +
  "• *تفاصيل المشكلة أو الاستفسار*\n\n" +
  "الفريق هيتواصل معاك أول ما الدوام يبدأ (الأحد – الخميس، 9 ص – 6 م). " +
  `وللأمور العاجلة: الخط الساخن ${HOTLINE}. شكرًا لصبرك! 🙏`;

export const HANDOFF_EN =
  "Got it ✅ I'm passing you to our customer-care team.\n\n" +
  "To help us reach you faster, please send in one message:\n" +
  "• *Full name*\n" +
  "• *Order number* (if you have one)\n" +
  "• *Phone number*\n" +
  "• *Details of your question or issue*\n\n" +
  "The team will get back to you as soon as we're back (Sun–Thu, 9 AM – 6 PM). " +
  `For anything urgent: hotline ${HOTLINE}. Thanks for your patience! 🙏`;

export const FALLBACK_AR =
  "معلش، مش فاهم سؤالك بالظبط 🤔\n\n" +
  "جرّب تكتب رقم من دول:\n" +
  "1️⃣ الشحن • 2️⃣ الدفع • 3️⃣ الاسترجاع • 4️⃣ تتبّع طلبي\n" +
  "5️⃣ الأقسام • 6️⃣ مواعيد العمل • 7️⃣ طلبات الجملة\n" +
  "0️⃣ أترك بياناتي ليتواصل معي موظف";

export const FALLBACK_EN =
  "Sorry, I didn't quite catch that 🤔\n\n" +
  "Try one of these numbers:\n" +
  "1️⃣ Shipping • 2️⃣ Payment • 3️⃣ Returns • 4️⃣ Track order\n" +
  "5️⃣ Categories • 6️⃣ Working hours • 7️⃣ Bulk orders\n" +
  "0️⃣ Leave my details for an agent";

export const FOOTER_AR = "\n\n———\nمحتاج حاجة تانية؟ اكتب رقم من القائمة، أو *0* للتحدث مع موظف.";
export const FOOTER_EN = "\n\n———\nAnything else? Reply with a menu number, or *0* to reach an agent.";
