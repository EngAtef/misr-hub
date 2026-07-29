// Built-in "smart" post generator — no AI, no integrations, no cost.
// Does real work from the book text: extractive summarization (sentence
// scoring by word frequency), genre detection, quote mining, and a curated
// Arabic template library with variants. Pure TypeScript, runs server-side.

export interface BuiltinResult {
  summary: string;
  hook: string;
  post_fb: string;
  post_ig: string;
  post_wa: string;
  hashtags: string;
  research_notes: string;
  genre: string;
}

const AR_STOP = new Set(
  "من في على إلى عن أن إن كان كانت ما لا لم لن هو هي هم هذا هذه ذلك التي الذي كل بعد قبل عند حتى إذا كما لدى مع بين غير أي أو ثم قد بل لكن وقد وهو وهي كانوا ليس فيه فيها منه منها به بها له لها هناك ولا وما وأن يكون تكون الى علي".split(/\s+/)
);
const EN_STOP = new Set("the a an and or of to in is was were are be for with on at by it this that as from he she they his her its not but have has had you i we".split(/\s+/));

function words(s: string) {
  return s
    .replace(/[،؛:.!؟?"'«»()\[\]—_*\-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !AR_STOP.has(w) && !EN_STOP.has(w.toLowerCase()));
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!؟?…])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 25 && s.length <= 400);
}

// Extractive summary: score sentences by significant-word frequency, keep the
// best N in original order.
function summarize(text: string, n = 4): string {
  const sents = sentences(text).slice(0, 300);
  if (!sents.length) return "";
  const freq = new Map<string, number>();
  for (const s of sents) for (const w of words(s)) freq.set(w, (freq.get(w) ?? 0) + 1);
  const scored = sents.map((s, i) => {
    const ws = words(s);
    const score = ws.reduce((sum, w) => sum + (freq.get(w) ?? 0), 0) / Math.max(ws.length, 1);
    return { s, i, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s)
    .join(" ");
}

// Quotable lines: mid-length, emotionally dense, not headings — and not
// sentences already used in the summary (avoids the post repeating itself).
export function pickQuotes(text: string, n: number, exclude: string): string[] {
  const sents = sentences(text).filter((s) => s.length >= 45 && s.length <= 170);
  if (!sents.length) return [];
  const freq = new Map<string, number>();
  for (const s of sents) for (const w of words(s)) freq.set(w, (freq.get(w) ?? 0) + 1);
  const scored = sents
    .slice(0, 200)
    .map((s) => {
      const ws = words(s);
      return { s, score: ws.reduce((sum, w) => sum + (freq.get(w) ?? 0), 0) / Math.max(ws.length, 1) };
    })
    .sort((a, b) => b.score - a.score);
  const out: string[] = [];
  for (const x of scored) {
    if (out.length >= n) break;
    if (exclude.includes(x.s) && scored.length > n) continue;
    out.push(x.s.replace(/^["'«»\s]+|["'«»\s]+$/g, ""));
  }
  return out;
}

function pickQuote(text: string, exclude: string): string {
  return pickQuotes(text, 1, exclude)[0] ?? "";
}

interface Genre {
  key: string;
  match: string[];
  hooks: string[];
  bullets: string[];
  tags: string;
}

const GENRES: Genre[] = [
  {
    key: "kids",
    match: ["طفل", "أطفال", "اطفال", "حكاي", "حدوت", "رسوم", "مغامر", "صغير", "ماما", "بابا", "أصدقاء", "مدرسة"],
    hooks: ["حدوتة جديدة هتخطف قلب طفلك ❤️", "أجمل هدية لطفلك مش لعبة… كتاب! 🎁", "وقت الحدوتة بقى أحلى بكتير 🌙"],
    bullets: ["قصة ممتعة تزرع القيم من غير وعظ", "رسوم وألوان تخلي طفلك يحب القراءة", "مناسب لوقت النوم أو القراءة المشتركة"],
    tags: "#كتب_أطفال #قصص_أطفال #حواديت #قراءة_للأطفال #تربية",
  },
  {
    key: "religion",
    match: ["الله", "النبي", "رسول", "إيمان", "ايمان", "دعاء", "قرآن", "قران", "صلاة", "سيرة", "الصحابة"],
    hooks: ["كتاب يفتح قلبك قبل عقلك 🤍", "جرعة إيمانية هتغير يومك ✨", "رحلة تقرّبك خطوة… وتريح قلبك 🕊️"],
    bullets: ["لغة بسيطة تلمس القلب", "معانٍ تعيشها في يومك مش بس تقرأها", "هدية قيّمة لنفسك أو لمن تحب"],
    tags: "#كتب_دينية #إيمانيات #سيرة #سكينة",
  },
  {
    key: "selfdev",
    match: ["نجاح", "ذات", "تطوير", "عادات", "هدف", "أهداف", "تفكير", "طاقة", "ثقة", "قرار", "عقل", "إنجاز"],
    hooks: ["الكتاب اللي هيخليك تشوف نفسك بشكل مختلف 🚀", "خطوة واحدة ممكن تغير السنة كلها 💡", "مش كتاب… خطة عمل لحياتك ✍️"],
    bullets: ["أفكار عملية تطبقها من أول يوم", "أمثلة حقيقية مش كلام نظري", "قراءة خفيفة وأثر يدوم"],
    tags: "#تطوير_الذات #تنمية_بشرية #نجاح #عادات",
  },
  {
    key: "novel",
    match: ["رواية", "حب", "قلب", "ليل", "بطل", "حكاية", "موت", "حياة", "عيون", "طريق", "مدينة", "ذكريات"],
    hooks: ["رواية هتسهرك للصبح 🌙", "من أول صفحة… مش هتقدر تسيبها 📖", "حكاية هتفضل معاك بعد آخر سطر ✨"],
    bullets: ["أحداث مشوقة وشخصيات هتحبها (أو تكرهها!)", "أسلوب سردي يخطفك من أول فصل", "نهاية مش هتتوقعها"],
    tags: "#روايات #رواية #أدب_عربي #ماذا_تقرأ",
  },
  {
    key: "history",
    match: ["تاريخ", "حضارة", "مصر", "ملك", "ثورة", "قرن", "دولة", "حرب", "زمن", "عصر"],
    hooks: ["الحكاية اللي ماحكوهاش في المدرسة 🏛️", "سافر في الزمن من غير ما تسيب كرسيك 🕰️", "التاريخ أمتع لما يتحكي صح 📜"],
    bullets: ["حقائق وقصص موثّقة بأسلوب ممتع", "تفهم الحاضر لما تعرف الماضي", "معلومات هتحب تحكيها لغيرك"],
    tags: "#تاريخ #حضارة #معلومات",
  },
];

const DEFAULT_GENRE: Genre = {
  key: "general",
  match: [],
  hooks: ["كتاب جديد يستاهل مكان على مكتبتك 📚", "قراءتك الجاية وصلت ✨", "لو بتدور على كتاب يستاهل وقتك… لقيته 📖"],
  bullets: ["محتوى قيّم بأسلوب سهل وممتع", "اختيار موفق لهديتك الجاية", "متوفر الآن ولحد باب البيت"],
  tags: "",
};

export function detectGenreKey(text: string, title: string): string {
  return detectGenre(text, title).key;
}

function detectGenre(text: string, title: string): Genre {
  const hay = `${title} ${text.slice(0, 8000)}`;
  let best = DEFAULT_GENRE;
  let bestHits = 1; // need at least 2 hits to beat general
  for (const g of GENRES) {
    const hits = g.match.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
    if (hits > bestHits) { bestHits = hits; best = g; }
  }
  return best;
}

// Stable-but-varied: hash the title so each book gets its own template, and
// `variant` lets the user cycle wordings.
function hashPick<T>(arr: T[], seed: string, variant: number): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return arr[Math.abs(h + variant) % arr.length];
}

// WhatsApp broadcast variant: *bold* markers, short, direct, reply hook.
function waPost(opts: { title: string; hook: string; quote: string; bullet: string; buyUrl?: string; readUrl?: string }): string {
  const lines = [
    `*«${opts.title}»* 📚`,
    opts.hook,
    "",
    ...(opts.quote ? [`«${opts.quote}»`, ""] : []),
    `✅ ${opts.bullet}`,
    "",
    opts.buyUrl ? `🛒 اطلبه دلوقتي: ${opts.buyUrl}` : "🛒 اطلبه دلوقتي من متجر نهضة مصر",
    ...(opts.readUrl ? [`📖 اقرأ أول فصل مجانًا: ${opts.readUrl}`] : []),
    "",
    `رد بكلمة "طلب" ونجهزهولك فورًا 🙌`,
  ];
  return lines.join("\n");
}

export function builtinGenerate(opts: {
  title: string;
  text: string;
  buyUrl?: string;
  readUrl?: string; // free-first-chapter reader link
  lang: "ar" | "en";
  variant?: number;
  titles?: string[]; // >1 titles = multi-book bundle post
}): BuiltinResult {
  const { title, text, buyUrl, readUrl, lang } = opts;
  const variant = opts.variant ?? 0;
  const titles = (opts.titles ?? []).filter(Boolean);
  const genre = detectGenre(text, title);
  if (titles.length > 1) return bundleGenerate({ titles, text, buyUrl, readUrl, lang, variant, genre });
  const summary = summarize(text) || (lang === "en" ? `“${title}” — a new pick from our store.` : `«${title}» — إصدار مميز من متجر نهضة مصر.`);
  const quote = pickQuote(text, summary);
  const hook = hashPick(genre.hooks, title, variant);
  const bullets = genre.bullets.map((b) => `✅ ${b}`).join("\n");
  const tags = [genre.tags, "#متجر_نهضة_مصر #كتب #قراءة #اقرأ #bookstagram #books #reading"]
    .filter(Boolean).join(" ");

  const readLineAr = readUrl ? `\n📖 اقرأ أول فصل مجانًا: ${readUrl}` : "";

  if (lang === "en") {
    const cta = buyUrl ? `Order now 👉 ${buyUrl}` : "Order now from Nahdet Misr store — delivered to your door 🚚";
    const readLine = readUrl ? `\n📖 Read the first chapter free: ${readUrl}` : "";
    const fb = `📚 “${title}”\n\n${hook}\n\n${quote ? `“${quote}”\n\n` : ""}${summary}\n\n${bullets}\n\n🛒 ${cta}${readLine}`;
    const ig = `${hook}\n\n📖 “${title}”\n${quote ? `“${quote.slice(0, 120)}”\n` : ""}\n🛒 Link in bio 🔗`;
    return {
      summary, hook, post_fb: fb, post_ig: ig,
      post_wa: waPost({ title, hook, quote, bullet: genre.bullets[0], buyUrl, readUrl }),
      hashtags: tags, research_notes: "", genre: genre.key,
    };
  }

  const cta = buyUrl
    ? `اطلبه دلوقتي 👉 ${buyUrl}`
    : "اطلبه دلوقتي من متجر نهضة مصر — والتوصيل لحد باب البيت 🚚";

  const quoteLine = quote ? `«${quote}»\n\n` : "";
  const fbTemplates = [
    `📚 «${title}»\n\n${hook}\n\n${quoteLine}${summary}\n\n✨ ليه تقتنيه؟\n${bullets}\n\n🛒 ${cta}${readLineAr}`,
    `${hook}\n\n${quoteLine}ده مش مجرد كتاب… «${title}» تجربة كاملة 📖\n\n${summary}\n\n${bullets}\n\n🛒 ${cta}${readLineAr}\nشاركنا في التعليقات: مين أول حد جه في بالك تهديه الكتاب ده؟ 👇`,
    `سؤال سريع: إمتى آخر مرة كتاب خطفك من أول صفحة؟ 🤔\n\n«${title}» جاهز يعمل كده تاني.\n\n${quoteLine}${summary}\n\n${bullets}\n\n🛒 ${cta}${readLineAr}`,
  ];
  const igTemplates = [
    `${hook}\n\n📖 «${title}»\n${quote ? `«${quote.slice(0, 130)}»\n` : ""}\n${genre.bullets[0]} ✨\n\n🛒 اطلبه الآن — الرابط في البايو 🔗`,
    `«${title}» وصل 📚✨\n\n${hook}\n${quote ? `\n«${quote.slice(0, 130)}»\n` : ""}\nاحفظ البوست ده لقراءتك الجاية 📌\n\n🛒 الرابط في البايو 🔗`,
  ];

  return {
    summary,
    hook,
    post_fb: hashPick(fbTemplates, title, variant),
    post_ig: hashPick(igTemplates, title, variant),
    post_wa: waPost({ title, hook, quote, bullet: genre.bullets[0], buyUrl, readUrl }),
    hashtags: tags,
    research_notes: "",
    genre: genre.key,
  };
}

// Multi-book bundle post: a curated reading-list format. The genre comes from
// the combined texts; each book gets its own line with an emoji marker.
function bundleGenerate(opts: {
  titles: string[];
  text: string;
  buyUrl?: string;
  readUrl?: string;
  lang: "ar" | "en";
  variant: number;
  genre: Genre;
}): BuiltinResult {
  const { titles, text, buyUrl, readUrl, lang, variant, genre } = opts;
  const seed = titles.join("|");
  const summary = summarize(text, 3);
  const quote = pickQuote(text, summary);
  const tags = [genre.tags, "#متجر_نهضة_مصر #كتب #قراءة #قائمة_قراءة #bookstagram #books"]
    .filter(Boolean).join(" ");
  const marks = ["📕", "📗", "📘", "📙", "📔", "📚"];
  const listAr = titles.map((tt, i) => `${marks[i % marks.length]} «${tt}»`).join("\n");

  const waBundle = [
    `*قائمة قراءتك الجاية* 📚`,
    "",
    listAr,
    "",
    buyUrl ? `🛒 اطلب المجموعة: ${buyUrl}` : "🛒 اطلب المجموعة من متجر نهضة مصر",
    ...(readUrl ? [`📖 اقرأ أول فصل مجانًا: ${readUrl}`] : []),
    "",
    `رد بكلمة "طلب" ونجهزهالك فورًا 🙌`,
  ].join("\n");

  if (lang === "en") {
    const cta = buyUrl ? `Get the collection 👉 ${buyUrl}` : "Order the collection from Nahdet Misr store 🚚";
    const fb = `📚 Your next reading list is ready:\n\n${listAr}\n\n${quote ? `“${quote}”\n\n` : ""}🛒 ${cta}`;
    return {
      summary, hook: "Your next reading list is ready 📚", post_fb: fb,
      post_ig: `${listAr}\n\nWhich one first? 👇\n\n🛒 Link in bio 🔗`,
      post_wa: waBundle,
      hashtags: tags, research_notes: "", genre: genre.key,
    };
  }

  const cta = buyUrl
    ? `اطلب المجموعة دلوقتي 👉 ${buyUrl}`
    : "اطلب المجموعة من متجر نهضة مصر — والتوصيل لحد باب البيت 🚚";
  const hooks = [
    `قايمة قراءتك الجاية جهزناهالك 📚✨`,
    `${titles.length} كتب هيخلوا الفترة الجاية مختلفة 🔥`,
    `مكتبتك ناقصها المجموعة دي 📚`,
  ];
  const hook = hashPick(hooks, seed, variant);
  const fbTemplates = [
    `${hook}\n\n${listAr}\n\n${quote ? `«${quote}»\n\n` : ""}كل كتاب منهم تجربة مختلفة… ومع بعض؟ رحلة كاملة 📖\n\n🛒 ${cta}\n\nقولنا في التعليقات: هتبدأ بأنهي واحد؟ 👇`,
    `لو هتاخد معاك كتب في الإجازة… خد دول 🧳\n\n${listAr}\n\n${quote ? `«${quote}»\n\n` : ""}🛒 ${cta}\n\nاعمل تاج لصاحبك اللي هيحب المجموعة دي 🏷️`,
  ];
  const igTemplates = [
    `${hook}\n\n${listAr}\n\nاحفظ البوست ده 📌 وابدأ بأي واحد فيهم\n\n🛒 الرابط في البايو 🔗`,
    `قائمة القراءة الجديدة وصلت 📚\n\n${listAr}\n\nصوّت في الكومنتات: نبدأ بأنهي؟ 👇\n\n🛒 الرابط في البايو 🔗`,
  ];
  return {
    summary,
    hook,
    post_fb: hashPick(fbTemplates, seed, variant),
    post_ig: hashPick(igTemplates, seed, variant),
    post_wa: waBundle,
    hashtags: tags,
    research_notes: "",
    genre: genre.key,
  };
}

// ---------------------------------------------------------------------------
// Campaign pack: a 7-day content series for one book. Each day has a theme a
// social media manager would recognize; quotes rotate from the book's own
// quote pool so no two days repeat.
export interface PackDay {
  day: number;
  theme: string;
  post_fb: string;
  post_ig: string;
}

export function buildCampaignPack(opts: {
  title: string;
  text: string;
  buyUrl?: string;
  readUrl?: string;
}): PackDay[] {
  const { title, text, buyUrl, readUrl } = opts;
  const genre = detectGenre(text, title);
  const summary = summarize(text, 3);
  const quotes = pickQuotes(text, 5, summary);
  const q = (i: number) => quotes[i % Math.max(quotes.length, 1)] ?? "";
  const cta = buyUrl ? `🛒 اطلبه دلوقتي 👉 ${buyUrl}` : "🛒 اطلبه دلوقتي من متجر نهضة مصر 🚚";
  const readLine = readUrl ? `\n📖 اقرأ أول فصل مجانًا: ${readUrl}` : "";
  const hook = genre.hooks[0];
  const b = genre.bullets;

  return [
    {
      day: 1,
      theme: "الإطلاق — التعريف بالكتاب",
      post_fb: `📚 «${title}»\n\n${hook}\n\n${summary}\n\n✨ ليه تقتنيه؟\n${b.map((x) => `✅ ${x}`).join("\n")}\n\n${cta}${readLine}`,
      post_ig: `${hook}\n\n📖 «${title}» وصل ✨\n\n🛒 الرابط في البايو 🔗`,
    },
    {
      day: 2,
      theme: "يوم الاقتباس",
      post_fb: `«${q(0)}»\n\n— من كتاب «${title}» 📖\n\nلو الجملة دي لمستك… الكتاب كله كده.\n\n${cta}${readLine}`,
      post_ig: `«${q(0).slice(0, 140)}»\n\n— «${title}» 📖\n\nاحفظ البوست 📌 والرابط في البايو 🔗`,
    },
    {
      day: 3,
      theme: "يوم السؤال — تفاعل",
      post_fb: `سؤال النهارده 🤔\n\n${q(1) ? `في «${title}» فيه جملة بتقول: «${q(1)}»\n\nإيه رأيك؟ توافق ولا تختلف؟ 👇` : `إمتى آخر مرة كتاب غيّر طريقة تفكيرك؟ 👇\n\n«${title}» ممكن يكون التالي.`}\n\n${cta}`,
      post_ig: `رأيك يهمنا 👇\n\n${q(1) ? `«${q(1).slice(0, 120)}»\n\nتوافق؟ اكتب رأيك في الكومنتات` : `إمتى آخر كتاب غيّرك؟`}\n\n📖 «${title}» — الرابط في البايو`,
    },
    {
      day: 4,
      theme: "القيمة — ماذا ستكسب",
      post_fb: `إيه اللي هتخرج بيه من «${title}»؟ 🎯\n\n${b.map((x, i) => `${i + 1}. ${x}`).join("\n")}\n\n${q(2) ? `«${q(2)}»\n\n` : ""}${cta}${readLine}`,
      post_ig: `3 حاجات هتكسبها من «${title}» 📖\n\n${b.map((x, i) => `${i + 1}️⃣ ${x}`).join("\n")}\n\n🛒 الرابط في البايو 🔗`,
    },
    {
      day: 5,
      theme: "الفصل المجاني / نظرة داخل الكتاب",
      post_fb: readUrl
        ? `مش متأكد؟ جرّب قبل ما تشتري 📖\n\nاقرأ أول فصل من «${title}» مجانًا بالكامل:\n${readUrl}\n\nولو عجبك (وهيعجبك 😉):\n${cta}`
        : `نظرة جوه «${title}» 👀\n\n${q(2) ? `«${q(2)}»\n\n` : ""}${summary.split(" ").slice(0, 40).join(" ")}…\n\nعايز تكمل؟ ${cta}`,
      post_ig: readUrl
        ? `اقرأ أول فصل مجانًا 📖\n\n«${title}»\n\nاللينك في البايو ⬆️`
        : `لقطة من جوه «${title}» 👀\n\n${q(2) ? `«${q(2).slice(0, 120)}»` : ""}\n\n🛒 الرابط في البايو`,
    },
    {
      day: 6,
      theme: "الإهداء — لمين تجيبه",
      post_fb: `بتدور على هدية ليها معنى؟ 🎁\n\n«${title}» هدية بتقول لصاحبها «انت مهم عندي».\n\n${q(3) ? `«${q(3)}»\n\n` : ""}اعمل تاج لحد يستاهل الهدية دي 👇\n\n${cta}`,
      post_ig: `أجمل هدية… كتاب 🎁\n\n«${title}»\n\nتاج لحد يستاهله 👇\n\n🛒 الرابط في البايو`,
    },
    {
      day: 7,
      theme: "آخر فرصة — إلحاح لطيف",
      post_fb: `أسبوع كامل واحنا بنتكلم عن «${title}» 📚\n\nلو لسه محسمتش قرارك، خد الإشارة دي 😉\n\n${q(4) ? `«${q(4)}»\n\n` : ""}${cta}${readLine}\n\nالتوصيل لحد باب البيت 🚚`,
      post_ig: `لسه مطلبتش «${title}»؟ 👀\n\nالإشارة اللي كنت مستنيها وصلت ✨\n\n🛒 الرابط في البايو — التوصيل للباب 🚚`,
    },
  ];
}
