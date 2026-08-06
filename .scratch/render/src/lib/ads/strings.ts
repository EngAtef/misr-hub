import type { Lang } from "../../lib/i18n";

// Ads Center copy lives here rather than in the global dictionary: it's ~120
// strings that only this section uses, and keeping them together makes the
// media-buyer vocabulary easy to review in one place.
export const AD = {
  // page
  title: { ar: "مركز الإعلانات", en: "Ads Center" },
  subtitle: {
    ar: "أداء إعلانات ميتا مقيسًا بالمبيعات الحقيقية من المتجر — مش بأرقام المنصة",
    en: "Meta ad performance measured against real store sales — not the platform's own numbers",
  },
  import: { ar: "استيراد تقارير", en: "Import reports" },
  importing: { ar: "جاري الاستيراد...", en: "Importing..." },
  settings: { ar: "الإعدادات", en: "Settings" },
  exportReport: { ar: "تصدير التقرير الكامل", en: "Export full report" },
  exportCsv: { ar: "تصدير CSV", en: "Export CSV" },
  emptyTitle: { ar: "مفيش بيانات إعلانات لسه", en: "No ad data yet" },
  emptyHint: {
    ar: "ارفع ملفات تقارير ميتا (Excel) — كل ملف = حساب × فترة. الرفع مرة تانية لنفس الفترة بيحدّثها، والفترات القديمة بتفضل زي ما هي.",
    en: "Upload your Meta report files (Excel) — one file = one account × one period. Re-uploading the same period refreshes it; older periods are kept.",
  },

  // tabs
  tabOverview: { ar: "نظرة عامة", en: "Overview" },
  tabAds: { ar: "الإعلانات", en: "Ads" },
  tabCampaigns: { ar: "الحملات", en: "Campaigns" },
  tabAdsets: { ar: "المجموعات", en: "Ad sets" },
  tabBooks: { ar: "الكتب", en: "Books" },
  tabFunnel: { ar: "القمع والتشخيص", en: "Funnel & diagnosis" },
  tabGap: { ar: "ميتا ضد الحقيقة", en: "Meta vs Reality" },
  tabLinks: { ar: "روابط Bitly", en: "Links (Bitly)" },
  tabCompare: { ar: "مقارنة الفترات", en: "Compare periods" },
  tabMapping: { ar: "ربط الإعلانات بالكتب", en: "Ad → book mapping" },
  tabImports: { ar: "الملفات المستوردة", en: "Imports" },

  // filters
  filters: { ar: "الفلاتر", en: "Filters" },
  period: { ar: "الفترة", en: "Period" },
  account: { ar: "الحساب", en: "Account" },
  campaign: { ar: "الحملة", en: "Campaign" },
  adset: { ar: "المجموعة الإعلانية", en: "Ad set" },
  ad: { ar: "الإعلان", en: "Ad" },
  book: { ar: "الكتاب", en: "Book" },
  status: { ar: "حالة التشغيل", en: "Delivery status" },
  verdict: { ar: "الحكم", en: "Verdict" },
  bottleneck: { ar: "أين يتعثر", en: "Bottleneck" },
  minSpend: { ar: "أقل إنفاق", en: "Min spend" },
  search: { ar: "بحث في أسماء الإعلانات والحملات", en: "Search ads and campaigns" },
  reset: { ar: "مسح الفلاتر", en: "Clear filters" },
  showing: { ar: "المعروض", en: "Showing" },

  // metrics
  spend: { ar: "الإنفاق", en: "Spend" },
  dailySpend: { ar: "إنفاق يومي", en: "Daily spend" },
  impressions: { ar: "الظهور", en: "Impressions" },
  reach: { ar: "الوصول", en: "Reach" },
  frequency: { ar: "التكرار", en: "Frequency" },
  cpm: { ar: "تكلفة الألف ظهور", en: "CPM" },
  clicks: { ar: "النقرات", en: "Link clicks" },
  ctr: { ar: "نسبة النقر", en: "CTR" },
  cpc: { ar: "تكلفة النقرة", en: "CPC" },
  lpv: { ar: "زيارات الصفحة", en: "Landing page views" },
  atc: { ar: "إضافة للسلة", en: "Adds to cart" },
  ic: { ar: "بدء الدفع", en: "Checkouts started" },
  metaPurchases: { ar: "مشتريات ميتا", en: "Meta purchases" },
  metaValue: { ar: "قيمة ميتا المعلنة", en: "Meta reported value" },
  metaRoas: { ar: "عائد ميتا", en: "Meta ROAS" },
  attRevenue: { ar: "الإيراد الفعلي المنسوب", en: "Attributed revenue" },
  attOrders: { ar: "طلبات منسوبة", en: "Attributed orders" },
  actualRoas: { ar: "العائد الفعلي", en: "Actual ROAS" },
  netRoas: { ar: "العائد بعد المرتجعات", en: "Net ROAS" },
  cpa: { ar: "تكلفة الطلب الفعلية", en: "Real cost per order" },
  bookDemand: { ar: "مبيعات الكتاب في الفترة", en: "Book sales in period" },
  bookOrders: { ar: "طلبات الكتاب", en: "Book orders" },
  bookStock: { ar: "المخزون", en: "Stock" },
  cancelRate: { ar: "نسبة الإلغاء", en: "Cancel rate" },
  share: { ar: "حصة الإعلان", en: "Ad share" },
  storeRevenue: { ar: "إيراد المتجر", en: "Store revenue" },
  storeOrders: { ar: "طلبات المتجر", en: "Store orders" },
  mer: { ar: "MER (إيراد ÷ إنفاق)", en: "MER (revenue ÷ spend)" },
  blendedCac: { ar: "تكلفة اكتساب الطلب", en: "Blended CAC" },
  spendShare: { ar: "الإنفاق من الإيراد", en: "Spend of revenue" },
  breakeven: { ar: "نقطة التعادل", en: "Break-even" },
  score: { ar: "التقييم", en: "Score" },
  ads: { ar: "إعلانات", en: "ads" },

  // overview
  whatToDo: { ar: "اللي المفروض يتعمل دلوقتي", en: "What to do now" },
  winners: { ar: "أقوى الإعلانات", en: "Top performers" },
  losers: { ar: "أضعف الإعلانات", en: "Worst performers" },
  spendVsRevenue: { ar: "الإنفاق مقابل الإيراد", en: "Spend vs revenue" },
  verdictMix: { ar: "توزيع الأحكام", en: "Verdict mix" },
  funnelTitle: { ar: "قمع التحويل", en: "Conversion funnel" },
  moneyMoved: { ar: "لو نقلت الميزانية الضعيفة للرابحين", en: "If the weak budget moved to the winners" },
  potentialGain: {
    ar: "إيراد إضافي متوقع لو الميزانية دي اشتغلت بعائد أقوى إعلان",
    en: "Extra revenue if that budget ran at the best ad's return",
  },

  // books
  booksGood: { ar: "كتب تستاهل تزويد", en: "Books worth more budget" },
  booksBad: { ar: "كتب بتخسر", en: "Books losing money" },
  booksOpportunity: { ar: "كتب بتبيع من غير إعلانات", en: "Selling with no ads behind them" },
  booksOpportunityHint: {
    ar: "الكتب دي بتبيع كويس عضويًا ومفيش عليها صرف — أرخص فرصة نمو متاحة.",
    en: "These sell well organically with no spend behind them — the cheapest growth available.",
  },
  paidShare: { ar: "نصيب المدفوع", en: "Paid share" },
  organic: { ar: "بدون إعلان", en: "Unadvertised" },

  // funnel
  stageImpr: { ar: "ظهور", en: "Impressions" },
  stageClicks: { ar: "نقرة", en: "Clicks" },
  stageLpv: { ar: "زيارة صفحة", en: "Landing views" },
  stageAtc: { ar: "إضافة للسلة", en: "Add to cart" },
  stageIc: { ar: "بدء دفع", en: "Checkout" },
  stagePurchase: { ar: "شراء", en: "Purchase" },
  dropoff: { ar: "الفاقد", en: "Drop-off" },
  worstStage: { ar: "أسوأ خطوة", en: "Worst step" },
  funnelNote: {
    ar: "ملاحظة: ميتا بتحسب «إضافة للسلة» من كل المواضع بما فيها اللي شافوا الإعلان من غير نقر، فممكن الرقم يبقى أعلى من زيارات الصفحة — قارن الإعلانات ببعضها مش بالنسبة المطلقة.",
    en: "Note: Meta counts adds-to-cart across all placements, including view-through, so this step can exceed landing page views — compare ads against each other, not against 100%.",
  },

  // gap tab
  gapMetaSays: { ar: "ميتا بتقول", en: "Meta says" },
  gapGa4Says: { ar: "GA4 تتبّع", en: "GA4 tracked" },
  gapReality: { ar: "الحقيقة (المتجر)", en: "Reality (store)" },
  gapFactor: { ar: "معامل التضخيم", en: "Inflation factor" },
  gapFactorHint: {
    ar: "قيمة ميتا المعلنة ÷ مبيعات الكتب المعلن عنها فعليًا في نفس الفترة",
    en: "Meta's claimed value ÷ what the advertised books actually sold in the same window",
  },
  gapWhyTitle: { ar: "ليه في فجوة أصلاً؟", en: "Why is there a gap at all?" },
  gapVerdictImpossible: { ar: "مستحيل", en: "Impossible" },
  gapVerdictInflated: { ar: "مبالغ فيه", en: "Inflated" },
  gapVerdictPlausible: { ar: "معقول", en: "Plausible" },
  gapImpossibleHint: {
    ar: "ميتا ادّعت مشتريات أكتر من كل طلبات الكتاب في المتجر من جميع القنوات — ده اعتماد مستحيل رياضيًا.",
    en: "Meta claimed more purchases than the book's total store orders across ALL channels — mathematically impossible credit.",
  },
  gapReason1Title: { ar: "١· نافذة الإسناد", en: "1 · Attribution window" },
  gapReason1: {
    ar: "ميتا بتحسب أي شراء خلال ٧ أيام من النقرة أو يوم من المشاهدة — حتى لو العميل اشترى كتاب تاني خالص أو كان جاي يشتري أصلًا.",
    en: "Meta counts any purchase within 7 days of a click (or 1 day of a view) — even if the customer bought a completely different book or was going to buy anyway.",
  },
  gapReason2Title: { ar: "٢· قيمة السلة كاملة", en: "2 · Whole-cart value" },
  gapReason2: {
    ar: "«قيمة التحويل» عند ميتا = إجمالي الطلب كله بكل الكتب اللي فيه، مش الكتاب المُعلن عنه بس. إحنا بنحسب قيمة الكتاب نفسه فقط.",
    en: "Meta's \"conversion value\" is the ENTIRE order total — every book in the cart — not just the advertised one. Our reality column counts only the advertised book's items.",
  },
  gapReason3Title: { ar: "٣· ازدواج القنوات", en: "3 · Channel double-claiming" },
  gapReason3: {
    ar: "نفس الطلب ممكن ميتا وجوجل يدّعوه الاتنين. عمود GA4 هنا شاهد محايد: أوردرات المنصة اللي وصلت فعلًا بحملات ميتا (عبر UTM).",
    en: "The same order can be claimed by both Meta and Google. The GA4 column is the neutral witness: real orders that arrived tagged with these Meta campaigns (via UTM).",
  },
  gapReason4Title: { ar: "٤· الإلغاءات والمرتجعات", en: "4 · Cancellations & returns" },
  gapReason4: {
    ar: "ميتا عمرها ما بتخصم الطلبات الملغية أو المرتجعة — إحنا بنستبعد الملغي وبنوريك الصافي بعد المرتجعات.",
    en: "Meta never subtracts cancelled or returned orders — reality excludes cancellations and shows net-of-returns too.",
  },
  gapReason5Title: { ar: "٥· تحويلات مُقدّرة", en: "5 · Modeled conversions" },
  gapReason5: {
    ar: "بسبب قيود iOS وحظر الكوكيز، ميتا «بتقدّر» جزء من المشتريات اللي مش شايفاها إحصائيًا — أرقام مش حقيقية بالضرورة.",
    en: "Because of iOS privacy limits, Meta statistically \"models\" purchases it can't see — estimates, not observed sales.",
  },
  gapHowToRead: {
    ar: "القاعدة العملية: خُد قرارات الميزانية من عمود «الحقيقة». لو الحكم «مستحيل» فاعرف إن أرقام ميتا للكتاب ده وهمية بالكامل تقريبًا.",
    en: "Rule of thumb: budget from the Reality column. A verdict of \"Impossible\" means Meta's numbers for that book are largely fictional.",
  },
  gapGa4Note: {
    ar: "GA4 بيتتبّع الحملات اللي فيها UTM فقط — الفراغات هنا معناها إن الحملة اتطلقت من غير utm_campaign. فعّل قالب الـ UTM الموحّد في كل الإعلانات الجاية عشان العمود ده يكتمل.",
    en: "GA4 only sees campaigns tagged with UTMs — blanks mean the campaign ran without utm_campaign. Apply the standard UTM template to every new ad so this column fills in.",
  },
  gapOrganic: { ar: "بحث أورجانيك", en: "Organic search" },
  gapOrganicHint: {
    ar: "نقرات جوجل الأورجانيك على استعلامات فيها اسم الكتاب خلال نفس الشهور — طلب حقيقي مش مدفوع.",
    en: "Organic Google clicks on queries containing the book's name in the same months — real unpaid demand.",
  },
  gapCampaignsCol: { ar: "الحملات", en: "Campaigns" },
  gapClaimPurch: { ar: "مشتريات مُدّعاة", en: "Claimed purchases" },
  gapRealOrders: { ar: "طلبات حقيقية", en: "Real orders" },

  // compare
  periodA: { ar: "الفترة الحالية", en: "Current period" },
  periodB: { ar: "فترة المقارنة", en: "Compare against" },
  change: { ar: "التغير", en: "Change" },
  newInPeriod: { ar: "جديد", en: "New" },
  stopped: { ar: "توقف", en: "Stopped" },
  comparePick: { ar: "اختر فترتين للمقارنة", en: "Pick two periods to compare" },

  // mapping
  unmappedTitle: { ar: "إعلانات لسه مش مربوطة بكتاب", en: "Ads not yet linked to a book" },
  unmappedHint: {
    ar: "من غير الربط مش هنقدر نحسب العائد الفعلي للإعلان — ابدأ بالأعلى إنفاقًا.",
    en: "Without a link we can't measure an ad's real return — start with the biggest spenders.",
  },
  mapNow: { ar: "اربط", en: "Link" },
  bookLabel: { ar: "اسم الكتاب", en: "Book name" },
  skus: { ar: "الأكواد (SKU)", en: "SKUs" },
  keyword: { ar: "كلمة مطابقة (بديل)", en: "Match keyword (fallback)" },
  keywordHint: {
    ar: "تُستخدم فقط لو مفيش SKU — بتطابق أي منتج اسمه بيحتوي الكلمة.",
    en: "Only used when no SKU is set — matches any product whose name contains the word.",
  },
  suggestions: { ar: "اقتراحات من مبيعاتك", en: "Suggestions from your sales" },
  searchProducts: { ar: "ابحث عن كتاب أو SKU", en: "Search a book or SKU" },
  mappings: { ar: "الروابط الحالية", en: "Current links" },
  save: { ar: "حفظ", en: "Save" },
  cancel: { ar: "إلغاء", en: "Cancel" },
  remove: { ar: "حذف", en: "Remove" },
  auto: { ar: "تلقائي", en: "Auto" },
  inactive: { ar: "موقوف", en: "Off" },

  // imports
  file: { ar: "الملف", en: "File" },
  rows: { ar: "الصفوف", en: "Rows" },
  importedAt: { ar: "تاريخ الرفع", en: "Imported" },
  importedBy: { ar: "بواسطة", en: "By" },
  deleteImport: { ar: "حذف الفترة", en: "Delete period" },
  deleteImportConfirm: {
    ar: "هيتم حذف كل صفوف الفترة دي (بنسخة في سلة المهملات). تأكيد؟",
    en: "This deletes every row of that period (a copy goes to Trash). Continue?",
  },

  // import dialog
  dialogTitle: { ar: "استيراد تقارير ميتا", en: "Import Meta reports" },
  dialogHint: {
    ar: "اختار ملف أو أكتر (Excel من Ads Manager). راجع اسم الحساب والفترة قبل التأكيد.",
    en: "Pick one or more Ads Manager Excel exports. Check the account name and period before confirming.",
  },
  chooseFiles: { ar: "اختيار الملفات", en: "Choose files" },
  accountName: { ar: "اسم الحساب", en: "Account name" },
  from: { ar: "من", en: "From" },
  to: { ar: "إلى", en: "To" },
  levelsFound: { ar: "الصفوف", en: "Rows found" },
  confirmImport: { ar: "تأكيد الاستيراد", en: "Confirm import" },
  replaceWarning: {
    ar: "فيه استيراد سابق لنفس الحساب والفترة — هيتم استبداله.",
    en: "An earlier import exists for the same account and period — it will be replaced.",
  },
  parseFailed: { ar: "مش قادر أقرأ الملف ده", en: "Couldn't read this file" },

  // settings dialog
  grossMargin: { ar: "هامش الربح الإجمالي %", en: "Gross margin %" },
  grossMarginHint: {
    ar: "بيحدد نقطة التعادل: هامش 35% يعني الإعلان محتاج 2.86x عشان ميخسرش.",
    en: "Sets break-even: a 35% margin means an ad needs 2.86x just to avoid losing money.",
  },
  targetRoas: { ar: "العائد المستهدف", en: "Target ROAS" },
  minSpendSetting: { ar: "أقل إنفاق للحكم على إعلان", en: "Min spend before judging an ad" },
  frequencyCap: { ar: "حد التكرار قبل الإرهاق", en: "Frequency cap before fatigue" },

  // bitly
  bitlyTitle: { ar: "روابط Bitly", en: "Bitly links" },
  bitlyIntro: {
    ar: "Bitly بيعدّ كل تحويلة بيعملها فعليًا — شاهد محايد مستقل عن ميتا وجوجل. المقارنة هنا: نقرات ميتا (اللي دفعت عليها) ← تحويلات Bitly الحقيقية ← جلسات GA4 ← طلبات فعلية.",
    en: "Bitly counts every redirect it actually serves — a witness independent of both Meta and Google. The chain here: Meta's charged clicks → Bitly's real redirects → GA4 sessions → shipped orders.",
  },
  bitlyNotConnected: { ar: "Bitly مش متوصل لسه", en: "Bitly isn't connected yet" },
  bitlyNotConnectedHint: {
    ar: "روح Settings ← Integrations ← Bitly، الصق الـ Generic Access Token بتاعك واحفظ. مش هتحتاج تدّيني التوكن — بيتخزن في إعدادات التطبيق للأدمن بس.",
    en: "Open Settings → Integrations → Bitly, paste your own Generic Access Token and save. You never have to share the token with anyone — it's stored admin-only in app settings.",
  },
  bitlyOpenSettings: { ar: "فتح الإعدادات", en: "Open Settings" },
  bitlyTest: { ar: "اختبار الاتصال", en: "Test connection" },
  bitlySync: { ar: "مزامنة", en: "Sync now" },
  bitlySyncing: { ar: "جاري المزامنة...", en: "Syncing..." },
  bitlyDays: { ar: "عدد الأيام", en: "Days" },
  bitlyLastSync: { ar: "آخر مزامنة", en: "Last sync" },
  bitlyClicks: { ar: "تحويلات Bitly", en: "Bitly redirects" },
  bitlyLinks: { ar: "الروابط", en: "Links" },
  bitlyTagged: { ar: "روابط عليها UTM", en: "Links with UTM" },
  bitlyTaggedHint: {
    ar: "الروابط اللي مفيهاش utm_campaign مش هينفع نربطها بحملة — ضيف الـ UTM في وجهة الرابط.",
    en: "Links without utm_campaign can't be matched to a campaign — add UTMs to the destination URL.",
  },
  bitlyTopLinks: { ar: "أكثر الروابط ضغطًا", en: "Most-clicked links" },
  bitlyReferrers: { ar: "مصادر النقر", en: "Referrers" },
  bitlyCountries: { ar: "الدول", en: "Countries" },
  bitlyChain: { ar: "سلسلة التسريب", en: "The leak chain" },
  bitlyChainHint: {
    ar: "لو Bitly أقل بكتير من نقرات ميتا يبقى فيه نقرات اتحسبت وما وصلتش أصلًا. ولو GA4 أقل بكتير من Bitly يبقى الناس بتوصل وبتخرج قبل ما التتبّع يشتغل (بطء تحميل أو لينك غلط).",
    en: "Bitly far below Meta's clicks means clicks were charged that never travelled. GA4 far below Bitly means people arrive but leave before tracking fires — slow load or a broken destination.",
  },
  bitlyVerdictHealthy: { ar: "سليم", en: "Healthy" },
  bitlyVerdictClicksLost: { ar: "نقرات ضايعة", en: "Clicks lost" },
  bitlyVerdictLandingLost: { ar: "تسريب عند الوصول", en: "Landing loss" },
  bitlyVerdictNoLink: { ar: "مفيش رابط مربوط", en: "No link matched" },
  bitlyVerdictNoClicks: { ar: "مفيش نقرات", en: "No clicks" },
  bitlyNoData: {
    ar: "متوصل ✓ — اضغط «مزامنة» عشان نسحب الروابط والنقرات من حسابك.",
    en: "Connected ✓ — press Sync to pull your links and their clicks.",
  },
  bitlyTruncated: {
    ar: "المزامنة وقفت بدري (حد الوقت أو حد الطلبات عند Bitly) — اضغط مزامنة تاني عشان تكمّل.",
    en: "The sync stopped early (time budget or Bitly's rate limit) — press Sync again to finish.",
  },
  bitlyDest: { ar: "الوجهة", en: "Destination" },

  // errors
  loadError: {
    ar: "حصل خطأ أثناء تحميل بيانات الإعلانات — البيانات موجودة لكن التحميل فشل. جرّب تاني.",
    en: "Loading the ads data failed — the data is there, the request errored. Try again.",
  },
  retry: { ar: "إعادة المحاولة", en: "Retry" },
  accounts: { ar: "حسابات", en: "accounts" },

  // notes
  attributionNote: {
    ar: "العائد الفعلي = مبيعات الكتاب الحقيقية في نفس فترة الإعلان، موزّعة على إعلاناته بنسبة الإنفاق. ده سقف أعلى (بيشمل البيع العضوي)، لكنه أقرب للحقيقة من رقم ميتا اللي بيحسب أي شراء بعد النقر.",
    en: "Actual ROAS = the book's real sales in the ad's own window, split across its ads by spend share. It's an upper bound (organic sales are included) but far closer to reality than Meta's number, which credits any purchase after a click.",
  },
  levelNote: {
    ar: "ميتا بتكرر نفس الإنفاق في صفوف الحملة والمجموعة والإعلان — إحنا بنجمع من مستوى الإعلان بس.",
    en: "Meta repeats the same spend on campaign, ad-set and ad rows — we only ever total the ad level.",
  },
} as const;

export type AdKey = keyof typeof AD;

export function adText(lang: Lang) {
  return (key: AdKey) => AD[key][lang];
}

export function bi(lang: Lang, v: { ar: string; en: string }) {
  return v[lang];
}
