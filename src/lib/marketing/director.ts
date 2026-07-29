// The "Marketing Director" layer — turns a detected genre + real store data
// into a buyer persona, an organic-vs-paid decision, and full media-buyer ad
// configurations per platform (Egyptian market, EGP budgets). Pure TS: used
// by the free built-in engine, and its shape doubles as the JSON contract the
// Claude engine must return. All content is bilingual — the plan renders in
// the app UI's language while the post copy language is chosen separately.

export type PlanLang = "ar" | "en";
type Bi = { ar: string; en: string };
const pick = (b: Bi, l: PlanLang) => b[l];
const pickAll = (arr: Bi[], l: PlanLang) => arr.map((b) => b[l]);

export interface AdConfig {
  platform: string;
  objective: string;
  age: string;
  gender: string;
  geo: string;
  interests: string[];
  placements: string;
  budget: string;
  duration: string;
  creative: string;
  cta: string;
  schedule: string;
  tips: string[];
}

export interface MarketingPlan {
  persona: {
    name: string;
    age: string;
    gender: string;
    description: string;
    pains: string[];
    motivations: string[];
  };
  decision: { mode: "ad" | "organic" | "both"; reason: string };
  platforms: AdConfig[];
  retargeting: string[];
  abTests: string[];
  multiBook: string;
  bundleTitles?: string[];
  occasion?: string; // nearest fitting Egyptian retail occasion + advice
}

interface GenreDirector {
  persona: {
    name: Bi; age: string; gender: Bi; description: Bi;
    pains: Bi[]; motivations: Bi[];
  };
  decisionMode: "ad" | "organic" | "both";
  decisionReason: Bi;
  age: string;
  gender: Bi;
  interests: string[];
  tiktok: boolean;
  multiBook: Bi;
}

const DIRECTORS: Record<string, GenreDirector> = {
  kids: {
    persona: {
      name: { ar: "الأم المهتمة بالتربية", en: "The engaged mom" },
      age: "25–45",
      gender: {
        ar: "إناث بالأساس (80%) — والأب كمشترٍ ثانوي في المواسم",
        en: "Primarily female (80%) — dads buy in gifting seasons",
      },
      description: {
        ar: "أم لطفل/أطفال في سن 3–12، بتدوّر على بدائل مفيدة لشاشة الموبايل، وبتتأثر جدًا بتوصيات الأمهات التانية والمحتوى اللي يظهر فايدة تربوية واضحة. بتشتري في مواسم: نتيجة الامتحانات، الإجازة الصيفية، العودة للمدارس، رمضان.",
        en: "Mother of kids aged 3–12, actively looking for useful alternatives to screen time. Heavily influenced by other moms' recommendations and by content that shows a clear educational benefit. Buys in seasons: exam results, summer break, back-to-school, Ramadan.",
      },
      pains: [
        { ar: "الطفل قاعد على الشاشات طول اليوم ومش بيقرأ", en: "Kids glued to screens all day, not reading" },
        { ar: "صعوبة إيجاد محتوى عربي ممتع وآمن ومناسب للسن", en: "Hard to find fun, safe, age-appropriate Arabic content" },
        { ar: "وقت النوم/الفراغ محتاج نشاط هادي ومفيد", en: "Bedtime/downtime needs a calm, useful activity" },
      ],
      motivations: [
        { ar: "تحس إنها أم بتستثمر في طفلها", en: "Feeling she's investing in her child" },
        { ar: "قيمة تربوية واضحة (قيم، لغة، خيال)", en: "Clear educational value (values, language, imagination)" },
        { ar: "سعر مناسب + توصيل للباب = قرار سريع", en: "Fair price + door delivery = fast decision" },
      ],
    },
    decisionMode: "both",
    decisionReason: {
      ar: "كتب الأطفال أوسع جمهور شرائي على ميتا في مصر وأعلى معدل تحويل — انشر أورجانيك الأول لاختبار الـ hook، وبعد 24 ساعة اعمل حملة مبيعات مستقلة + Boost لأحسن بوست. ده تصنيف يستاهل ميزانية إعلانية دائمة.",
      en: "Children's books are the widest buying audience on Meta in Egypt with the highest conversion rate — post organic first to test the hook, then after 24h launch a dedicated Sales campaign + boost the best post. This category deserves an always-on ad budget.",
    },
    age: "25–45",
    gender: { ar: "إناث (جرّب Broad بعد أول نتائج)", en: "Female (test Broad after first results)" },
    interests: [
      "Parenting", "Motherhood", "Toddlers", "Preschool", "Children's literature",
      "Early childhood education", "سوبر ماما (SuperMama)", "تربية الأطفال",
    ],
    tiktok: true,
    multiBook: {
      ar: "اعمل بوست/إعلان Carousel «مكتبة طفلك في الإجازة» — كل كارت غلاف كتاب بعمر مقترح (٣+، ٦+، ٩+)، واختم بكارت عرض المجموعة بسعر مخفض. المجموعات بترفع متوسط قيمة الطلب (AOV) بوضوح في فئة الأطفال.",
      en: "Run a “Your child's holiday library” carousel — each card a cover with a suggested age (3+, 6+, 9+), closing with a discounted-bundle card. Bundles clearly lift AOV in the kids category.",
    },
  },
  religion: {
    persona: {
      name: { ar: "الباحث عن السكينة", en: "The seeker of serenity" },
      age: "18–55",
      gender: { ar: "الجنسين — الإناث أعلى تفاعلًا وشراءً", en: "Both — women engage and buy more" },
      description: {
        ar: "جمهور واسع بيتفاعل مع المحتوى الإيماني القصير، وبيشتري الكتاب اللي يحس إنه «هيغير حاجة جواه». مواسم الذروة: رمضان، العشر الأوائل، بداية السنة الهجرية، وبعد الأزمات الشخصية.",
        en: "A broad audience that engages with short faith content and buys the book they feel will “change something inside”. Peak seasons: Ramadan, first ten days of Dhul-Hijjah, Hijri new year, and after personal hardships.",
      },
      pains: [
        { ar: "ضغط وقلق يومي ومحتاج راحة قلب", en: "Daily stress and anxiety; needs peace of heart" },
        { ar: "بُعد عن القراءة الدينية وعايز نقطة بداية سهلة", en: "Away from religious reading; wants an easy starting point" },
        { ar: "محتوى ديني كتير لكن مش موثوق", en: "Plenty of religious content, little of it trustworthy" },
      ],
      motivations: [
        { ar: "راحة نفسية وطمأنينة", en: "Inner comfort and reassurance" },
        { ar: "هدية ذات معنى (أعلى فئة إهداء)", en: "A meaningful gift (top gifting category)" },
        { ar: "الثقة في دار نشر معروفة", en: "Trust in a known publisher" },
      ],
    },
    decisionMode: "organic",
    decisionReason: {
      ar: "المحتوى الديني أعلى تصنيف في المشاركة (Shares) الأورجانيك — اقتباس قوي ممكن ينتشر لوحده ويجيب مبيعات ببلاش. انشر أورجانيك بكثافة، وخصص Boost صغير (100–150 ج/يوم) فقط للبوستات اللي تعدّت متوسط تفاعلك، وكثّف قبل رمضان بحملة مبيعات كاملة.",
      en: "Religious content is the top-shared category organically — a strong quote can spread by itself and sell for free. Post organic heavily, boost only posts that beat your engagement average (100–150 EGP/day), and go full Sales campaign before Ramadan.",
    },
    age: "18–55",
    gender: { ar: "الجنسين", en: "All genders" },
    interests: ["Islam", "Quran", "Islamic books", "Ramadan", "مصطفى حسني", "عمرو خالد", "أدهم شرقاوي"],
    tiktok: true,
    multiBook: {
      ar: "بوست «حقيبة رمضان/السكينة» — 3 كتب إيمانية كباقة واحدة بسعر موحد، مع Carousel كل كارت رسالة الكتاب في سطر.",
      en: "A “Ramadan/serenity bag” post — 3 faith books as one fixed-price bundle, carousel with each book's one-line message.",
    },
  },
  selfdev: {
    persona: {
      name: { ar: "الطموح المشغول", en: "The busy achiever" },
      age: "20–40",
      gender: { ar: "الجنسين بتوازن تقريبي", en: "Roughly balanced" },
      description: {
        ar: "موظف/طالب جامعي في القاهرة والإسكندرية والمدن الكبرى، بيستهلك محتوى إنتاجية وبودكاست، وعنده إحساس دائم إنه «متأخر عن أقرانه». بيشتري بدافع لحظة حماس — الإعلان لازم يلحق اللحظة دي بـ CTA مباشر.",
        en: "Employee or university student in Cairo, Alexandria and major cities. Consumes productivity content and podcasts, with a constant feeling of “falling behind peers”. Buys on a moment of motivation — the ad must catch that moment with a direct CTA.",
      },
      pains: [
        { ar: "مشتت ومش قادر يلتزم بعادات", en: "Distracted; can't stick to habits" },
        { ar: "قلق من المستقبل المهني والمادي", en: "Anxious about career and finances" },
        { ar: "بيبدأ كتب ومبيكملهاش", en: "Starts books and never finishes them" },
      ],
      motivations: [
        { ar: "نتيجة عملية سريعة («طبّق من أول فصل»)", en: "Fast practical results (“apply from chapter one”)" },
        { ar: "التميز في الشغل/الدراسة", en: "Standing out at work/school" },
        { ar: "محتوى مُلهم يتشارك منه اقتباسات", en: "Inspiring, quotable content" },
      ],
    },
    decisionMode: "ad",
    decisionReason: {
      ar: "تطوير الذات فئة «طلب مُثبت» على ميتا في مصر — الجمهور بيشتري من الإعلان مباشرة لو الرسالة نتيجة ملموسة. ادخل بحملة مبيعات من اليوم الأول مع الأورجانيك كدعم، وركّز الإنفاق أيام الأحد–الأربعاء (قرارات بداية الأسبوع).",
      en: "Self-development is a proven-demand category on Meta in Egypt — this audience buys straight from the ad when the message promises a tangible result. Launch a Sales campaign from day one with organic as support, and weight spend Sunday–Wednesday (start-of-week decisions).",
    },
    age: "20–40",
    gender: { ar: "الجنسين", en: "All genders" },
    interests: ["Self-improvement", "Personal development", "Entrepreneurship", "Productivity", "Psychology", "ثمانية بودكاست", "علي محمد علي", "دكتور أحمد عمارة"],
    tiktok: true,
    multiBook: {
      ar: "Carousel «عدة النسخة الأحسن منك» — كل كارت كتاب بيحل مشكلة واحدة محددة (تشتت/عادات/ثقة)، والكارت الأخير الباقة كاملة.",
      en: "A “better-you toolkit” carousel — each card one book solving one specific problem (focus/habits/confidence), last card the full bundle.",
    },
  },
  novel: {
    persona: {
      name: { ar: "قارئة الروايات الشغوفة", en: "The passionate novel reader" },
      age: "18–35",
      gender: { ar: "إناث بالأساس (70%+) — مجتمع BookTok/Bookstagram", en: "Mostly female (70%+) — BookTok/Bookstagram community" },
      description: {
        ar: "قارئة نهمة بتتابع مجتمعات القراءة (أبجد، Goodreads، جروبات الروايات)، بتشتري أكتر من رواية في الشهر، وبتتأثر بالاقتباسات والـ aesthetics أكتر من الوصف المباشر. معرض الكتاب حدثها السنوي الأهم.",
        en: "An avid reader active in reading communities (Abjjad, Goodreads, novel groups). Buys multiple novels a month and responds to quotes and aesthetics more than plot descriptions. The book fair is her main annual event.",
      },
      pains: [
        { ar: "خلصت روايتها ومش لاقية «الجاية»", en: "Finished her novel; can't find “the next one”" },
        { ar: "خايفة تشتري رواية تطلع ضعيفة", en: "Afraid of buying a weak novel" },
        { ar: "الميزانية محدودة والأسعار بتزيد", en: "Limited budget while prices rise" },
      ],
      motivations: [
        { ar: "الانغماس في حكاية تنسيها اليوم", en: "Getting lost in a story" },
        { ar: "الانتماء لمجتمع القراء (تصوير الكتاب ومشاركته)", en: "Belonging to the reader community (shelfies!)" },
        { ar: "اقتباس لمس حاجة جواها", en: "A quote that touched something" },
      ],
    },
    decisionMode: "both",
    decisionReason: {
      ar: "الروايات بتنجح بالاقتباس الأورجانيك أولًا (أعلى Save/Share)، لكن فيه جمهور شرائي واضح تستهدفه بالإعلان. انشر الاقتباس أورجانيك، وحوّل الأعلى تفاعلًا لإعلان مبيعات خلال 48 ساعة وجمهور اهتمامات القراءة.",
      en: "Novels win with organic quotes first (highest saves/shares), but there's a clear buying audience for ads too. Post the quote organically, then turn the top performer into a Sales ad within 48h targeting reading interests.",
    },
    age: "18–35",
    gender: { ar: "إناث أولًا، وسّع بعد النتائج", en: "Female first; broaden after results" },
    interests: ["Novels", "Fiction books", "Goodreads", "Reading (books)", "Arabic literature", "أبجد", "أحمد خالد توفيق", "معرض القاهرة الدولي للكتاب"],
    tiktok: true,
    multiBook: {
      ar: "بوست «قائمة قراءة الشهر» — 4 روايات بجملة تشويقية لكل واحدة من غير حرق، مع تصويت في التعليقات «هتبدأي بأنهي؟» لرفع التفاعل.",
      en: "A “monthly reading list” post — 4 novels with one spoiler-free teaser line each, plus a comments poll (“which first?”) to lift engagement.",
    },
  },
  history: {
    persona: {
      name: { ar: "المثقف الفضولي", en: "The curious intellectual" },
      age: "25–55",
      gender: { ar: "ذكور أعلى شراءً (60%+)", en: "Male-skewed buyers (60%+)" },
      description: {
        ar: "مهتم بالتاريخ والحضارة المصرية، بيتابع صفحات المعلومات والوثائقيات، وبيحب يبان مطّلعًا وسط دايرته. بيتفاعل مع «المعلومة الصادمة» أو «اللي ماحكوهالكش في المدرسة».",
        en: "Into history and Egyptian civilization, follows facts pages and documentaries, likes appearing well-read in his circle. Responds to the “shocking fact” or “what school never told you”.",
      },
      pains: [
        { ar: "محتوى تاريخي سطحي أو غير موثوق منتشر", en: "Shallow or unreliable history content everywhere" },
        { ar: "عايز عمق من غير لغة أكاديمية جافة", en: "Wants depth without dry academic prose" },
      ],
      motivations: [
        { ar: "معلومة يحكيها لغيره", en: "A fact worth retelling" },
        { ar: "فهم الحاضر عبر الماضي", en: "Understanding the present through the past" },
        { ar: "اقتناء مكتبة رصينة", en: "Building a serious library" },
      ],
    },
    decisionMode: "organic",
    decisionReason: {
      ar: "جمهور التاريخ متفاعل جدًا أورجانيك (تعليقات ونقاشات) لكنه أضيق شرائيًا — ابدأ بسلسلة بوستات معلومات من الكتاب، ولو بوست كسر متوسط التفاعل ×2 اعمله Boost تفاعل 100 ج/يوم لمدة 3 أيام ثم أعد التقييم.",
      en: "History audiences engage heavily organically (comments, debates) but buy narrower — start a facts series from the book, and if a post breaks 2× your engagement average, boost it at 100 EGP/day for 3 days, then reassess.",
    },
    age: "25–55",
    gender: { ar: "الجنسين مع ميل ذكوري", en: "Both, male-skewed" },
    interests: ["History", "Ancient Egypt", "Egyptology", "Documentary films", "الوثائقية", "تاريخ مصر"],
    tiktok: false,
    multiBook: {
      ar: "سلسلة «مكتبة التاريخ» — بوست أسبوعي لكل كتاب بمعلومة مدهشة منه، وفي الآخر بوست المجموعة كاملة.",
      en: "A “history shelf” series — one weekly post per book with a striking fact from it, closing with the full-collection post.",
    },
  },
  general: {
    persona: {
      name: { ar: "القارئ العام", en: "The general reader" },
      age: "20–45",
      gender: { ar: "الجنسين", en: "All genders" },
      description: {
        ar: "جمهور عام مهتم بالقراءة والثقافة، بيشتري بدافع الفضول أو الإهداء، ويتأثر بالتقييمات وتجارب القراء.",
        en: "A general audience interested in reading and culture, buying out of curiosity or for gifting, influenced by ratings and reader experiences.",
      },
      pains: [
        { ar: "مش عارف يختار إيه من الزحمة", en: "Overwhelmed by choice" },
        { ar: "وقت محدود للقراءة", en: "Limited reading time" },
      ],
      motivations: [
        { ar: "توصية واضحة ومختصرة «ليه الكتاب ده»", en: "A clear, short “why this book”" },
        { ar: "سهولة الطلب والتوصيل", en: "Easy ordering and delivery" },
      ],
    },
    decisionMode: "organic",
    decisionReason: {
      ar: "من غير تصنيف واضح، ابدأ أورجانيك واختبر رسالتين مختلفتين (فايدة الكتاب / اقتباس منه)؛ اللي يكسب تفاعلًا حوّله لإعلان مبيعات بميزانية اختبار 150 ج/يوم.",
      en: "Without a clear genre, start organic and test two different messages (the book's benefit vs a quote); turn the engagement winner into a Sales ad at a 150 EGP/day test budget.",
    },
    age: "20–45",
    gender: { ar: "الجنسين", en: "All genders" },
    interests: ["Books", "Reading (books)", "Literature", "Book fairs", "معرض القاهرة الدولي للكتاب"],
    tiktok: false,
    multiBook: {
      ar: "بوست «اخترنالك» — 3 كتب من أقسام مختلفة كتوصيات المتجر للأسبوع.",
      en: "A “picked for you” post — 3 books from different sections as the store's weekly recommendations.",
    },
  },
};

export function buildMarketingPlan(opts: {
  genreKey: string;
  titles: string[];
  topCities?: string[];
  buyUrl?: string;
  bundleTitles?: string[];
  bestHours?: string;  // real posting-time signal from the store's own orders
  occasion?: string;   // nearest fitting occasion hint (occasions.ts)
  lang?: PlanLang;     // plan/instructions language (follows the app UI)
}): MarketingPlan {
  const l: PlanLang = opts.lang === "en" ? "en" : "ar";
  const d = DIRECTORS[opts.genreKey] ?? DIRECTORS.general;
  const multi = opts.titles.length > 1;
  const cities = opts.topCities?.length
    ? opts.topCities.join(l === "ar" ? "، " : ", ")
    : l === "ar" ? "القاهرة، الجيزة، الإسكندرية" : "Cairo, Giza, Alexandria";
  const schedule = opts.bestHours
    ? l === "ar"
      ? `${opts.bestHours} (محسوبة من طلبات متجرك الفعلية آخر 90 يوم)`
      : `${opts.bestHours} (computed from your store's real orders, last 90 days)`
    : l === "ar"
      ? "التوزيع طوال اليوم مع ذروة تفاعل الكتب 7–11 مساءً؛ راقب تقرير الساعات بعد أسبوع وخصّص لو فيه نمط واضح"
      : "Run all day with the books-niche peak at 7–11 PM; check the hourly report after a week and dayparts if a clear pattern shows";

  const metaCreative = multi
    ? {
        ar: "إعلان Carousel: كل كارت غلاف كتاب (من مولّد التصاميم — مقاس Square)، أول كارت هو الأقوى بيعًا، وآخر كارت عرض المجموعة. عنوان كل كارت = الـ hook بتاع الكتاب.",
        en: "Carousel ad: each card a book cover (from the design engine — Square format), first card the strongest seller, last card the bundle offer. Card headline = the book's hook.",
      }
    : {
        ar: "استخدم التصاميم المولّدة من الاستوديو: Square للفيد، Story 9:16 للستوري والريلز، Landscape للـ Link Ad. جرّب نسخة الغلاف الصافي ونسخة الاقتباس.",
        en: "Use the Studio's generated designs: Square for feed, Story 9:16 for stories/reels, Landscape for the link ad. Test the clean-cover layout vs the quote-card layout.",
      };

  const meta: AdConfig = {
    platform: l === "ar" ? "Meta (Facebook + Instagram) — الحملة الأساسية" : "Meta (Facebook + Instagram) — main campaign",
    objective: l === "ar"
      ? "المبيعات (Sales) مع التحسين على Purchase — ولو البيكسل مش متركّب صح مؤقتًا: التفاعل (Engagement) للبوستات + رسائل واتساب للطلب"
      : "Sales objective optimizing for Purchase — if the pixel isn't reliable yet, run Engagement for posts + WhatsApp messages for ordering",
    age: d.age,
    gender: pick(d.gender, l),
    geo: l === "ar"
      ? `مصر — والأولوية في الاستهداف الجغرافي: ${cities} (أعلى محافظاتك مبيعًا فعليًا)`
      : `Egypt — prioritize: ${cities} (your actual top-selling governorates)`,
    interests: d.interests,
    placements: l === "ar"
      ? "ابدأ Advantage+ Placements؛ لو الـ CPM عالي بعد 3 أيام حوّل يدوي: Facebook Feed + Instagram Feed + Stories + Reels فقط (استبعد Audience Network)"
      : "Start with Advantage+ Placements; if CPM runs high after 3 days go manual: Facebook Feed + Instagram Feed + Stories + Reels only (exclude Audience Network)",
    budget: l === "ar"
      ? "ميزانية اختبار 200–300 ج.م/يوم على مستوى الحملة (CBO) بـ 2–3 مجموعات إعلانية. قاعدة الإيقاف: مجموعة صرفت ضعف متوسط قيمة الطلب من غير أي Purchase → أوقفها. قاعدة التوسيع: ROAS ≥ 2.5 لمدة 48 ساعة → زوّد 20% كل يومين (مش أكتر، عشان الـ Learning Phase)"
      : "Test budget 200–300 EGP/day at campaign level (CBO) with 2–3 ad sets. Kill rule: an ad set that spends 2× AOV with zero purchases → pause it. Scale rule: ROAS ≥ 2.5 for 48h → +20% every 2 days (no more, to protect the learning phase)",
    duration: l === "ar"
      ? "اختبار 4–5 أيام، ثم إبقاء الرابح شغال دائمًا (Always-on) مع تجديد الكرياتيف كل 2–3 أسابيع لما الـ Frequency يعدي 3"
      : "4–5 day test, then keep the winner always-on, refreshing creative every 2–3 weeks once frequency passes 3",
    creative: pick(metaCreative, l),
    cta: l === "ar"
      ? "زر «تسوّق الآن» (Shop Now) → رابط الكتاب مباشرة مع UTM: utm_source=facebook&utm_medium=paid-social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}"
      : "“Shop Now” button → direct book link with UTM: utm_source=facebook&utm_medium=paid-social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}",
    schedule,
    tips: pickAll([
      {
        ar: "استبعد المشترين آخر 30 يوم من حملات الـ Prospecting (Custom Audience من البيكسل أو من ملف عملائك)",
        en: "Exclude last-30-day purchasers from prospecting (Custom Audience from the pixel or your customer file)",
      },
      {
        ar: "الجمهور الأعرض بيكسب في مصر غالبًا — جرّب Adset بدون اهتمامات (Broad) جنب Adset الاهتمامات وسيب التحسين يشتغل",
        en: "Broad usually wins in Egypt — run a no-interests (Broad) ad set next to the interests one and let optimization work",
      },
      {
        ar: "3 إعلانات كحد أقصى داخل كل مجموعة — أكتر من كده بيشتّت الميزانية",
        en: "Max 3 ads per ad set — more just fragments the budget",
      },
      {
        ar: "تأكد إن حدث Purchase بيتسجل صح (خصوصًا الدفع بالكارت — فيه فجوة تتبع معروفة عندك في الدفع الإلكتروني)",
        en: "Verify the Purchase event fires correctly (especially card payments — your store has a known online-payment tracking gap)",
      },
    ], l),
  };

  const boost: AdConfig = {
    platform: l === "ar" ? "Boost للبوست الأورجاني (من داخل الاستوديو)" : "Organic post boost (from inside the Studio)",
    objective: l === "ar"
      ? "التفاعل (Engagement) — الهدف إثبات اجتماعي (لايكات/تعليقات) يخلي إعلان المبيعات أرخص"
      : "Engagement — social proof (reactions/comments) that makes the Sales ad cheaper",
    age: d.age,
    gender: pick(d.gender, l),
    geo: l === "ar" ? `مصر — ${cities}` : `Egypt — ${cities}`,
    interests: d.interests.slice(0, 4),
    placements: l === "ar" ? "تلقائي" : "Automatic",
    budget: l === "ar"
      ? "100–150 ج.م/يوم فقط — الـ Boost مكمّل مش بديل لحملة المبيعات"
      : "Only 100–150 EGP/day — the boost complements the Sales campaign, it doesn't replace it",
    duration: l === "ar"
      ? "3 أيام ثم قيّم: تفاعل فوق متوسط صفحتك ×2 → مدّد؛ أقل → أوقف"
      : "3 days then assess: engagement above 2× your page average → extend; below → stop",
    creative: l === "ar"
      ? "نفس البوست المنشور بدون تعديل (الـ Boost بيحافظ على التفاعلات المتراكمة)"
      : "The published post as-is (boosting keeps the accumulated engagement)",
    cta: l === "ar" ? "بدون زر — خلي البوست طبيعي" : "No button — keep the post native",
    schedule: l === "ar" ? "تلقائي" : "Automatic",
    tips: pickAll([
      {
        ar: "اعمل Boost فقط للبوست اللي أثبت نفسه أورجانيك خلال أول 24 ساعة — متدفعش لبوست ضعيف",
        en: "Boost only a post that proved itself organically in the first 24h — never pay for a weak post",
      },
    ], l),
  };

  const platforms = [meta, boost];
  if (d.tiktok) {
    platforms.push({
      platform: l === "ar" ? "TikTok (خطوة تالية — يدوي حاليًا)" : "TikTok (next step — manual for now)",
      objective: l === "ar"
        ? "فيديو أورجانيك أولًا: 15–30 ثانية «ورقّة وقولّة» — افتح الكتاب واقرأ الاقتباس بصوت مع موسيقى هادئة، أو unboxing لطلبية"
        : "Organic video first: 15–30s page-and-quote clips — open the book and read the quote aloud over calm music, or order unboxings",
      age: d.age,
      gender: pick(d.gender, l),
      geo: l === "ar" ? "مصر" : "Egypt",
      interests: ["BookTok", l === "ar" ? "اقتباسات" : "Quotes", l === "ar" ? "كتب" : "Books"],
      placements: "For You",
      budget: l === "ar"
        ? "صفر — أورجانيك. لو فيديو عدّى 10k مشاهدة، ساعتها فكّر في Spark Ads عليه"
        : "Zero — organic. If a video passes 10k views, consider Spark Ads on it",
      duration: l === "ar" ? "3 فيديوهات/أسبوع كإيقاع تجريبي لمدة شهر" : "3 videos/week as a trial cadence for a month",
      creative: l === "ar"
        ? "الموبايل كافي — الأصالة بتكسب الإنتاج المصقول على تيك توك. اكتب الاقتباس Text overlay"
        : "A phone is enough — authenticity beats polish on TikTok. Put the quote as a text overlay",
      cta: l === "ar" ? "«الرابط في البايو» + رد على التعليقات بروابط" : "“Link in bio” + reply to comments with links",
      schedule: l === "ar" ? "انشر 8–11 مساءً" : "Post 8–11 PM",
      tips: pickAll([
        {
          ar: "#BookTok بالعربي شغّال فعليًا في مصر — كتب الروايات وتطوير الذات أكبر المستفيدين",
          en: "Arabic #BookTok genuinely works in Egypt — novels and self-development benefit most",
        },
      ], l),
    });
  }

  return {
    persona: {
      name: pick(d.persona.name, l),
      age: d.persona.age,
      gender: pick(d.persona.gender, l),
      description: pick(d.persona.description, l),
      pains: pickAll(d.persona.pains, l),
      motivations: pickAll(d.persona.motivations, l),
    },
    decision: { mode: d.decisionMode, reason: pick(d.decisionReason, l) },
    platforms,
    retargeting: pickAll([
      {
        ar: "جمهور تفاعل الصفحة/الإنستجرام آخر 30 يوم → إعلان مبيعات مباشر (أرخص جمهور عندك)",
        en: "Page/Instagram engagers, last 30 days → direct Sales ad (your cheapest audience)",
      },
      {
        ar: "زوّار الموقع آخر 14 يوم بدون شراء → إعلان بعرض/كود خصم",
        en: "Site visitors, last 14 days, no purchase → ad with an offer/discount code",
      },
      {
        ar: "جمهور السلات المتروكة: صدّره جاهزًا من صفحة «السلات المتروكة» في التطبيق (زر Meta Custom Audience) — أعلى جمهور نية شراء عندك",
        en: "Abandoned-cart audience: export it ready-made from the app's Abandoned Carts page (Meta Custom Audience button) — your highest-intent audience",
      },
      {
        ar: "Lookalike 1% مصر من ملف أفضل عملائك: صدّر الـ seed من صفحة العملاء (عملاء 3+ طلبات) وارفعه Custom Audience ثم اعمل منه Lookalike",
        en: "1% Egypt Lookalike from your best customers: export the seed from the Customers page (3+ orders), upload as a Custom Audience, then build the Lookalike",
      },
    ], l),
    abTests: pickAll([
      { ar: "Hook A (سؤال) ضد Hook B (اقتباس من الكتاب) — نفس التصميم", en: "Hook A (question) vs Hook B (book quote) — same design" },
      { ar: "تصميم الغلاف الصافي ضد تصميم الاقتباس — نفس النص", en: "Clean-cover design vs quote-card design — same copy" },
      { ar: "جمهور Broad بدون اهتمامات ضد جمهور الاهتمامات", en: "Broad (no interests) vs interests audience" },
      multi
        ? { ar: "Carousel المجموعة ضد إعلان الكتاب الأقوى منفردًا", en: "Bundle carousel vs the strongest single-book ad" }
        : { ar: "صورة Square ضد فيديو بسيط (الغلاف بحركة Zoom بطيئة)", en: "Square image vs a simple video (slow-zoom cover)" },
    ], l),
    multiBook: pick(d.multiBook, l),
    bundleTitles: opts.bundleTitles,
    occasion: opts.occasion || undefined,
  };
}
