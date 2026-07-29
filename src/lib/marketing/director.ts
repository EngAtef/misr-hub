// The "Marketing Director" layer — turns a detected genre + real store data
// into a buyer persona, an organic-vs-paid decision, and full media-buyer ad
// configurations per platform (Egyptian market, EGP budgets). Pure TS: used
// by the free built-in engine, and its shape doubles as the JSON contract the
// Claude engine must return.

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
}

interface GenreDirector {
  persona: MarketingPlan["persona"];
  decisionMode: "ad" | "organic" | "both";
  decisionReason: string;
  age: string;
  gender: string;
  interests: string[];
  tiktok: boolean;
  multiBook: string;
}

const DIRECTORS: Record<string, GenreDirector> = {
  kids: {
    persona: {
      name: "الأم المهتمة بالتربية",
      age: "25–45",
      gender: "إناث بالأساس (80%) — والأب كمشترٍ ثانوي في المواسم",
      description:
        "أم لطفل/أطفال في سن 3–12، بتدوّر على بدائل مفيدة لشاشة الموبايل، وبتتأثر جدًا بتوصيات الأمهات التانية والمحتوى اللي يظهر فايدة تربوية واضحة. بتشتري في مواسم: نتيجة الامتحانات، الإجازة الصيفية، العودة للمدارس، رمضان.",
      pains: [
        "الطفل قاعد على الشاشات طول اليوم ومش بيقرأ",
        "صعوبة إيجاد محتوى عربي ممتع وآمن ومناسب للسن",
        "وقت النوم/الفراغ محتاج نشاط هادي ومفيد",
      ],
      motivations: [
        "تحس إنها أم بتستثمر في طفلها",
        "قيمة تربوية واضحة (قيم، لغة، خيال)",
        "سعر مناسب + توصيل للباب = قرار سريع",
      ],
    },
    decisionMode: "both",
    decisionReason:
      "كتب الأطفال أوسع جمهور شرائي على ميتا في مصر وأعلى معدل تحويل — انشر أورجانيك الأول لاختبار الـ hook، وبعد 24 ساعة اعمل حملة مبيعات مستقلة + Boost لأحسن بوست. ده تصنيف يستاهل ميزانية إعلانية دائمة.",
    age: "25–45",
    gender: "إناث (جرّب Broad بعد أول نتائج)",
    interests: [
      "Parenting", "Motherhood", "Toddlers", "Preschool", "Children's literature",
      "Early childhood education", "سوبر ماما (SuperMama)", "تربية الأطفال",
    ],
    tiktok: true,
    multiBook:
      "اعمل بوست/إعلان Carousel «مكتبة طفلك في الإجازة» — كل كارت غلاف كتاب بعمر مقترح (٣+، ٦+، ٩+)، واختم بكارت عرض المجموعة بسعر مخفض. المجموعات بترفع متوسط قيمة الطلب (AOV) بوضوح في فئة الأطفال.",
  },
  religion: {
    persona: {
      name: "الباحث عن السكينة",
      age: "18–55",
      gender: "الجنسين — الإناث أعلى تفاعلًا وشراءً",
      description:
        "جمهور واسع بيتفاعل مع المحتوى الإيماني القصير، وبيشتري الكتاب اللي يحس إنه «هيغير حاجة جواه». مواسم الذروة: رمضان، العشر الأوائل، بداية السنة الهجرية، وبعد الأزمات الشخصية.",
      pains: ["ضغط وقلق يومي ومحتاج راحة قلب", "بُعد عن القراءة الدينية وعايز نقطة بداية سهلة", "محتوى ديني كتير لكن مش موثوق"],
      motivations: ["راحة نفسية وطمأنينة", "هدية ذات معنى (أعلى فئة إهداء)", "الثقة في دار نشر معروفة"],
    },
    decisionMode: "organic",
    decisionReason:
      "المحتوى الديني أعلى تصنيف في المشاركة (Shares) الأورجانيك — اقتباس قوي ممكن ينتشر لوحده ويجيب مبيعات ببلاش. انشر أورجانيك بكثافة، وخصص Boost صغير (100–150 ج/يوم) فقط للبوستات اللي تعدّت متوسط تفاعلك، وكثّف قبل رمضان بحملة مبيعات كاملة.",
    age: "18–55",
    gender: "الجنسين",
    interests: ["Islam", "Quran", "Islamic books", "Ramadan", "مصطفى حسني", "عمرو خالد", "أدهم شرقاوي"],
    tiktok: true,
    multiBook: "بوست «حقيبة رمضان/السكينة» — 3 كتب إيمانية كباقة واحدة بسعر موحد، مع Carousel كل كارت رسالة الكتاب في سطر.",
  },
  selfdev: {
    persona: {
      name: "الطموح المشغول",
      age: "20–40",
      gender: "الجنسين بتوازن تقريبي",
      description:
        "موظف/طالب جامعي في القاهرة والإسكندرية والمدن الكبرى، بيستهلك محتوى إنتاجية وبودكاست، وعنده إحساس دائم إنه «متأخر عن أقرانه». بيشتري بدافع لحظة حماس — الإعلان لازم يلحق اللحظة دي بـ CTA مباشر.",
      pains: ["مشتت ومش قادر يلتزم بعادات", "قلق من المستقبل المهني والمادي", "بيبدأ كتب ومبيكملهاش"],
      motivations: ["نتيجة عملية سريعة («طبّق من أول فصل»)", "التميز في الشغل/الدراسة", "محتوى مُلهم يتشارك منه اقتباسات"],
    },
    decisionMode: "ad",
    decisionReason:
      "تطوير الذات فئة «طلب مُثبت» على ميتا في مصر — الجمهور بيشتري من الإعلان مباشرة لو الرسالة نتيجة ملموسة. ادخل بحملة مبيعات من اليوم الأول مع الأورجانيك كدعم، وركّز الإنفاق أيام الأحد–الأربعاء (قرارات بداية الأسبوع).",
    age: "20–40",
    gender: "الجنسين",
    interests: ["Self-improvement", "Personal development", "Entrepreneurship", "Productivity", "Psychology", "ثمانية بودكاست", "علي محمد علي", "دكتور أحمد عمارة"],
    tiktok: true,
    multiBook: "Carousel «عدة النسخة الأحسن منك» — كل كارت كتاب بيحل مشكلة واحدة محددة (تشتت/عادات/ثقة)، والكارت الأخير الباقة كاملة.",
  },
  novel: {
    persona: {
      name: "قارئة الروايات الشغوفة",
      age: "18–35",
      gender: "إناث بالأساس (70%+) — مجتمع BookTok/Bookstagram",
      description:
        "قارئة نهمة بتتابع مجتمعات القراءة (أبجد، Goodreads، جروبات الروايات)، بتشتري أكتر من رواية في الشهر، وبتتأثر بالاقتباسات والـ aesthetics أكتر من الوصف المباشر. معرض الكتاب حدثها السنوي الأهم.",
      pains: ["خلصت روايتها ومش لاقية «الجاية»", "خايفة تشتري رواية تطلع ضعيفة", "الميزانية محدودة والأسعار بتزيد"],
      motivations: ["الانغماس في حكاية تنسيها اليوم", "الانتماء لمجتمع القراء (تصوير الكتاب ومشاركته)", "اقتباس لمس حاجة جواها"],
    },
    decisionMode: "both",
    decisionReason:
      "الروايات بتنجح بالاقتباس الأورجانيك أولًا (أعلى Save/Share)، لكن فيه جمهور شرائي واضح تستهدفه بالإعلان. انشر الاقتباس أورجانيك، وحوّل الأعلى تفاعلًا لإعلان مبيعات خلال 48 ساعة وجمهور اهتمامات القراءة.",
    age: "18–35",
    gender: "إناث أولًا، وسّع بعد النتائج",
    interests: ["Novels", "Fiction books", "Goodreads", "Reading (books)", "Arabic literature", "أبجد", "أحمد خالد توفيق", "معرض القاهرة الدولي للكتاب"],
    tiktok: true,
    multiBook: "بوست «قائمة قراءة الشهر» — 4 روايات بجملة تشويقية لكل واحدة من غير حرق، مع تصويت في التعليقات «هتبدأي بأنهي؟» لرفع التفاعل.",
  },
  history: {
    persona: {
      name: "المثقف الفضولي",
      age: "25–55",
      gender: "ذكور أعلى شراءً (60%+)",
      description:
        "مهتم بالتاريخ والحضارة المصرية، بيتابع صفحات المعلومات والوثائقيات، وبيحب يبان مطّلعًا وسط دايرته. بيتفاعل مع «المعلومة الصادمة» أو «اللي ماحكوهالكش في المدرسة».",
      pains: ["محتوى تاريخي سطحي أو غير موثوق منتشر", "عايز عمق من غير لغة أكاديمية جافة"],
      motivations: ["معلومة يحكيها لغيره", "فهم الحاضر عبر الماضي", "اقتناء مكتبة رصينة"],
    },
    decisionMode: "organic",
    decisionReason:
      "جمهور التاريخ متفاعل جدًا أورجانيك (تعليقات ونقاشات) لكنه أضيق شرائيًا — ابدأ بسلسلة بوستات معلومات من الكتاب، ولو بوست كسر متوسط التفاعل ×2 اعمله Boost تفاعل 100 ج/يوم لمدة 3 أيام ثم أعد التقييم.",
    age: "25–55",
    gender: "الجنسين مع ميل ذكوري",
    interests: ["History", "Ancient Egypt", "Egyptology", "Documentary films", "الوثائقية", "تاريخ مصر"],
    tiktok: false,
    multiBook: "سلسلة «مكتبة التاريخ» — بوست أسبوعي لكل كتاب بمعلومة مدهشة منه، وفي الآخر بوست المجموعة كاملة.",
  },
  general: {
    persona: {
      name: "القارئ العام",
      age: "20–45",
      gender: "الجنسين",
      description: "جمهور عام مهتم بالقراءة والثقافة، بيشتري بدافع الفضول أو الإهداء، ويتأثر بالتقييمات وتجارب القراء.",
      pains: ["مش عارف يختار إيه من الزحمة", "وقت محدود للقراءة"],
      motivations: ["توصية واضحة ومختصرة «ليه الكتاب ده»", "سهولة الطلب والتوصيل"],
    },
    decisionMode: "organic",
    decisionReason:
      "من غير تصنيف واضح، ابدأ أورجانيك واختبر رسالتين مختلفتين (فايدة الكتاب / اقتباس منه)؛ اللي يكسب تفاعلًا حوّله لإعلان مبيعات بميزانية اختبار 150 ج/يوم.",
    age: "20–45",
    gender: "الجنسين",
    interests: ["Books", "Reading (books)", "Literature", "Book fairs", "معرض القاهرة الدولي للكتاب"],
    tiktok: false,
    multiBook: "بوست «اخترنالك» — 3 كتب من أقسام مختلفة كتوصيات المتجر للأسبوع.",
  },
};

export function buildMarketingPlan(opts: {
  genreKey: string;
  titles: string[];
  topCities?: string[];
  buyUrl?: string;
  bundleTitles?: string[];
}): MarketingPlan {
  const d = DIRECTORS[opts.genreKey] ?? DIRECTORS.general;
  const multi = opts.titles.length > 1;
  const cities = opts.topCities?.length
    ? opts.topCities.join("، ")
    : "القاهرة، الجيزة، الإسكندرية";

  const metaCreative = multi
    ? "إعلان Carousel: كل كارت غلاف كتاب (من مولّد التصاميم — مقاس Square)، أول كارت هو الأقوى بيعًا، وآخر كارت عرض المجموعة. عنوان كل كارت = الـ hook بتاع الكتاب."
    : "استخدم التصاميم المولّدة من الاستوديو: Square للفيد، Story 9:16 للستوري والريلز، Landscape للـ Link Ad. جرّب نسخة الغلاف الصافي ونسخة الاقتباس.";

  const meta: AdConfig = {
    platform: "Meta (Facebook + Instagram) — الحملة الأساسية",
    objective: "المبيعات (Sales) مع التحسين على Purchase — ولو البيكسل مش متركّب صح مؤقتًا: التفاعل (Engagement) للبوستات + رسائل واتساب للطلب",
    age: d.age,
    gender: d.gender,
    geo: `مصر — والأولوية في الاستهداف الجغرافي: ${cities} (أعلى محافظاتك مبيعًا فعليًا)`,
    interests: d.interests,
    placements: "ابدأ Advantage+ Placements؛ لو الـ CPM عالي بعد 3 أيام حوّل يدوي: Facebook Feed + Instagram Feed + Stories + Reels فقط (استبعد Audience Network)",
    budget: "ميزانية اختبار 200–300 ج.م/يوم على مستوى الحملة (CBO) بـ 2–3 مجموعات إعلانية. قاعدة الإيقاف: مجموعة صرفت ضعف متوسط قيمة الطلب من غير أي Purchase → أوقفها. قاعدة التوسيع: ROAS ≥ 2.5 لمدة 48 ساعة → زوّد 20% كل يومين (مش أكتر، عشان الـ Learning Phase)",
    duration: "اختبار 4–5 أيام، ثم إبقاء الرابح شغال دائمًا (Always-on) مع تجديد الكرياتيف كل 2–3 أسابيع لما الـ Frequency يعدي 3",
    creative: metaCreative,
    cta: "زر «تسوّق الآن» (Shop Now) → رابط الكتاب مباشرة مع UTM: utm_source=facebook&utm_medium=paid-social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}",
    schedule: "التوزيع طوال اليوم مع ذروة تفاعل الكتب 7–11 مساءً؛ راقب تقرير الساعات بعد أسبوع وخصّص لو فيه نمط واضح",
    tips: [
      "استبعد المشترين آخر 30 يوم من حملات الـ Prospecting (Custom Audience من البيكسل أو من ملف عملائك)",
      "الجمهور الأعرض بيكسب في مصر غالبًا — جرّب Adset بدون اهتمامات (Broad) جنب Adset الاهتمامات وسيب التحسين يشتغل",
      "3 إعلانات كحد أقصى داخل كل مجموعة — أكتر من كده بيشتّت الميزانية",
      "تأكد إن حدث Purchase بيتسجل صح (خصوصًا الدفع بالكارت — فيه فجوة تتبع معروفة عندك في الدفع الإلكتروني)",
    ],
  };

  const boost: AdConfig = {
    platform: "Boost للبوست الأورجاني (من داخل الاستوديو)",
    objective: "التفاعل (Engagement) — الهدف إثبات اجتماعي (لايكات/تعليقات) يخلي إعلان المبيعات أرخص",
    age: d.age,
    gender: d.gender,
    geo: `مصر — ${cities}`,
    interests: d.interests.slice(0, 4),
    placements: "تلقائي",
    budget: "100–150 ج.م/يوم فقط — الـ Boost مكمّل مش بديل لحملة المبيعات",
    duration: "3 أيام ثم قيّم: تفاعل فوق متوسط صفحتك ×2 → مدّد؛ أقل → أوقف",
    creative: "نفس البوست المنشور بدون تعديل (الـ Boost بيحافظ على التفاعلات المتراكمة)",
    cta: "بدون زر — خلي البوست طبيعي",
    schedule: "تلقائي",
    tips: ["اعمل Boost فقط للبوست اللي أثبت نفسه أورجانيك خلال أول 24 ساعة — متدفعش لبوست ضعيف"],
  };

  const platforms = [meta, boost];
  if (d.tiktok) {
    platforms.push({
      platform: "TikTok (خطوة تالية — يدوي حاليًا)",
      objective: "فيديو أورجانيك أولًا: 15–30 ثانية «ورقّة وقولّة» — افتح الكتاب واقرأ الاقتباس بصوت مع موسيقى هادئة، أو unboxing لطلبية",
      age: d.age,
      gender: d.gender,
      geo: "مصر",
      interests: ["BookTok", "اقتباسات", "كتب"],
      placements: "For You",
      budget: "صفر — أورجانيك. لو فيديو عدّى 10k مشاهدة، ساعتها فكّر في Spark Ads عليه",
      duration: "3 فيديوهات/أسبوع كإيقاع تجريبي لمدة شهر",
      creative: "الموبايل كافي — الأصالة بتكسب الإنتاج المصقول على تيك توك. اكتب الاقتباس Text overlay",
      cta: "«الرابط في البايو» + رد على التعليقات بروابط",
      schedule: "انشر 8–11 مساءً",
      tips: ["#BookTok بالعربي شغّال فعليًا في مصر — كتب الروايات وتطوير الذات أكبر المستفيدين"],
    });
  }

  return {
    persona: d.persona,
    decision: { mode: d.decisionMode, reason: d.decisionReason },
    platforms,
    retargeting: [
      "جمهور تفاعل الصفحة/الإنستجرام آخر 30 يوم → إعلان مبيعات مباشر (أرخص جمهور عندك)",
      "زوّار الموقع آخر 14 يوم بدون شراء → إعلان بعرض/كود خصم",
      "جمهور السلات المتروكة: صدّره جاهزًا من صفحة «السلات المتروكة» في التطبيق (زر Meta Custom Audience) — أعلى جمهور نية شراء عندك",
      "Lookalike 1% مصر من ملف أفضل عملائك: صدّر الـ seed من صفحة العملاء (عملاء 3+ طلبات) وارفعه Custom Audience ثم اعمل منه Lookalike",
    ],
    abTests: [
      "Hook A (سؤال) ضد Hook B (اقتباس من الكتاب) — نفس التصميم",
      "تصميم الغلاف الصافي ضد تصميم الاقتباس — نفس النص",
      "جمهور Broad بدون اهتمامات ضد جمهور الاهتمامات",
      multi ? "Carousel المجموعة ضد إعلان الكتاب الأقوى منفردًا" : "صورة Square ضد فيديو بسيط (الغلاف بحركة Zoom بطيئة)",
    ],
    multiBook: d.multiBook,
    bundleTitles: opts.bundleTitles,
  };
}
