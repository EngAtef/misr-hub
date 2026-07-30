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
  steps?: string[]; // numbered manual-setup walkthrough (Ads Manager / Google Ads UI)
}

export interface KeywordPlan {
  transactional: string[]; // buy-intent keywords for Search campaigns
  informational: string[]; // content/blog-intent keywords (SEO capture)
  negatives: string[];     // account/campaign negative keywords
  research: string[];      // how to expand the list yourself
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
  occasion?: string;   // nearest fitting Egyptian retail occasion + advice
  seo?: string[];      // on-page/technical SEO checklist for the book's product page
  keywords?: KeywordPlan;
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
        ar: "تحديث Andromeda 2026: الكرياتيف بقى 56% من الأداء — التنويع الحقيقي (زوايا وأفكار مختلفة مش نفس الصورة بعنوان جديد) هو أهم رافعة. استهدف 8–12 كرياتيف مختلف فعلًا في الحملة",
        en: "Andromeda 2026: creative now drives ~56% of performance — genuine diversity (different angles/concepts, not the same visual with a new headline) is the #1 lever. Aim for 8–12 truly distinct creatives per campaign",
      },
      {
        ar: "فيديو 9:16 الرأسي هو الفورمات الأولى في 2026 — حتى الغلاف بحركة Zoom بطيئة + الاقتباس كنص أحسن من صورة ثابتة",
        en: "9:16 vertical video is 2026's priority format — even a slow-zoom cover with the quote as text overlay beats a static image",
      },
      {
        ar: "استبعد المشترين آخر 30 يوم من حملات الـ Prospecting (Custom Audience من البيكسل أو من ملف عملائك)",
        en: "Exclude last-30-day purchasers from prospecting (Custom Audience from the pixel or your customer file)",
      },
      {
        ar: "الجمهور الأعرض بيكسب — سيب Advantage+ Audience شغال، والاهتمامات كاقتراح (suggestion) مش قيد",
        en: "Broad wins — keep Advantage+ Audience on, with interests as a suggestion, not a constraint",
      },
      {
        ar: "جدّد الكرياتيف كل 2–3 أسابيع أو لما الـ Frequency يعدي 3 — التعب الإبداعي أسرع في عصر Andromeda",
        en: "Refresh creative every 2–3 weeks or once frequency passes 3 — creative fatigue hits faster in the Andromeda era",
      },
      {
        ar: "تأكد إن حدث Purchase بيتسجل صح (خصوصًا الدفع بالكارت — فيه فجوة تتبع معروفة عندك في الدفع الإلكتروني) + فعّل Conversions API مش البيكسل بس",
        en: "Verify the Purchase event fires correctly (especially card payments — your store has a known online-payment tracking gap) + use the Conversions API, not just the pixel",
      },
    ], l),
    steps: pickAll([
      {
        ar: "افتح Ads Manager → Create → الهدف Sales → اختار Advantage+ sales campaign (الهيكل القياسي في 2026)",
        en: "Open Ads Manager → Create → objective: Sales → choose Advantage+ sales campaign (the standard 2026 structure)",
      },
      {
        ar: "مستوى الحملة: الميزانية اليومية 200–300 ج.م، الدولة مصر، واستورد جمهور المشترين 30 يوم كـ Existing customers للاستبعاد",
        en: "Campaign level: daily budget 200–300 EGP, country Egypt, and upload your 30-day purchasers as Existing customers for exclusion",
      },
      {
        ar: "مستوى الإعلان: ارفع 8–12 كرياتيف مختلف (المقاسات التلاتة من الاستوديو + فيديو رأسي لو متاح)، فعّل Advantage+ creative",
        en: "Ad level: upload 8–12 distinct creatives (the Studio's 3 formats + vertical video if available), enable Advantage+ creative",
      },
      {
        ar: "الـ Primary text = بوست الفيسبوك من الاستوديو، Headline = الـ hook، الزر Shop Now، واللينك برابط UTM",
        en: "Primary text = the Studio's Facebook post, headline = the hook, button Shop Now, link with the UTM template",
      },
      {
        ar: "قبل التشغيل: Events Manager → اتأكد إن Purchase أخضر ومتسجل من آخر 24 ساعة، وراجع الـ Frequency وقواعد الإيقاف/التوسيع بعد 48 ساعة",
        en: "Before launch: Events Manager → confirm Purchase is green and firing within 24h; review frequency and the kill/scale rules after 48h",
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

  const mainTitle = (opts.titles[0] ?? "").trim();

  const google: AdConfig = {
    platform: l === "ar" ? "Google Ads (بحث + Performance Max)" : "Google Ads (Search + Performance Max)",
    objective: l === "ar"
      ? "المبيعات — حملة Search تلتقط نية الشراء الجاهزة (اسم الكتاب/المؤلف) + حملة Performance Max بالـ Merchant Center feed (إعلانات Shopping ≈ 60–65% من نقرات الريتيل في 2026)"
      : "Sales — a Search campaign captures ready buy-intent (book/author name) + a Performance Max campaign on the Merchant Center feed (Shopping ads ≈ 60–65% of retail clicks in 2026)",
    age: l === "ar" ? "الكل (Google يستهدف بالنية مش بالديموغرافيا)" : "All (Google targets intent, not demographics)",
    gender: l === "ar" ? "الكل" : "All",
    geo: l === "ar"
      ? `مصر — Presence only (مش Presence or interest)، واللغات: العربية + الإنجليزية`
      : `Egypt — Presence only (not Presence or interest), languages: Arabic + English`,
    interests: [],
    placements: l === "ar" ? "Search أولًا؛ PMax يغطي Shopping/YouTube/Display تلقائيًا" : "Search first; PMax covers Shopping/YouTube/Display automatically",
    budget: l === "ar"
      ? "ابدأ 100–150 ج.م/يوم للبحث + 150 ج.م/يوم للـ PMax. المزايدة: Maximize conversions بدون tCPA لحد ما توصل 30 تحويل/شهر، بعدها حوّل Broad match + tCPA (المعيار في 2026)"
      : "Start 100–150 EGP/day Search + 150 EGP/day PMax. Bidding: Maximize conversions without tCPA until you reach 30 conv/month, then switch to Broad match + tCPA (the 2026 standard)",
    duration: l === "ar" ? "دائم (Always-on) — البحث بيلتقط طلب موجود أصلًا، مش بيصنعه" : "Always-on — Search captures existing demand, it doesn't create it",
    creative: l === "ar"
      ? "إعلان RSA واحد قوي لكل مجموعة: 10+ عناوين (منها اسم الكتاب والمؤلف والسعر والتوصيل)، 4 أوصاف، وثبّت (Pin) عنوان اسم الكتاب في الموضع الأول"
      : "One strong RSA per ad group: 10+ headlines (book name, author, price, delivery), 4 descriptions, pin the book-title headline in position 1",
    cta: l === "ar"
      ? "صفحة الهبوط = صفحة الكتاب مباشرة (مش الرئيسية) + نفس الـ UTM standard"
      : "Landing page = the book's product page directly (never the homepage) + the same UTM standard",
    schedule: l === "ar" ? "على مدار اليوم — راجع تقرير الأوقات بعد أسبوعين" : "All day — review the time report after two weeks",
    tips: pickAll([
      {
        ar: "الـ Negative keywords أهم من أي وقت (Broad بيتوسع بقوة): استبعد pdf، تحميل، مجانا، ملخص، اقتباسات على مستوى الحساب",
        en: "Negative keywords matter more than ever (broad expands aggressively): exclude pdf, download, free, summary, quotes at account level",
      },
      {
        ar: "PMax 2026: أضف Search themes (لحد 25 لكل asset group) — اسم الكتاب، المؤلف، النوع؛ واعمل asset group لكل قسم كتب مش واحدة للكل",
        en: "PMax 2026: add search themes (up to 25 per asset group) — book title, author, genre; and build an asset group per book category, not one for everything",
      },
      {
        ar: "فعّل Enhanced conversions + اربط GA4 — من غير تتبع نظيف الـ Smart Bidding بيشتغل أعمى",
        en: "Enable Enhanced conversions + link GA4 — without clean tracking, Smart Bidding flies blind",
      },
      {
        ar: "سجّل في Google Merchant Center حتى من غير إعلانات — الـ Free listings بتعرض كتبك في تبويب Shopping مجانًا",
        en: "Register in Google Merchant Center even without ads — free listings show your books in the Shopping tab at no cost",
      },
    ], l),
    steps: pickAll([
      {
        ar: "ads.google.com → New campaign → Sales → Search. سمّيها «كتب — بحث Brand+Titles»",
        en: "ads.google.com → New campaign → Sales → Search. Name it “Books — Search Brand+Titles”",
      },
      {
        ar: "Settings: مصر (Presence only)، عربي+إنجليزي، Maximize conversions، واقفل Search partners وDisplay network",
        en: "Settings: Egypt (Presence only), Arabic+English, Maximize conversions, and untick Search partners and Display network",
      },
      {
        ar: `مجموعة إعلانية لكل كتاب/سلسلة: ابدأ Phrase match بالكلمات الشرائية اللي تحت${mainTitle ? ` (جاهزة لـ «${mainTitle}»)` : ""}، وبعد 30 تحويل/شهر حوّلها Broad`,
        en: `One ad group per book/series: start Phrase match with the transactional keywords below${mainTitle ? ` (ready-made for “${mainTitle}”)` : ""}, switch to Broad after 30 conv/month`,
      },
      {
        ar: "أضف الـ Negatives قايمة مشتركة على مستوى الحساب، والأصول: Sitelinks (الأقسام) + Promotion (خصمك الحالي) + Price assets",
        en: "Add the negatives as a shared account-level list, plus assets: Sitelinks (categories) + Promotion (your current discount) + Price assets",
      },
      {
        ar: "حملة تانية: Performance Max مربوطة بالـ Merchant Center feed، asset group لكل قسم، وSearch themes من القايمة",
        en: "Second campaign: Performance Max on the Merchant Center feed, one asset group per category, search themes from the list",
      },
      {
        ar: "Tools → Conversions: اتأكد إن Purchase أساسي (Primary) وEnhanced conversions مفعّلة، واربط GA4",
        en: "Tools → Conversions: make sure Purchase is Primary with Enhanced conversions on, and link GA4",
      },
    ], l),
  };

  const platforms = [meta, boost, google];
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
    seo: buildSeoChecklist(mainTitle, l),
    keywords: buildKeywordPlan(mainTitle, opts.genreKey, l),
  };
}

// On-page + technical SEO checklist for the book's product page, with the
// title substituted so it reads as a fill-in-the-blanks recipe.
function buildSeoChecklist(title: string, l: PlanLang): string[] {
  const tt = title || (l === "ar" ? "اسم الكتاب" : "Book Title");
  return pickAll([
    {
      ar: `عنوان الصفحة (Title tag): «${tt} – اسم المؤلف | متجر نهضة مصر» — الكلمة المفتاحية أول العنوان، أقل من 60 حرف`,
      en: `Title tag: “${tt} – Author Name | Nahdet Misr Store” — keyword first, under 60 characters`,
    },
    {
      ar: `الوصف (Meta description): جملة بيع + السعر + «توصيل لباب البيت» + CTA، 150–160 حرف — ده إعلانك المجاني في نتائج البحث`,
      en: `Meta description: selling line + price + “door delivery” + CTA, 150–160 chars — this is your free ad in the results`,
    },
    {
      ar: `H1 واحد = اسم الكتاب، ووصف المنتج 300+ كلمة أصلية (نبذة، عن المؤلف، لمين الكتاب ده) — مش نسخ كلام الناشر المتكرر في كل المواقع`,
      en: `One H1 = the book title, and a 300+ word original product description (synopsis, about the author, who it's for) — not the publisher blurb duplicated across every site`,
    },
    {
      ar: `Structured data: schema.org/Book جوّه Product (المؤلف، ISBN، السعر، التوفر، التقييمات) — بيفتح Rich results بالنجوم والسعر`,
      en: `Structured data: schema.org/Book inside Product (author, ISBN, price, availability, ratings) — unlocks rich results with stars and price`,
    },
    {
      ar: `صور الغلاف: ملف باسم الكتاب (${tt.replace(/\s+/g, "-") || "book"}.webp) + Alt text باسم الكتاب والمؤلف — بحث الصور مصدر زيارات حقيقي للكتب`,
      en: `Cover images: file named after the book + alt text with title and author — image search is a real traffic source for books`,
    },
    {
      ar: "فعّل تقييمات المشترين على صفحة الكتاب (UGC) — التقييمات كلمات مفتاحية مجانية ومحتوى متجدد",
      en: "Enable buyer reviews on the book page (UGC) — reviews are free keywords and fresh content",
    },
    {
      ar: "روابط داخلية: من صفحة القسم وصفحات «كتب مشابهة» للكتاب — وسجّل الموقع في Google Search Console وتابع استعلامات الظهور",
      en: "Internal links from the category page and “similar books” — and register in Google Search Console to watch impression queries",
    },
    {
      ar: "المحتوى المعلوماتي: مقال «ملخص/مراجعة» على مدونة المتجر يلتقط الباحثين عن الملخص ويحوّلهم لصفحة الشراء — النية دي أضعاف حجم نية الشراء",
      en: "Informational capture: a “summary/review” blog article catches summary-seekers and funnels them to the buy page — that intent is several times the buy-intent volume",
    },
  ], l);
}

// Ready-made keyword lists per book + genre, in both intents, plus the
// research method to expand them.
function buildKeywordPlan(title: string, genreKey: string, l: PlanLang): KeywordPlan {
  const tt = title || (l === "ar" ? "اسم الكتاب" : "book title");
  const genreKw: Record<string, { ar: string[]; en: string[] }> = {
    kids: { ar: ["قصص أطفال", "كتب أطفال تعليمية", "قصص قبل النوم"], en: ["children's books arabic", "kids stories"] },
    religion: { ar: ["كتب دينية", "كتب إسلامية"], en: ["islamic books arabic"] },
    selfdev: { ar: ["كتب تطوير الذات", "كتب تنمية بشرية"], en: ["self development books arabic"] },
    novel: { ar: ["روايات عربية", "روايات جديدة"], en: ["arabic novels"] },
    history: { ar: ["كتب تاريخ", "كتب تاريخ مصر"], en: ["egypt history books"] },
    general: { ar: ["كتب", "شراء كتب اون لاين"], en: ["buy arabic books online"] },
  };
  const g = genreKw[genreKey] ?? genreKw.general;

  if (l === "en") {
    return {
      transactional: [
        `buy ${tt}`, `${tt} book price`, `${tt} book Egypt`, `order ${tt} online`, ...g.en,
        "buy books online egypt", "bookstore delivery egypt",
      ],
      informational: [`${tt} summary`, `${tt} review`, `${tt} quotes`, `who wrote ${tt}`],
      negatives: ["pdf", "free download", "epub", "audiobook free", "summary", "wikipedia", "jobs"],
      research: [
        "Type the book/author name in Google and harvest the autocomplete suggestions + “People also ask”",
        "Google Ads → Tools → Keyword Planner → seed it with the title, author and genre; export volumes for Egypt",
        "Steal proven demand: search competitors' book pages ranking for your titles and note their title-tag wording",
        "After 2 weeks, mine Search Console queries + the Search terms report — promote converting queries to exact keywords and junk queries to negatives",
      ],
    };
  }
  return {
    transactional: [
      `شراء كتاب ${tt}`, `كتاب ${tt}`, `${tt} سعر`, `اطلب ${tt} اون لاين`, `${tt} متجر نهضة مصر`,
      ...g.ar, "شراء كتب اون لاين مصر", "مكتبة توصيل للمنزل",
    ],
    informational: [`ملخص كتاب ${tt}`, `مراجعة ${tt}`, `اقتباسات من ${tt}`, `مؤلف كتاب ${tt}`],
    negatives: ["pdf", "تحميل", "مجانا", "مجاني", "اون لاين مجانا", "ملخص", "اقتباسات", "ويكيبيديا", "وظائف"],
    research: [
      "اكتب اسم الكتاب/المؤلف في جوجل والقط اقتراحات الإكمال التلقائي + أسئلة «People also ask» — دي نوايا بحث حقيقية جاهزة",
      "Google Ads → Tools → Keyword Planner → حط اسم الكتاب والمؤلف والنوع كبذور وصدّر أحجام البحث لمصر",
      "اسرق الطلب المثبت: شوف صفحات المنافسين اللي بتتصدر لكتبك ولاحظ صياغة عناوينهم",
      "بعد أسبوعين: تقرير Search terms في الإعلانات + استعلامات Search Console — رقّي اللي بيحوّل لـ Exact، وحط الزبالة في الـ Negatives",
    ],
  };
}
