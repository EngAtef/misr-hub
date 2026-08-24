"use client";

// GAPS center — every data source (store orders, GA4, Meta, Search Console)
// tells a different story about the same month. This page puts the four
// witnesses side by side, names each gap, and says what to do about it.
// The store's orders table is always the truth; everything else is a claim.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Link2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  BarChart3,
  Megaphone,
  Search,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner, KpiCard, ChartCard } from "@/components/ui";
import { formatMoney, formatNumber, toCsv, downloadCsv, cn } from "@/lib/utils";

// ------------------------------------------------------------------ strings

type Bi = { ar: string; en: string };
const S = {
  subtitle: {
    ar: "مطابقة كل مصادر البيانات مع الطلبات الحقيقية — فين الفجوة ومين بيقول الحقيقة",
    en: "Reconcile every data source against real orders — where the gaps are and who tells the truth",
  },
  refresh: { ar: "تحديث", en: "Refresh" },
  sources: { ar: "المصادر المتصلة", en: "Connected sources" },
  ordersSrc: { ar: "طلبات المتجر", en: "Store orders" },
  ga4Src: { ar: "GA4", en: "GA4" },
  metaSrc: { ar: "إعلانات ميتا", en: "Meta Ads" },
  gscSrc: { ar: "Search Console", en: "Search Console" },
  syncedThrough: { ar: "بيانات حتى", en: "Data through" },
  truthChain: { ar: "سلسلة الحقيقة — نفس الشهر بثلاث روايات", en: "The truth chain — one month, three stories" },
  storeTruth: { ar: "المتجر (الحقيقة)", en: "Store (the truth)" },
  ga4Tracked: { ar: "GA4 (المتتبَّع)", en: "GA4 (tracked)" },
  metaClaimed: { ar: "ميتا (المُدَّعى)", en: "Meta (claimed)" },
  truthNote: {
    ar: "المتجر هو المرجع. GA4 شاف أقل لأن في طلبات مش متتبَّعة. ميتا بتنسب لنفسها جزء كبير من كل المبيعات — منها مبيعات كانت هتحصل برضه.",
    en: "The store is the reference. GA4 saw less because some orders are untracked. Meta credits itself a big share of all sales — including sales that would have happened anyway.",
  },
  trackingRate: { ar: "نسبة التتبع", en: "Tracking rate" },
  ofOrders: { ar: "من الطلبات وصلت GA4", en: "of orders reached GA4" },
  untrackedRevenue: { ar: "إيراد غير متتبَّع", en: "Untracked revenue" },
  untrackedSub: { ar: "طلبات حقيقية GA4 ماشافهاش", en: "real orders GA4 never saw" },
  metaClaimRatio: { ar: "مبالغة ميتا", en: "Meta over-claim" },
  metaClaimSub: { ar: "المُدَّعى ÷ ما تتبعه GA4 من ميتا", en: "claimed ÷ GA4-attributed to Meta" },
  unmappedSpend: { ar: "إنفاق غير مربوط", en: "Unlinked spend" },
  unmappedSub: { ar: "إعلانات من غير كتاب/قائمة", en: "ads with no book/list link" },
  findings: { ar: "الخلاصة — الفجوات بالترتيب", en: "Findings — the gaps, ranked" },
  gapTracking: { ar: "فجوة التتبع حسب القناة", en: "Tracking gap by channel" },
  channel: { ar: "القناة", en: "Channel" },
  orders: { ar: "طلبات", en: "Orders" },
  revenue: { ar: "إيراد", en: "Revenue" },
  tracked: { ar: "متتبَّع", en: "Tracked" },
  untracked: { ar: "غير متتبَّع", en: "Untracked" },
  gapPayment: { ar: "فجوة التتبع حسب طريقة الدفع", en: "Tracking gap by payment method" },
  payment: { ar: "طريقة الدفع", en: "Payment" },
  total: { ar: "الإجمالي", en: "Total" },
  untrackedOrders: { ar: "الطلبات الغير متتبَّعة", en: "Untracked orders" },
  untrackedOrdersSub: {
    ar: "طلبات حقيقية في المتجر لكن GA4 ماسجّلهاش — الأعلى قيمة الأول",
    en: "Real store orders GA4 never recorded — highest value first",
  },
  exportCsv: { ar: "تصدير CSV", en: "Export CSV" },
  showAll: { ar: "عرض الكل", en: "Show all" },
  showLess: { ar: "عرض أقل", en: "Show less" },
  metaReality: { ar: "ميتا تحت الاختبار — من الضغطة للطلب", en: "Meta reality check — from click to order" },
  metaClicks: { ar: "ضغطات ميتا", en: "Meta link clicks" },
  ga4MetaSessions: { ar: "جلسات وصلت فعلاً (GA4)", en: "Sessions that arrived (GA4)" },
  ga4MetaTx: { ar: "معاملات منسوبة لميتا (GA4)", en: "GA4 transactions from Meta" },
  metaPurchClaimed: { ar: "مشتريات ميتا المُدَّعاة", en: "Meta claimed purchases" },
  clickLoss: {
    ar: "من كل 100 ضغطة مدفوعة، حوالي {n} بس بتوصل كجلسة متتبَّعة — الباقي بيضيع في متصفح فيسبوك الداخلي أو ضغطات غير حقيقية.",
    en: "Out of every 100 paid clicks, only ~{n} arrive as a tracked session — the rest die in Facebook's in-app browser or are low-quality clicks.",
  },
  booksWitness: { ar: "لكل كتاب: ميتا بتقول إيه والمتجر بيقول إيه", en: "Per book: what Meta says vs what the store says" },
  booksWitnessSub: {
    ar: "نفس جدول «الفجوة» في مركز الإعلانات — الكتب المربوطة بالإعلانات فقط. اربط الباقي من تبويب الربط.",
    en: "Same as the Gap tab in Ads Center — only ad-linked books appear. Link the rest from the Mapping tab.",
  },
  book: { ar: "الكتاب", en: "Book" },
  spend: { ar: "الإنفاق", en: "Spend" },
  metaValue: { ar: "قيمة ميتا", en: "Meta value" },
  storeRevenue: { ar: "إيراد المتجر", en: "Store revenue" },
  metaRoas: { ar: "ROAS ميتا", en: "Meta ROAS" },
  actualRoas: { ar: "ROAS حقيقي", en: "Real ROAS" },
  verdict: { ar: "الحكم", en: "Verdict" },
  vImpossible: { ar: "مستحيل", en: "Impossible" },
  vInflated: { ar: "مُبالَغ", en: "Inflated" },
  vPlausible: { ar: "منطقي", en: "Plausible" },
  unmappedTitle: { ar: "إعلانات من غير ربط — إنفاق أعمى", en: "Unlinked ads — blind spend" },
  unmappedNote: {
    ar: "الإعلانات دي بتصرف لكن مش مربوطة بكتاب أو قائمة، فمفيش طريقة نعرف رجّعت إيه فعلاً. الربط يدوي من مركز الإعلانات ← تبويب الربط.",
    en: "These ads spend money but aren't linked to a book or list, so their real return is invisible. Link them manually in Ads Center → Mapping tab.",
  },
  adName: { ar: "الإعلان", en: "Ad" },
  campaign: { ar: "الحملة", en: "Campaign" },
  goMapping: { ar: "افتح تبويب الربط", en: "Open Mapping tab" },
  whereRevenue: { ar: "الإيراد المتتبَّع جاي منين (GA4)", en: "Where tracked revenue comes from (GA4)" },
  bucket: { ar: "المصدر", en: "Source" },
  txCount: { ar: "معاملات", en: "Transactions" },
  bMeta: { ar: "ميتا (فيسبوك + انستجرام)", en: "Meta (FB + IG)" },
  bGoogleOrganic: { ar: "جوجل مجاني (SEO)", en: "Google organic (SEO)" },
  bGoogleAds: { ar: "إعلانات جوجل", en: "Google Ads" },
  bDirect: { ar: "مباشر", en: "Direct" },
  bShortlinks: { ar: "روابط مختصرة (bit.ly)", en: "Short links (bit.ly)" },
  bReferral: { ar: "إحالات أخرى", en: "Other referrals" },
  bOther: { ar: "أخرى", en: "Other" },
  fragTitle: { ar: "فوضى الوسوم — نفس ميتا بـ 15 اسم", en: "Tag chaos — Meta arrives under 15 names" },
  fragNote: {
    ar: "لما الإعلان ينزل من غير UTM، الزيارة بتوصل باسم m.facebook.com / referral وبتتلخبط مع الأورجانيك. كل صف «بدون وسم» هنا معناه إعلانات أو بوستات نازلة من غير UTM.",
    en: "When an ad runs without UTM tags, its traffic lands as m.facebook.com / referral and mixes with organic. Every untagged row here means ads or posts running without UTMs.",
  },
  tagged: { ar: "موسوم", en: "Tagged" },
  untagged: { ar: "بدون وسم", en: "Untagged" },
  organicTitle: { ar: "البحث المجاني — GSC مقابل GA4", en: "Organic search — GSC vs GA4" },
  gscClicks: { ar: "ضغطات جوجل (GSC)", en: "Google clicks (GSC)" },
  ga4OrgSessions: { ar: "جلسات أورجانيك (GA4)", en: "Organic sessions (GA4)" },
  ga4OrgRevenue: { ar: "إيراد الأورجانيك", en: "Organic revenue" },
  organicNote: {
    ar: "GSC بيعدّ ضغطات نتائج البحث فقط، وGA4 بيعدّ الجلسات — طبيعي GA4 يكون أعلى شوية. الرقمين قريبين = التتبع سليم.",
    en: "GSC counts search-result clicks only while GA4 counts sessions — GA4 being slightly higher is normal. Close numbers = healthy tracking.",
  },
  currentMonth: { ar: "(جاري)", en: "(running)" },
  dailyTitle: { ar: "يوم بيوم — الطلبات مقابل GA4", en: "Day by day — orders vs GA4" },
  dailySub: {
    ar: "لو يوم نزلت تغطيته فجأة، الفجوة اتفتحت في اليوم ده — اعرف إيه اللي اتغير فيه (إعلان جديد؟ مشكلة دفع؟ تحديث للموقع؟)",
    en: "If a day's coverage suddenly drops, the gap opened that day — ask what changed (new ad? payment issue? site update?)",
  },
  coverage: { ar: "التغطية", en: "Coverage" },
  ga4Purchases: { ar: "مشتريات GA4", en: "GA4 purchases" },
  notSyncedYet: { ar: "لم يُزامن بعد", en: "not synced yet" },
  weeklyTitle: { ar: "أسبوع بأسبوع", en: "Week by week" },
  weeklySub: {
    ar: "شرائح ثابتة (١–٧، ٨–١٤...) عشان تطابق فترات مزامنة ميتا الأسبوعية. أرقام ميتا الأسبوعية متاحة من أغسطس ٢٠٢٦ (يوليو كان استيراد شهري واحد).",
    en: "Fixed slices (1–7, 8–14…) matching Meta's weekly sync periods. Weekly Meta numbers exist from Aug 2026 onward (July was one monthly import).",
  },
  week: { ar: "الأسبوع", en: "Week" },
  metaSpendCol: { ar: "إنفاق ميتا", en: "Meta spend" },
  mer: { ar: "MER (إيراد ÷ إنفاق)", en: "MER (revenue ÷ spend)" },
  daysNotSynced: { ar: "أيام غير مُزامنة", en: "days not synced" },
  syncLagBanner: {
    ar: "الشهر لسه شغال: كل الأرقام هنا (الطلبات وGA4 والتتبع) محسوبة على الأيام المكتملة حتى {ga4} — اليوم الجاري مستبعد لأن GA4 بيتزامن مرتين يوميًا فقط. آخر مزامنة GA4: {sync}.",
    en: "Running month: every figure here (orders, GA4, tracking) covers complete days through {ga4} — today is left out because GA4 syncs twice a day. Last GA4 sync: {sync}.",
  },
  syncedAt: { ar: "آخر مزامنة", en: "synced" },
  lookupTitle: { ar: "ابحث عن كتاب — كل طلب ومصدره بالدليل", en: "Book lookup — every order and its proven source" },
  lookupSub: {
    ar: "اكتب اسم الكتاب أو SKU (٣ حروف على الأقل). كل طلب بيظهر بمصدره من GA4 — واللي ملوش مصدر بيتقال عليه صراحةً: فجوة، أو لسه في انتظار مزامنة GA4.",
    en: "Type a book name or SKU (3+ characters). Each order shows its GA4 source — and orders without one are named honestly: a gap, or still awaiting GA4 sync.",
  },
  lookupPlaceholder: { ar: "اسم الكتاب أو SKU…", en: "Book name or SKU…" },
  searchBtn: { ar: "بحث", en: "Search" },
  searching: { ar: "جاري البحث…", en: "Searching…" },
  lookupEmpty: { ar: "لا توجد طلبات مطابقة في الفترة دي", en: "No matching orders in this period" },
  uniqueOrders: { ar: "طلب فريد", en: "unique orders" },
  itemRows: { ar: "سطر صنف", en: "item rows" },
  srcMeta: { ar: "ميتا", en: "Meta" },
  srcGoogleOrganic: { ar: "جوجل مجاني", en: "Google organic" },
  srcGoogleAds: { ar: "إعلانات جوجل", en: "Google Ads" },
  srcDirect: { ar: "مباشر", en: "Direct" },
  srcShortlinks: { ar: "روابط مختصرة", en: "Short links" },
  srcOther: { ar: "أخرى", en: "Other" },
  srcGap: { ar: "فجوة — بدون مصدر", en: "Gap — no source" },
  srcAwaiting: { ar: "بانتظار المزامنة", en: "Awaiting sync" },
  campaignCol: { ar: "الحملة (من UTM)", en: "Campaign (from UTM)" },
  sourceCol: { ar: "المصدر", en: "Source" },
  monthlyReport: { ar: "CSV", en: "CSV" },
  designedReport: { ar: "تقرير الشهر (طباعة/PDF)", en: "Monthly report (print/PDF)" },
  okrReport: { ar: "تقرير OKR الشهري", en: "Monthly OKR report" },
  okrTitle: { ar: "تقرير OKR الشهري", en: "Monthly OKR Report" },
  okrGross: { ar: "الإجمالي (Gross)", en: "Gross" },
  okrNet: { ar: "الصافي (Net)", en: "Net" },
  okrMetric: { ar: "المؤشر", en: "Metric" },
  okrRevenue: { ar: "الإيراد (ج.م)", en: "Revenue (EGP)" },
  okrOrders: { ar: "الطلبات", en: "Orders" },
  okrThrough: { ar: "حتى", en: "Through" },
  okrDefs: {
    ar: "الإجمالي = قيمة منتجات المكتبة (بدون الشحن) مع استبعاد إيراد الطلبات الملغاة والمرتجعة/الفاشلة، وطلباته = الطلبات المسجَّلة بأي حالة. الصافي = الأصناف المسلَّمة + رسوم شحن تلك الطلبات — نفس أساس صفحة الأهداف — وطلباته = المسلَّمة فقط. CR = الطلبات ÷ الجلسات، ROAS = الإيراد ÷ الإنفاق، والإنفاق مجموع على مستوى الإعلان فقط",
    en: "Gross = bookstore products value (delivery excluded) with cancelled and returned/failed revenue removed; its orders count every status. Net = delivered items + those orders' delivery fees — the same basis as the Targets page — and its orders are the delivered subset. CR = orders ÷ sessions, ROAS = revenue ÷ spend, spend summed at ad level only",
  },
  netReport: { ar: "تقرير الصافي (مسلَّم)", en: "Net report (delivered)" },
  netTitle: { ar: "تقرير المصادر — إجمالي وصافي", en: "Source Report — Gross & Net" },
  netDefs: {
    ar: "الإجمالي = قيمة منتجات المكتبة (بدون الشحن وبدون الأضواء) مع استبعاد إيراد الملغاة والمرتجعة/الفاشلة. الصافي = الأصناف المسلَّمة + رسوم شحن تلك الطلبات — نفس أساس صفحة الأهداف. الإسناد = آخر نقرة GA4؛ حدود الشهر بتوقيت مصر",
    en: "Gross = bookstore products value (delivery and AL-Adwaa excluded) with cancelled and returned/failed revenue removed. Net = delivered items + those orders' delivery fees — the same basis as the Targets page. Attribution = GA4 last-click; month boundaries on Egypt local time",
  },
  colGrossRevenue: { ar: "إيراد إجمالي", en: "Gross revenue" },
  colNetRevenue: { ar: "إيراد صافي", en: "Net revenue" },
  colDelivered: { ar: "مسلَّمة", en: "Delivered" },
  colPending: { ar: "قيد التسليم", en: "In transit" },
  netPendingNote: {
    ar: "الصافي لا يحسب الطلب إلا بعد تسليمه؛ في الشهر الجاري توجد طلبات قيد التسليم فيظهر الصافي منخفضًا ويرتفع تدريجيًا مع اكتمال التسليم — قارن الصافي بين الشهور المقفولة فقط.",
    en: "Net counts an order only after delivery; in a running month, in-transit orders make net look low and it keeps rising as they deliver — compare net only between closed months.",
  },
  repGenerated: { ar: "أُنشئ في", en: "Generated" },
  repPrint: { ar: "طباعة / حفظ PDF", en: "Print / Save PDF" },
  repScopeTitle: { ar: "نطاق التقرير", en: "Report scope" },
  repBySource: { ar: "الإيراد ومعدل التحويل حسب المصدر", en: "Revenue & conversion rate by source" },
  repTrackedShare: { ar: "من الطلبات متتبَّعة في GA4", en: "of orders tracked in GA4" },
  repMetaCheck: { ar: "فحص أرقام ميتا", en: "Meta reality check" },
  repMetaClaimed: { ar: "إيراد تدّعيه ميتا", en: "Meta claimed revenue" },
  repGa4Meta: { ar: "ما نسبه GA4 لميتا", en: "GA4-attributed to Meta" },
  repBlendedMer: { ar: "MER الكلي (إيراد ÷ إنفاق)", en: "Blended MER (revenue ÷ spend)" },
  repClicksArrived: { ar: "ضغطات وصلت كجلسات", en: "Clicks that arrived as sessions" },
  repGapsTitle: { ar: "فجوات التتبع", en: "Tracking gaps" },
  repTitle: { ar: "تقرير المصادر والإيراد الشهري", en: "Monthly Source & Revenue Report" },
  repDefs: {
    ar: "الإيراد = قيمة منتجات المكتبة فقط (بدون الشحن وبدون الأضواء)؛ الطلبات الملغاة والمرتجعة/الفاشلة محسوبة كعدد ومستبعدة من الإيراد؛ الإسناد = آخر نقرة GA4 مطابقة لسجلات الطلبات؛ الإنفاق مجموع على مستوى الإعلان فقط؛ حدود الشهر بتوقيت مصر",
    en: "Revenue = bookstore products value only (delivery and AL-Adwaa excluded); cancelled and returned/failed orders counted but their revenue removed; attribution = GA4 last-click matched to order records; spend summed at ad level only; month boundaries on Egypt local time",
  },
  repOnePool: {
    ar: "كل حسابات ميتا إعلانات للمكتبة ككل — أسماء الحسابات لا تعني فئات منتجات",
    en: "All Meta accounts advertise the bookstore overall — account names are not product categories",
  },
  repAdwaaTitle: { ar: "الأضواء (خارج حسابات الإعلانات — للعلم)", en: "AL-Adwaa (outside ad metrics — for information)" },
  repAdwaaRevenue: { ar: "إيراد الأضواء (ج.م)", en: "AL-Adwaa revenue (EGP)" },
  repAdwaaOrders: { ar: "طلبات فيها أضواء", en: "Orders containing AL-Adwaa" },
  repAdwaaOnly: { ar: "طلبات أضواء فقط", en: "AL-Adwaa-only orders" },
  repAdwaaFromAds: { ar: "أضواء اشتراها زوار الإعلانات (ج.م)", en: "AL-Adwaa bought by ad visitors (EGP)" },
  repAdwaaNote: {
    ar: "الأضواء غير مُعلَن عنها، فقيمتها مستبعدة من كل أرقام الإعلانات (الإيراد، MER، نسبة الإنفاق). لكن جزء من زوار الإعلانات بيشتري أضواء — الرقم ده معلومة إضافية مش أداء إعلان.",
    en: "AL-Adwaa is not advertised, so its value is excluded from every ads number (revenue, MER, spend share). But some ad visitors do buy AL-Adwaa — that figure is extra information, not ad performance.",
  },
  repInclAdwaa: { ar: "الإيراد شامل الأضواء", en: "Revenue incl. AL-Adwaa" },
  repSessions: { ar: "الجلسات", en: "Sessions" },
  repOrders: { ar: "الطلبات", en: "Orders" },
  repCancelled: { ar: "ملغاة", en: "Cancelled" },
  repReturned: { ar: "مرتجعة/فاشلة", en: "Returned / failed" },
  repReturnedRemoved: { ar: "إيراد مرتجع (مستبعد)", en: "Returned revenue (excluded)" },
  repRevenue: { ar: "الإيراد (ج.م)", en: "Revenue (EGP)" },
  repDelivery: { ar: "رسوم الشحن (مستبعدة)", en: "Delivery fees (excluded)" },
  repCR: { ar: "معدل التحويل", en: "Conversion rate" },
  repAOV: { ar: "متوسط قيمة الطلب", en: "AOV" },
  repSpend: { ar: "إنفاق الإعلانات (ج.م)", en: "Ad spend (EGP)" },
  repSpendPct: { ar: "الإنفاق من الإيراد", en: "Spend % of revenue" },
  repSpendByAccount: { ar: "الإنفاق حسب الحساب", en: "Spend by account" },
  repSource: { ar: "المصدر", en: "Source" },
  repCampaignBlock: { ar: "قابلية قياس الحملات", en: "Campaign measurability" },
  repOrdersWithCampaign: { ar: "طلبات باسم حملة صالح", en: "Orders with usable campaign name" },
  repCampaignRevenue: { ar: "إيراد معروف الحملة (ج.م)", en: "Campaign-identified revenue (EGP)" },
  repCombosPurch: { ar: "توليفات source/medium على المشتريات", en: "Source/medium combos on purchases" },
  repCombosAll: { ar: "توليفات source/medium على كل الزيارات", en: "Source/medium combos across all traffic" },
  repTotal: { ar: "الإجمالي", en: "Total" },
  bMetaTagged: { ar: "ميتا — إعلانات موسومة UTM", en: "Meta — UTM-tagged ads" },
  bMetaUntagged: { ar: "ميتا — بدون وسم UTM", en: "Meta — untagged (no UTM)" },
  bSeo: { ar: "بحث مجاني (SEO)", en: "SEO organic" },
  bAppstore: { ar: "Google Play / تطبيق مجاني", en: "Google Play / app organic" },
  bUntracked: { ar: "غير متتبَّع في GA4", en: "Not tracked in GA4" },
  bOtherMalformed: { ar: "إحالات أخرى ووسوم تالفة", en: "Other referral & malformed tags" },
  howToRead: { ar: "إزاي تقرأ الصفحة دي", en: "How to read this page" },
  howToReadBody: {
    ar: "١) المتجر هو الحقيقة الوحيدة — كل طلب فيه فلوس حقيقية. ٢) GA4 بيشوف الطلبات اللي البكسل نجح يتتبعها بس، وبيوزعها على المصادر بآخر ضغطة. ٣) ميتا بتحسب لنفسها أي طلب من حد شاف أو ضغط إعلان خلال أيام — علشان كده رقمها أكبر من الحقيقة دايمًا. ٤) الفجوات مش معناها بيانات مزيفة: كل معاملة في GA4 اتطابقت مع طلب حقيقي. المشكلة في اللي مش متسجّل، مش في اللي متسجّل.",
    en: "1) The store is the only truth — every order is real money. 2) GA4 only sees orders the pixel managed to track, credited to the last click. 3) Meta credits itself any order from someone who saw or clicked an ad within its window — so its number always exceeds reality. 4) Gaps don't mean fake data: every GA4 transaction matched a real order. The problem is what's missing, not what's there.",
  },
  loadError: { ar: "فشل تحميل البيانات", en: "Failed to load" },
  noData: { ar: "لا توجد بيانات لهذا الشهر", en: "No data for this month" },
  date: { ar: "التاريخ", en: "Date" },
  status: { ar: "الحالة", en: "Status" },
  city: { ar: "المدينة", en: "City" },
  amount: { ar: "المبلغ", en: "Amount" },
} satisfies Record<string, Bi>;

// ------------------------------------------------------------------- types

interface Report {
  month: string;
  orders: { total: number; revenue: number; net_revenue: number; by_status: { status: string; n: number; revenue: number }[] };
  ga4: { tx: number; revenue: number; sessions: number; purchases: number; days: number; last_day: string | null };
  meta: { ads: number; campaigns: number; spend: number; purchases: number; value: number; clicks: number; atc: number; checkouts: number };
  gsc: { clicks: number; impressions: number; days: number; last_day: string | null };
  freshness: {
    orders_last_date: string | null;
    orders_last_import: string | null;
    ga4_last_day: string | null;
    ga4_last_sync?: string | null;
    meta_last_period: string | null;
    meta_last_import: string | null;
    gsc_last_day: string | null;
    gsc_last_sync?: string | null;
  };
  tracking: {
    orders: number;
    tracked: number;
    untracked: number;
    ga4_only: number;
    ga4_transactions: number;
    orders_revenue: number;
    ga4_revenue: number;
    untracked_revenue: number;
    untracked_by_source: Record<string, number>;
    payment_breakdown: { payment_method: string; untracked: number; total: number }[];
  };
  by_channel: { channel: string; orders: number; revenue: number; tracked: number; untracked_revenue: number }[];
  attribution: { bucket: string; tx: number; revenue: number }[];
  fragmentation: { source: string; medium: string; bucket: string; tagged: boolean; tx: number; revenue: number }[];
  funnel: {
    meta_clicks: number;
    ga4_meta_sessions: number;
    ga4_meta_tx: number;
    ga4_meta_revenue: number;
    meta_claimed_purchases: number;
    meta_claimed_value: number;
  };
  organic: { gsc_clicks: number; ga4_sessions: number; ga4_tx: number; ga4_revenue: number };
  mapping: {
    ads: number;
    mapped: number;
    unmapped: number;
    spend: number;
    unmapped_spend: number;
    unmapped_top: { ad_name: string | null; campaign_name: string | null; spend: number }[];
  };
  daily: DailyRow[];
  weekly: WeeklyRow[];
}

interface DailyRow {
  day: string;
  orders: number;
  revenue: number;
  ga4_purchases: number | null; // null = that day never synced
  ga4_revenue: number | null;
  sessions: number | null;
}

interface WeeklyRow {
  week_no: number;
  from: string;
  to: string;
  orders: number;
  revenue: number;
  ga4_purchases: number | null;
  ga4_revenue: number | null;
  unsynced_days: number;
  meta_spend: number | null;
  meta_purchases: number | null;
  meta_value: number | null;
}

interface GapRow {
  book_label: string;
  spend: number;
  meta_purchases: number;
  meta_value: number;
  meta_roas: number | null;
  store_orders: number;
  store_revenue: number;
  actual_roas: number | null;
  claim_vs_reality: number | null;
  verdict: "impossible" | "inflated" | "plausible";
}

interface UntrackedOrder {
  order_number: string;
  order_date: string;
  order_status: string | null;
  payment_method: string | null;
  source: string | null;
  city: string | null;
  total_order_amount: number | null;
}

type Finding = { severity: "red" | "amber" | "green"; title: string; body: string; action?: { href: string; label: string } };

// fn_gaps_book_orders — one row per (order, matched SKU)
interface BookOrderRow {
  order_number: string;
  order_date: string;
  order_status: string | null;
  app_channel: string | null;
  payment_method: string | null;
  city: string | null;
  order_total: number | null;
  sku: string;
  product_name: string | null;
  item_price: number | null;
  ga4_source: string | null;
  ga4_medium: string | null;
  ga4_campaign: string | null;
  bucket: "meta" | "google_ads" | "google_organic" | "direct" | "shortlinks" | "other" | "gap" | "awaiting";
}

const BUCKET_LABELS: Record<string, Bi> = {
  meta: S.bMeta,
  google_organic: S.bGoogleOrganic,
  google_ads: S.bGoogleAds,
  direct: S.bDirect,
  shortlinks: S.bShortlinks,
  referral: S.bReferral,
  other: S.bOther,
};

// fn_gaps_source_report — the monthly export payload
interface SourceReport {
  month: string;
  totals: {
    sessions: number;
    orders: number;
    cancelled: number;
    returned: number;
    returned_revenue: number;
    revenue: number;
    revenue_incl_adwaa: number;
    delivery_fees: number;
    spend: number;
    cr: number | null;
    aov: number | null;
    spend_pct_of_revenue: number | null;
  };
  spend_by_account: { account: string; spend: number }[];
  rows: {
    bucket: string;
    sessions: number | null;
    orders: number;
    cancelled: number;
    returned: number;
    returned_revenue: number;
    revenue: number;
    adwaa_revenue: number;
    cr: number | null;
    aov: number | null;
  }[];
  adwaa: {
    revenue: number;
    orders: number;
    adwaa_only_orders: number;
    from_ads_revenue: number;
    from_ads_orders: number;
  };
  campaigns: {
    orders_with_campaign: number;
    pct_of_orders: number | null;
    campaign_revenue: number;
    combos_on_purchases: number;
    combos_all_traffic: number;
  };
}

// fn_gaps_okr_report — totals only, no gaps / no Adwaa sections
interface OkrReport {
  month: string;
  through: string;
  sessions: number;
  spend: number;
  gross: { revenue: number; orders: number; cancelled: number; returned: number; cr: number | null; roas: number | null };
  net: { revenue: number; orders: number; cr: number | null; roas: number | null };
}

// fn_gaps_net_source_report — gross + net per source (net = delivered items +
// those orders' delivery fees, the Targets basis)
interface NetSourceReport {
  month: string;
  through: string;
  totals: {
    sessions: number;
    spend: number;
    gross: { revenue: number; orders: number; cancelled: number; returned: number; cr: number | null; roas: number | null };
    net: { revenue: number; orders: number; cr: number | null; roas: number | null };
    pending: { orders: number; book_value: number };
  };
  rows: {
    bucket: string;
    sessions: number | null;
    orders: number;
    gross_revenue: number;
    delivered: number;
    net_revenue: number;
    pending: number;
    pending_value: number;
  }[];
}

// current month first (the one being fixed), then 13 back.
// "current" follows Egypt time, not the device or UTC.
function monthOptions(): string[] {
  const [y, m] = new Date()
    .toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" })
    .split("-")
    .map(Number);
  const list: string[] = [];
  for (let i = 0; i <= 13; i++) {
    list.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 10));
  }
  return list;
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? (part * 100) / whole : null;
}

function monthLabelFor(iso: string, lang: "ar" | "en") {
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export default function GapsPage() {
  const { lang } = useLang();
  const tx = useCallback((v: Bi) => v[lang], [lang]);
  const supabase = useMemo(() => createClient(), []);

  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0]);
  const [report, setReport] = useState<Report | null>(null);
  const [gapRows, setGapRows] = useState<GapRow[]>([]);
  const [untracked, setUntracked] = useState<UntrackedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAllUntracked, setShowAllUntracked] = useState(false);
  const [showAllBooks, setShowAllBooks] = useState(false);

  // book lookup — searches all months, not just the selected one
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupRows, setLookupRows] = useState<BookOrderRow[] | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [reportBusy, setReportBusy] = useState(false);

  // one CSV, sectioned like the hand-made July report, reconciling by design
  const downloadMonthlyReport = useCallback(async () => {
    setReportBusy(true);
    const { data, error } = await supabase.rpc("fn_gaps_source_report", { p_month: month });
    setReportBusy(false);
    if (error || !data) {
      setLoadError(error?.message ?? "report failed");
      return;
    }
    const r = data as SourceReport;
    const esc = (v: string | number | null | undefined) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const line = (...cells: (string | number | null | undefined)[]) => cells.map(esc).join(",");
    const bucketLabel = (b: string) =>
      ({
        meta_tagged: tx(S.bMetaTagged),
        meta_untagged: tx(S.bMetaUntagged),
        bitly: tx(S.bShortlinks),
        google_ads: tx(S.bGoogleAds),
        direct: tx(S.bDirect),
        seo: tx(S.bSeo),
        appstore: tx(S.bAppstore),
        other: tx(S.bOtherMalformed),
        untracked: tx(S.bUntracked),
      })[b] ?? b;
    const t = r.totals;
    const out: string[] = [
      line(tx(S.repTitle), monthLabelFor(r.month, lang)),
      line("", tx(S.repDefs)),
      "",
      line(tx(S.repSessions), t.sessions),
      line(tx(S.repOrders), t.orders),
      line(tx(S.repCancelled), t.cancelled),
      line(tx(S.repReturned), t.returned),
      line(tx(S.repReturnedRemoved), t.returned_revenue),
      line(tx(S.repRevenue), t.revenue),
      line(tx(S.repDelivery), t.delivery_fees),
      line(tx(S.repCR), t.cr !== null ? `${t.cr}%` : ""),
      line(tx(S.repAOV), t.aov),
      line(tx(S.repSpend), t.spend),
      line(tx(S.repSpendPct), t.spend_pct_of_revenue !== null ? `${t.spend_pct_of_revenue}%` : ""),
      "",
      line(tx(S.repSpendByAccount)),
      line("", tx(S.repOnePool)),
      ...r.spend_by_account.map((a) => line(a.account, a.spend)),
      "",
      line(tx(S.repAdwaaTitle)),
      line("", tx(S.repAdwaaNote)),
      line(tx(S.repAdwaaRevenue), r.adwaa.revenue),
      line(tx(S.repAdwaaOrders), r.adwaa.orders),
      line(tx(S.repAdwaaOnly), r.adwaa.adwaa_only_orders),
      line(tx(S.repAdwaaFromAds), `${r.adwaa.from_ads_revenue} (${r.adwaa.from_ads_orders} ${tx(S.uniqueOrders)})`),
      line(tx(S.repInclAdwaa), r.totals.revenue_incl_adwaa),
      "",
      line(tx(S.repSource), tx(S.repSessions), tx(S.repOrders), tx(S.repCancelled), tx(S.repReturned), "CR %", tx(S.repRevenue), tx(S.repAOV)),
      ...r.rows.map((row) => line(bucketLabel(row.bucket), row.sessions, row.orders, row.cancelled, row.returned, row.cr, row.revenue, row.aov)),
      line(tx(S.repTotal), t.sessions, t.orders, t.cancelled, t.returned, t.cr, t.revenue, t.aov),
      "",
      line(tx(S.repCampaignBlock)),
      line(tx(S.repOrdersWithCampaign), `${r.campaigns.orders_with_campaign} (${r.campaigns.pct_of_orders ?? 0}%)`),
      line(tx(S.repCampaignRevenue), r.campaigns.campaign_revenue),
      line(tx(S.repCombosPurch), r.campaigns.combos_on_purchases),
      line(tx(S.repCombosAll), r.campaigns.combos_all_traffic),
    ];
    // BOM so Excel opens the Arabic labels correctly
    downloadCsv(`source-report-${r.month.slice(0, 7)}.csv`, "﻿" + out.join("\n"));
  }, [supabase, month, tx, lang]);

  // styled, print-ready report in a new tab — same numbers as the CSV,
  // enriched with the tracking/meta sections already loaded on the page
  const openDesignedReport = useCallback(async () => {
    setReportBusy(true);
    const { data, error } = await supabase.rpc("fn_gaps_source_report", { p_month: month });
    setReportBusy(false);
    if (error || !data) {
      setLoadError(error?.message ?? "report failed");
      return;
    }
    const r = data as SourceReport;
    const rep = report; // fn_gaps_report payload for the same selected month
    const ar = lang === "ar";
    const nf = (n: number | null | undefined) =>
      n === null || n === undefined || isNaN(n) ? "—" : new Intl.NumberFormat("en-EG", { maximumFractionDigits: 0 }).format(n);
    const pc = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n}%`);
    const bucketLabel = (b: string) =>
      ({
        meta_tagged: tx(S.bMetaTagged),
        meta_untagged: tx(S.bMetaUntagged),
        bitly: tx(S.bShortlinks),
        google_ads: tx(S.bGoogleAds),
        direct: tx(S.bDirect),
        seo: tx(S.bSeo),
        appstore: tx(S.bAppstore),
        other: tx(S.bOtherMalformed),
        untracked: tx(S.bUntracked),
      })[b] ?? b;
    const t = r.totals;
    const trackedPctR = rep ? pct(rep.tracking.tracked, rep.tracking.orders) : null;
    const kpi = (label: string, value: string, sub = "") =>
      `<div class="kpi"><div class="kl">${label}</div><div class="kv">${value}</div>${sub ? `<div class="ks">${sub}</div>` : ""}</div>`;
    const srcRows = r.rows
      .map(
        (row) => `<tr${row.bucket === "untracked" ? ' class="warn"' : ""}>
          <td class="s">${bucketLabel(row.bucket)}</td>
          <td>${row.sessions === null ? "—" : nf(row.sessions)}</td>
          <td>${nf(row.orders)}</td>
          <td>${row.cr === null ? "—" : pc(row.cr)}</td>
          <td>${nf(row.revenue)}</td>
          <td>${nf(row.aov)}</td></tr>`
      )
      .join("");
    const accountRows = r.spend_by_account
      .map((a) => `<tr><td class="s">${a.account}</td><td>${nf(a.spend)}</td></tr>`)
      .join("");
    const channelRows = (rep?.by_channel ?? [])
      .map((c) => {
        const rate = pct(c.tracked, c.orders);
        return `<tr${rate !== null && rate < 50 ? ' class="warn"' : ""}><td class="s">${c.channel}</td><td>${nf(c.orders)}</td><td>${nf(c.tracked)}</td><td>${rate === null ? "—" : `${rate.toFixed(0)}%`}</td><td>${nf(c.untracked_revenue)}</td></tr>`;
      })
      .join("");
    const paymentRows = (rep?.tracking.payment_breakdown ?? [])
      .map((p) => {
        const lost = pct(p.untracked, p.total);
        return `<tr${lost !== null && lost > 20 ? ' class="warn"' : ""}><td class="s">${p.payment_method}</td><td>${nf(p.total)}</td><td>${nf(p.untracked)}</td><td>${lost === null ? "—" : `${lost.toFixed(0)}%`}</td></tr>`;
      })
      .join("");
    const fu = rep?.funnel;
    const arrival = fu && fu.meta_clicks > 0 ? Math.round((fu.ga4_meta_sessions * 100) / fu.meta_clicks) : null;
    const mer = t.spend > 0 ? (t.revenue / t.spend).toFixed(2) : "—";
    const html = `<!doctype html><html dir="${ar ? "rtl" : "ltr"}" lang="${ar ? "ar" : "en"}"><head><meta charset="utf-8">
<title>${tx(S.repTitle)} — ${monthLabelFor(r.month, lang)}</title>
<style>
  :root { --navy:#1f3864; --navy2:#2f5496; --line:#d9dce6; --soft:#eef1f8; --warn:#fdecec; }
  * { box-sizing:border-box; }
  body { font-family:"Segoe UI",Tahoma,Arial,sans-serif; color:#1a1f2e; margin:0; background:#f4f5f9; }
  .page { max-width:900px; margin:24px auto; background:#fff; padding:40px 48px; box-shadow:0 2px 14px rgba(30,40,90,.12); }
  h1 { color:var(--navy); font-size:24px; margin:0 0 2px; }
  .sub { color:#5a6478; font-size:12.5px; margin-bottom:6px; }
  .scope { background:var(--soft); border-inline-start:4px solid var(--navy2); padding:10px 14px; font-size:12px; color:#3a4358; border-radius:6px; margin:14px 0 22px; line-height:1.7; }
  h2 { color:var(--navy2); font-size:15.5px; margin:26px 0 10px; }
  .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
  .kpi { border:1px solid var(--line); border-radius:8px; padding:10px 12px; }
  .kl { font-size:10.5px; color:#6a7288; text-transform:uppercase; letter-spacing:.04em; }
  .kv { font-size:19px; font-weight:700; color:var(--navy); margin-top:2px; direction:ltr; }
  .ks { font-size:10.5px; color:#8a91a3; margin-top:1px; }
  table { width:100%; border-collapse:collapse; font-size:12.5px; }
  th { background:var(--navy); color:#fff; padding:8px 10px; text-align:start; font-weight:600; }
  td { padding:7px 10px; border-bottom:1px solid var(--line); text-align:start; direction:ltr; }
  td.s { direction:${ar ? "rtl" : "ltr"}; font-weight:600; color:#2a3145; }
  tbody tr:nth-child(even) { background:#f7f8fc; }
  tr.warn td { background:var(--warn); }
  tr.total td { background:var(--soft); font-weight:700; border-top:2px solid var(--navy2); }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:22px; }
  .note { font-size:11px; color:#7a8296; margin-top:6px; line-height:1.6; }
  .footer { margin-top:30px; font-size:10.5px; color:#9aa0b2; border-top:1px solid var(--line); padding-top:10px; display:flex; justify-content:space-between; }
  .printbtn { position:fixed; top:14px; inset-inline-end:14px; background:var(--navy2); color:#fff; border:0; border-radius:8px; padding:9px 16px; font-size:13px; cursor:pointer; font-family:inherit; }
  @media print { body{background:#fff} .page{box-shadow:none; margin:0; padding:10mm 12mm; max-width:none} .printbtn{display:none} }
</style></head><body>
<button class="printbtn" onclick="window.print()">${tx(S.repPrint)}</button>
<div class="page">
  <h1>${tx(S.repTitle)}</h1>
  <div class="sub">${monthLabelFor(r.month, lang)} — NM Smart App</div>
  <div class="scope"><b>${tx(S.repScopeTitle)}:</b> ${tx(S.repDefs)}. ${tx(S.repDelivery)}: ${nf(t.delivery_fees)} EGP. ${tx(S.repReturnedRemoved)}: ${nf(t.returned_revenue)} EGP.
  ${trackedPctR !== null ? ` ${trackedPctR.toFixed(1)}% ${tx(S.repTrackedShare)}.` : ""}</div>

  <div class="kpis">
    ${kpi(tx(S.repSessions), nf(t.sessions))}
    ${kpi(tx(S.repOrders), nf(t.orders), `${tx(S.repCancelled)}: ${nf(t.cancelled)} · ${tx(S.repReturned)}: ${nf(t.returned)}`)}
    ${kpi(tx(S.repRevenue), nf(t.revenue), `${tx(S.repInclAdwaa)}: ${nf(t.revenue_incl_adwaa)}`)}
    ${kpi(tx(S.repCR), pc(t.cr))}
    ${kpi(tx(S.repAOV), nf(t.aov))}
    ${kpi(tx(S.repSpend), nf(t.spend), `${tx(S.repSpendPct)}: ${pc(t.spend_pct_of_revenue)}`)}
    ${kpi(tx(S.repBlendedMer), mer)}
    ${(() => {
      const u = r.rows.find((x) => x.bucket === "untracked");
      return kpi(tx(S.untrackedRevenue), u ? nf(u.revenue) : "0", u ? `${nf(u.orders)} ${tx(S.untrackedSub)}` : "");
    })()}
  </div>

  <h2>${tx(S.repBySource)}</h2>
  <table><thead><tr><th>${tx(S.repSource)}</th><th>${tx(S.repSessions)}</th><th>${tx(S.repOrders)}</th><th>CR</th><th>${tx(S.repRevenue)}</th><th>${tx(S.repAOV)}</th></tr></thead>
  <tbody>${srcRows}<tr class="total"><td class="s">${tx(S.repTotal)}</td><td>${nf(t.sessions)}</td><td>${nf(t.orders)}</td><td>${pc(t.cr)}</td><td>${nf(t.revenue)}</td><td>${nf(t.aov)}</td></tr></tbody></table>

  <div class="grid2">
    <div>
      <h2>${tx(S.repSpendByAccount)}</h2>
      <table><thead><tr><th>${ar ? "الحساب" : "Account"}</th><th>${tx(S.repSpend)}</th></tr></thead>
      <tbody>${accountRows}<tr class="total"><td class="s">${tx(S.repTotal)}</td><td>${nf(t.spend)}</td></tr></tbody></table>
      <p class="note">${tx(S.repOnePool)}</p>
    </div>
    <div>
      <h2>${tx(S.repCampaignBlock)}</h2>
      <table><tbody>
        <tr><td class="s">${tx(S.repOrdersWithCampaign)}</td><td>${nf(r.campaigns.orders_with_campaign)} (${pc(r.campaigns.pct_of_orders)})</td></tr>
        <tr><td class="s">${tx(S.repCampaignRevenue)}</td><td>${nf(r.campaigns.campaign_revenue)}</td></tr>
        <tr><td class="s">${tx(S.repCombosPurch)}</td><td>${nf(r.campaigns.combos_on_purchases)}</td></tr>
        <tr><td class="s">${tx(S.repCombosAll)}</td><td>${nf(r.campaigns.combos_all_traffic)}</td></tr>
      </tbody></table>
    </div>
  </div>

  <h2>${tx(S.repAdwaaTitle)}</h2>
  <div class="kpis">
    ${kpi(tx(S.repAdwaaRevenue), nf(r.adwaa.revenue))}
    ${kpi(tx(S.repAdwaaOrders), nf(r.adwaa.orders), `${tx(S.repAdwaaOnly)}: ${nf(r.adwaa.adwaa_only_orders)}`)}
    ${kpi(tx(S.repAdwaaFromAds), nf(r.adwaa.from_ads_revenue), `${nf(r.adwaa.from_ads_orders)} ${tx(S.uniqueOrders)}`)}
    ${kpi(tx(S.repInclAdwaa), nf(t.revenue_incl_adwaa))}
  </div>
  <p class="note">${tx(S.repAdwaaNote)}</p>

  ${
    rep
      ? `<h2>${tx(S.repMetaCheck)}</h2>
  <div class="kpis">
    ${kpi(tx(S.repMetaClaimed), nf(fu?.meta_claimed_value ?? null))}
    ${kpi(tx(S.repGa4Meta), nf(fu?.ga4_meta_revenue ?? null))}
    ${kpi(tx(S.metaClaimRatio), fu && fu.ga4_meta_revenue > 0 ? `${(fu.meta_claimed_value / fu.ga4_meta_revenue).toFixed(1)}×` : "—")}
    ${kpi(tx(S.repClicksArrived), arrival === null ? "—" : `${arrival}%`, fu ? `${nf(fu.meta_clicks)} → ${nf(fu.ga4_meta_sessions)}` : "")}
  </div>
  <p class="note">${tx(S.truthNote)}</p>

  <h2>${tx(S.repGapsTitle)}</h2>
  <div class="grid2">
    <div>
      <table><thead><tr><th>${tx(S.channel)}</th><th>${tx(S.orders)}</th><th>${tx(S.tracked)}</th><th>%</th><th>${tx(S.untracked)}</th></tr></thead><tbody>${channelRows}</tbody></table>
    </div>
    <div>
      <table><thead><tr><th>${tx(S.payment)}</th><th>${tx(S.total)}</th><th>${tx(S.untracked)}</th><th>%</th></tr></thead><tbody>${paymentRows}</tbody></table>
    </div>
  </div>`
      : ""
  }

  <div class="footer"><span>NM Smart App — GAPS</span><span>${tx(S.repGenerated)}: ${new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" })}</span></div>
</div></body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    window.open(URL.createObjectURL(blob), "_blank");
  }, [supabase, month, tx, lang, report]);

  // Monthly OKR report — totals only (spend, gross/net revenue, CR, ROAS).
  // Deliberately carries no tracking-gaps and no AL-Adwaa sections.
  const openOkrReport = useCallback(async () => {
    setReportBusy(true);
    const { data, error } = await supabase.rpc("fn_gaps_okr_report", { p_month: month });
    setReportBusy(false);
    if (error || !data) {
      setLoadError(error?.message ?? "report failed");
      return;
    }
    const r = data as OkrReport;
    const ar = lang === "ar";
    const nf = (n: number | null | undefined) =>
      n === null || n === undefined || isNaN(n) ? "—" : new Intl.NumberFormat("en-EG", { maximumFractionDigits: 0 }).format(n);
    const pc = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n}%`);
    const x = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n}×`);
    const html = `<!doctype html><html dir="${ar ? "rtl" : "ltr"}" lang="${ar ? "ar" : "en"}"><head><meta charset="utf-8">
<title>${tx(S.okrTitle)} — ${monthLabelFor(r.month, lang)}</title>
<style>
  :root { --navy:#1f3864; --navy2:#2f5496; --line:#d9dce6; --soft:#eef1f8; }
  * { box-sizing:border-box; }
  body { font-family:"Segoe UI",Tahoma,Arial,sans-serif; color:#1a1f2e; margin:0; background:#f4f5f9; }
  .page { max-width:760px; margin:24px auto; background:#fff; padding:40px 48px; box-shadow:0 2px 14px rgba(30,40,90,.12); }
  h1 { color:var(--navy); font-size:24px; margin:0 0 2px; }
  .sub { color:#5a6478; font-size:12.5px; margin-bottom:6px; }
  .scope { background:var(--soft); border-inline-start:4px solid var(--navy2); padding:10px 14px; font-size:12px; color:#3a4358; border-radius:6px; margin:14px 0 22px; line-height:1.7; }
  table { width:100%; border-collapse:collapse; font-size:13.5px; }
  th { background:var(--navy); color:#fff; padding:9px 12px; text-align:start; font-weight:600; }
  td { padding:9px 12px; border-bottom:1px solid var(--line); text-align:start; direction:ltr; font-weight:600; }
  td.s { direction:${ar ? "rtl" : "ltr"}; color:#2a3145; }
  tbody tr:nth-child(even) { background:#f7f8fc; }
  td.span { text-align:center; background:var(--soft); }
  .footer { margin-top:30px; font-size:10.5px; color:#9aa0b2; border-top:1px solid var(--line); padding-top:10px; display:flex; justify-content:space-between; }
  .printbtn { position:fixed; top:14px; inset-inline-end:14px; background:var(--navy2); color:#fff; border:0; border-radius:8px; padding:9px 16px; font-size:13px; cursor:pointer; font-family:inherit; }
  @media print { body{background:#fff} .page{box-shadow:none; margin:0; padding:10mm 12mm; max-width:none} .printbtn{display:none} }
</style></head><body>
<button class="printbtn" onclick="window.print()">${tx(S.repPrint)}</button>
<div class="page">
  <h1>${tx(S.okrTitle)}</h1>
  <div class="sub">${monthLabelFor(r.month, lang)} (${tx(S.okrThrough)} ${r.through}) — NM Smart App</div>
  <div class="scope"><b>${tx(S.repScopeTitle)}:</b> ${tx(S.okrDefs)}.</div>

  <table>
    <thead><tr><th>${tx(S.okrMetric)}</th><th>${tx(S.okrGross)}</th><th>${tx(S.okrNet)}</th></tr></thead>
    <tbody>
      <tr><td class="s">${tx(S.repSpend)}</td><td class="span" colspan="2">${nf(r.spend)}</td></tr>
      <tr><td class="s">${tx(S.repSessions)}</td><td class="span" colspan="2">${nf(r.sessions)}</td></tr>
      <tr><td class="s">${tx(S.okrRevenue)}</td><td>${nf(r.gross.revenue)}</td><td>${nf(r.net.revenue)}</td></tr>
      <tr><td class="s">${tx(S.okrOrders)}</td><td>${nf(r.gross.orders)}</td><td>${nf(r.net.orders)}</td></tr>
      <tr><td class="s">CR</td><td>${pc(r.gross.cr)}</td><td>${pc(r.net.cr)}</td></tr>
      <tr><td class="s">ROAS</td><td>${x(r.gross.roas)}</td><td>${x(r.net.roas)}</td></tr>
    </tbody>
  </table>

  <div class="footer"><span>NM Smart App — OKR</span><span>${tx(S.repGenerated)}: ${new Date().toLocaleString("en-GB", { timeZone: "Africa/Cairo", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span></div>
</div></body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    window.open(URL.createObjectURL(blob), "_blank");
  }, [supabase, month, tx, lang]);

  // Net source report — gross + net totals side by side, per-source delivered detail.
  const openNetReport = useCallback(async () => {
    setReportBusy(true);
    const { data, error } = await supabase.rpc("fn_gaps_net_source_report", { p_month: month });
    setReportBusy(false);
    if (error || !data) {
      setLoadError(error?.message ?? "report failed");
      return;
    }
    const r = data as NetSourceReport;
    const ar = lang === "ar";
    const nf = (n: number | null | undefined) =>
      n === null || n === undefined || isNaN(n) ? "—" : new Intl.NumberFormat("en-EG", { maximumFractionDigits: 0 }).format(n);
    const pc = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n}%`);
    const x = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n}×`);
    const bucketLabel = (b: string) =>
      ({
        meta_tagged: tx(S.bMetaTagged),
        meta_untagged: tx(S.bMetaUntagged),
        bitly: tx(S.bShortlinks),
        google_ads: tx(S.bGoogleAds),
        direct: tx(S.bDirect),
        seo: tx(S.bSeo),
        appstore: tx(S.bAppstore),
        other: tx(S.bOtherMalformed),
        untracked: tx(S.bUntracked),
      })[b] ?? b;
    const t = r.totals;
    const srcRows = r.rows
      .map(
        (row) => `<tr${row.bucket === "untracked" ? ' class="warn"' : ""}>
          <td class="s">${bucketLabel(row.bucket)}</td>
          <td>${row.sessions === null ? "—" : nf(row.sessions)}</td>
          <td>${nf(row.orders)}</td>
          <td>${nf(row.gross_revenue)}</td>
          <td>${nf(row.delivered)}</td>
          <td>${nf(row.net_revenue)}</td>
          <td>${nf(row.pending)}</td></tr>`
      )
      .join("");
    const html = `<!doctype html><html dir="${ar ? "rtl" : "ltr"}" lang="${ar ? "ar" : "en"}"><head><meta charset="utf-8">
<title>${tx(S.netTitle)} — ${monthLabelFor(r.month, lang)}</title>
<style>
  :root { --navy:#1f3864; --navy2:#2f5496; --line:#d9dce6; --soft:#eef1f8; --warn:#fdecec; }
  * { box-sizing:border-box; }
  body { font-family:"Segoe UI",Tahoma,Arial,sans-serif; color:#1a1f2e; margin:0; background:#f4f5f9; }
  .page { max-width:900px; margin:24px auto; background:#fff; padding:40px 48px; box-shadow:0 2px 14px rgba(30,40,90,.12); }
  h1 { color:var(--navy); font-size:24px; margin:0 0 2px; }
  .sub { color:#5a6478; font-size:12.5px; margin-bottom:6px; }
  .scope { background:var(--soft); border-inline-start:4px solid var(--navy2); padding:10px 14px; font-size:12px; color:#3a4358; border-radius:6px; margin:14px 0 22px; line-height:1.7; }
  h2 { color:var(--navy2); font-size:15.5px; margin:26px 0 10px; }
  table { width:100%; border-collapse:collapse; font-size:12.5px; }
  th { background:var(--navy); color:#fff; padding:8px 10px; text-align:start; font-weight:600; }
  td { padding:7px 10px; border-bottom:1px solid var(--line); text-align:start; direction:ltr; }
  td.s { direction:${ar ? "rtl" : "ltr"}; font-weight:600; color:#2a3145; }
  td.span { text-align:center; background:var(--soft); }
  tbody tr:nth-child(even) { background:#f7f8fc; }
  tr.warn td { background:var(--warn); }
  tr.total td { background:var(--soft); font-weight:700; border-top:2px solid var(--navy2); }
  .note { font-size:11px; color:#7a8296; margin-top:6px; line-height:1.6; }
  .footer { margin-top:30px; font-size:10.5px; color:#9aa0b2; border-top:1px solid var(--line); padding-top:10px; display:flex; justify-content:space-between; }
  .printbtn { position:fixed; top:14px; inset-inline-end:14px; background:var(--navy2); color:#fff; border:0; border-radius:8px; padding:9px 16px; font-size:13px; cursor:pointer; font-family:inherit; }
  @media print { body{background:#fff} .page{box-shadow:none; margin:0; padding:10mm 12mm; max-width:none} .printbtn{display:none} }
</style></head><body>
<button class="printbtn" onclick="window.print()">${tx(S.repPrint)}</button>
<div class="page">
  <h1>${tx(S.netTitle)}</h1>
  <div class="sub">${monthLabelFor(r.month, lang)} (${tx(S.okrThrough)} ${r.through}) — NM Smart App</div>
  <div class="scope"><b>${tx(S.repScopeTitle)}:</b> ${tx(S.netDefs)}.</div>

  <h2>${tx(S.okrGross)} / ${tx(S.okrNet)}</h2>
  <table>
    <thead><tr><th>${tx(S.okrMetric)}</th><th>${tx(S.okrGross)}</th><th>${tx(S.okrNet)}</th></tr></thead>
    <tbody>
      <tr><td class="s">${tx(S.repSpend)}</td><td class="span" colspan="2">${nf(t.spend)}</td></tr>
      <tr><td class="s">${tx(S.repSessions)}</td><td class="span" colspan="2">${nf(t.sessions)}</td></tr>
      <tr><td class="s">${tx(S.okrRevenue)}</td><td>${nf(t.gross.revenue)}</td><td>${nf(t.net.revenue)}</td></tr>
      <tr><td class="s">${tx(S.okrOrders)}</td><td>${nf(t.gross.orders)}</td><td>${nf(t.net.orders)}</td></tr>
      <tr><td class="s">${tx(S.repCancelled)} / ${tx(S.repReturned)}</td><td>${nf(t.gross.cancelled)} / ${nf(t.gross.returned)}</td><td>—</td></tr>
      <tr><td class="s">CR</td><td>${pc(t.gross.cr)}</td><td>${pc(t.net.cr)}</td></tr>
      <tr><td class="s">ROAS</td><td>${x(t.gross.roas)}</td><td>${x(t.net.roas)}</td></tr>
      <tr><td class="s">${tx(S.colPending)}</td><td class="span" colspan="2">${nf(t.pending.orders)} (${nf(t.pending.book_value)} EGP)</td></tr>
    </tbody>
  </table>
  <p class="note">${tx(S.netPendingNote)}</p>

  <h2>${tx(S.repBySource)}</h2>
  <table><thead><tr><th>${tx(S.repSource)}</th><th>${tx(S.repSessions)}</th><th>${tx(S.repOrders)}</th><th>${tx(S.colGrossRevenue)}</th><th>${tx(S.colDelivered)}</th><th>${tx(S.colNetRevenue)}</th><th>${tx(S.colPending)}</th></tr></thead>
  <tbody>${srcRows}<tr class="total"><td class="s">${tx(S.repTotal)}</td><td>${nf(t.sessions)}</td><td>${nf(t.gross.orders)}</td><td>${nf(t.gross.revenue)}</td><td>${nf(t.net.orders)}</td><td>${nf(t.net.revenue)}</td><td>${nf(t.pending.orders)}</td></tr></tbody></table>

  <div class="footer"><span>NM Smart App — GAPS</span><span>${tx(S.repGenerated)}: ${new Date().toLocaleString("en-GB", { timeZone: "Africa/Cairo", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span></div>
</div></body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    window.open(URL.createObjectURL(blob), "_blank");
  }, [supabase, month, tx, lang]);

  const runLookup = useCallback(async () => {
    const q = lookupQuery.trim();
    if (q.length < 3) return;
    setLookupLoading(true);
    setLookupError(null);
    const { data, error } = await supabase.rpc("fn_gaps_book_orders", {
      p_query: q,
      p_from: null,
      p_to: null,
      p_limit: 600,
    });
    if (error) setLookupError(error.message);
    setLookupRows((data as BookOrderRow[]) ?? []);
    setLookupLoading(false);
  }, [supabase, lookupQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const monthEnd = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
    const [r, g, u] = await Promise.all([
      supabase.rpc("fn_gaps_report", { p_month: month }),
      supabase.rpc("fn_ads_gap", { p_from: month, p_to: monthEnd }),
      supabase.rpc("fn_untracked_orders", { p_month: month, p_limit: 500 }),
    ]);
    // a failed RPC must never masquerade as "no data" (timeouts return
    // an error with empty data — same lesson as the ads page)
    const failed = [r.error, g.error, u.error].find(Boolean);
    if (failed) setLoadError(failed.message);
    setReport((r.data as Report) ?? null);
    setGapRows((g.data as GapRow[]) ?? []);
    setUntracked((u.data as UntrackedOrder[]) ?? []);
    setLoading(false);
  }, [supabase, month]);

  useEffect(() => {
    load();
  }, [load]);

  // ------------------------------------------------------------- findings
  const findings = useMemo<Finding[]>(() => {
    if (!report) return [];
    const f: Finding[] = [];
    const t = report.tracking;
    const fu = report.funnel;
    const ar = lang === "ar";

    // per-channel tracking failures (iOS is the classic one)
    for (const c of report.by_channel) {
      const rate = pct(c.tracked, c.orders);
      if (rate !== null && c.orders >= 10 && rate < 50) {
        f.push({
          severity: "red",
          title: ar
            ? `تتبع ${c.channel} شبه معدوم (${rate.toFixed(0)}%)`
            : `${c.channel} tracking is nearly dead (${rate.toFixed(0)}%)`,
          body: ar
            ? `${c.orders} طلب من تطبيق ${c.channel} بقيمة ${formatMoney(c.revenue, lang)} — GA4 شاف ${c.tracked} بس. التطبيق مش بيبعت أحداث الشراء لـ GA4، فأي حملة بتودّي للتطبيق شكلها فاشل وهي مش كده.`
            : `${c.orders} orders from the ${c.channel} app worth ${formatMoney(c.revenue, lang)} — GA4 saw only ${c.tracked}. The app doesn't send purchase events to GA4, so any campaign driving app installs looks like a failure when it isn't.`,
        });
      }
    }

    // payment-redirect purchase-event loss
    for (const p of t.payment_breakdown ?? []) {
      const lost = pct(p.untracked, p.total);
      if (lost !== null && p.total >= 20 && lost > 20) {
        f.push({
          severity: "red",
          title: ar
            ? `الدفع الأونلاين بيضيّع التتبع (${p.payment_method}: ${lost.toFixed(0)}% ضايع)`
            : `Online payment loses tracking (${p.payment_method}: ${lost.toFixed(0)}% lost)`,
          body: ar
            ? `${p.untracked} من ${p.total} طلب مدفوع بـ«${p.payment_method}» ماوصلوش GA4. العميل بيروح صفحة بوابة الدفع ويرجع، وحدث الشراء بيضيع في الرجوع. الحل: إطلاق حدث purchase من صفحة التأكيد بعد الرجوع من البوابة، أو تفعيل القياس من السيرفر.`
            : `${p.untracked} of ${p.total} orders paid via "${p.payment_method}" never reached GA4. The customer bounces to the payment gateway and back, and the purchase event dies on the return. Fix: fire the purchase event on the confirmation page after the gateway redirect, or use server-side measurement.`,
        });
      }
    }

    // meta over-claim vs its own GA4-attributed revenue
    if (fu.ga4_meta_revenue > 0 && fu.meta_claimed_value > fu.ga4_meta_revenue * 1.4) {
      const ratio = fu.meta_claimed_value / fu.ga4_meta_revenue;
      f.push({
        severity: "amber",
        title: ar
          ? `ميتا بتدّعي ${ratio.toFixed(1)}× اللي اتتبع منها فعلاً`
          : `Meta claims ${ratio.toFixed(1)}× what actually tracked from it`,
        body: ar
          ? `ميتا بتقول ${formatMoney(fu.meta_claimed_value, lang)} إيراد، لكن GA4 نسب لميتا ${formatMoney(fu.ga4_meta_revenue, lang)} بس. السبب: ميتا بتحسب أي حد شاف الإعلان واشترى خلال أيام (حتى من غير ضغطة)، وبتاخد كريدت مبيعات كانت جاية من مصادر تانية. اعتبر رقم ميتا «سقف تفاؤلي» وقيّم الإعلانات بالـ ROAS الحقيقي من جدول الكتب تحت.`
          : `Meta reports ${formatMoney(fu.meta_claimed_value, lang)} in revenue, but GA4 credited Meta only ${formatMoney(fu.ga4_meta_revenue, lang)}. Why: Meta counts anyone who saw an ad and bought within its window (even without clicking), taking credit for sales other channels drove. Treat Meta's number as an optimistic ceiling and judge ads by the real ROAS in the books table below.`,
      });
    }

    // click → session loss
    if (fu.meta_clicks > 0) {
      const arrival = pct(fu.ga4_meta_sessions, fu.meta_clicks);
      if (arrival !== null && arrival < 60) {
        f.push({
          severity: "amber",
          title: ar
            ? `${(100 - arrival).toFixed(0)}% من ضغطات ميتا مش بتوصل الموقع`
            : `${(100 - arrival).toFixed(0)}% of Meta clicks never reach the site`,
          body: ar
            ? `${formatNumber(fu.meta_clicks)} ضغطة مدفوعة قابلها ${formatNumber(fu.ga4_meta_sessions)} جلسة بس في GA4. جزء طبيعي (متصفح فيسبوك الداخلي بيمنع التتبع)، لكن النسبة دي عالية — اتأكد إن صفحات الهبوط سريعة وإن مفيش إعلانات بتودّي لروابط مكسورة.`
            : `${formatNumber(fu.meta_clicks)} paid clicks produced only ${formatNumber(fu.ga4_meta_sessions)} GA4 sessions. Some loss is normal (Facebook's in-app browser blocks tracking), but this rate is high — check landing pages load fast and no ads point to broken links.`,
        });
      }
    }

    // unmapped spend
    const m = report.mapping;
    if (m.spend > 0 && m.unmapped_spend / m.spend > 0.1) {
      f.push({
        severity: "amber",
        title: ar
          ? `${formatMoney(m.unmapped_spend, lang)} إنفاق أعمى (${m.unmapped} إعلان من غير ربط)`
          : `${formatMoney(m.unmapped_spend, lang)} of blind spend (${m.unmapped} unlinked ads)`,
        body: ar
          ? `${((m.unmapped_spend * 100) / m.spend).toFixed(0)}% من إنفاق الشهر مش مربوط بكتاب أو قائمة، فمستحيل نعرف عائده الحقيقي. الربط خطوة يدوية — الجدول تحت فيه الأعلى إنفاقًا.`
          : `${((m.unmapped_spend * 100) / m.spend).toFixed(0)}% of the month's spend isn't linked to any book or list, so its real return is unknowable. Linking is manual — the table below lists the biggest spenders.`,
        action: { href: "/ads", label: tx(S.goMapping) },
      });
    }

    // untagged meta traffic (UTM hygiene)
    const metaFrag = report.fragmentation.filter((r) => r.bucket === "meta");
    const untaggedRev = metaFrag.filter((r) => !r.tagged).reduce((a, r) => a + r.revenue, 0);
    const metaRev = metaFrag.reduce((a, r) => a + r.revenue, 0);
    if (metaRev > 0 && untaggedRev / metaRev > 0.3) {
      f.push({
        severity: "amber",
        title: ar
          ? `${((untaggedRev * 100) / metaRev).toFixed(0)}% من إيراد ميتا واصل من غير وسوم UTM`
          : `${((untaggedRev * 100) / metaRev).toFixed(0)}% of Meta revenue arrives untagged`,
        body: ar
          ? `${formatMoney(untaggedRev, lang)} واصلين كـ m.facebook.com/referral وما ينفعش نعرف من أنهي حملة. ثبّت صيغة UTM واحدة لكل الإعلانات: utm_source=fb & utm_medium=paid & utm_campaign=اسم-الحملة — ساعتها GA4 هيفرز كل حملة لوحدها.`
          : `${formatMoney(untaggedRev, lang)} arrived as m.facebook.com/referral with no way to tell which campaign sent it. Standardize one UTM format on every ad: utm_source=fb & utm_medium=paid & utm_campaign=campaign-name — then GA4 can split every campaign cleanly.`,
      });
    }

    // ga4-only phantoms (should stay zero)
    if (t.ga4_only > 0) {
      f.push({
        severity: "red",
        title: ar ? `${t.ga4_only} معاملة في GA4 ملهاش طلب حقيقي` : `${t.ga4_only} GA4 transactions with no real order`,
        body: ar
          ? "معاملات ظهرت في GA4 من غير طلب مطابق في المتجر — ممكن تكون تكرار في إطلاق الحدث أو اختبارات."
          : "Transactions appeared in GA4 with no matching store order — possibly duplicate event firing or test orders.",
      });
    } else {
      f.push({
        severity: "green",
        title: ar ? "كل معاملات GA4 حقيقية — صفر معاملات وهمية" : "Every GA4 transaction is real — zero phantoms",
        body: ar
          ? `كل الـ ${formatNumber(t.ga4_transactions ?? t.tracked)} معاملة في GA4 اتطابقت مع طلب حقيقي بنفس الرقم. البيانات المتتبَّعة موثوقة ١٠٠٪ — المشكلة الوحيدة في الطلبات اللي مش بتتسجّل أصلًا.`
          : `All ${formatNumber(t.ga4_transactions ?? t.tracked)} GA4 transactions matched a real order by ID. What is tracked is 100% trustworthy — the only problem is orders that never get recorded.`,
      });
    }

    // google ads present but not imported anywhere
    const gAds = report.attribution.find((b) => b.bucket === "google_ads");
    if (gAds && gAds.tx > 10) {
      f.push({
        severity: "amber",
        title: ar ? "في إعلانات جوجل شغالة ومش مستوردة هنا" : "Google Ads is running but not imported here",
        body: ar
          ? `GA4 شاف ${gAds.tx} معاملة بقيمة ${formatMoney(gAds.revenue, lang)} من google/cpc، لكن مفيش بيانات إنفاق جوجل في المنصة — الـ ROAS بتاعها غير معروف. لو الحملات دي مقصودة، ضيف استيراد تقارير Google Ads زي ميتا.`
          : `GA4 saw ${gAds.tx} transactions worth ${formatMoney(gAds.revenue, lang)} from google/cpc, but no Google Ads spend data exists in the platform — its ROAS is unknown. If those campaigns are intentional, add a Google Ads import like the Meta one.`,
      });
    }

    const order = { red: 0, amber: 1, green: 2 };
    return f.sort((a, b) => order[a.severity] - order[b.severity]);
  }, [report, lang, tx]);

  // ------------------------------------------------------------ renderers

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const monthLabel = (iso: string) => monthLabelFor(iso, lang);

  const t = report?.tracking;
  const trackedPct = t ? pct(t.tracked, t.orders) : null;
  const claimRatio =
    report && report.funnel.ga4_meta_revenue > 0 ? report.funnel.meta_claimed_value / report.funnel.ga4_meta_revenue : null;
  const unmappedPct = report && report.mapping.spend > 0 ? (report.mapping.unmapped_spend * 100) / report.mapping.spend : null;

  const sourceCards = report
    ? [
        {
          icon: ShoppingCart,
          label: tx(S.ordersSrc),
          ok: report.orders.total > 0,
          main: `${formatNumber(report.orders.total)} • ${formatMoney(report.orders.revenue, lang)}`,
          fresh: report.freshness.orders_last_date?.slice(0, 10) ?? "—",
          syncedAt: report.freshness.orders_last_import,
        },
        {
          icon: BarChart3,
          label: tx(S.ga4Src),
          ok: report.ga4.tx > 0,
          main: `${formatNumber(report.ga4.tx)} • ${formatMoney(report.ga4.revenue, lang)}`,
          fresh: report.freshness.ga4_last_day ?? "—",
          syncedAt: report.freshness.ga4_last_sync,
        },
        {
          icon: Megaphone,
          label: tx(S.metaSrc),
          ok: report.meta.ads > 0,
          main: `${formatNumber(report.meta.ads)} ads • ${formatMoney(report.meta.spend, lang)}`,
          fresh: report.freshness.meta_last_period ?? "—",
          syncedAt: report.freshness.meta_last_import,
        },
        {
          icon: Search,
          label: tx(S.gscSrc),
          ok: report.gsc.clicks > 0,
          main: `${formatNumber(report.gsc.clicks)} clicks`,
          fresh: report.freshness.gsc_last_day ?? "—",
          syncedAt: report.freshness.gsc_last_sync,
        },
      ]
    : [];

  const chainMax = report ? Math.max(report.orders.revenue, report.ga4.revenue, report.meta.value, 1) : 1;
  const chain = report
    ? [
        { label: tx(S.storeTruth), value: report.orders.revenue, cls: "bg-emerald-500" },
        { label: tx(S.ga4Tracked), value: report.ga4.revenue, cls: "bg-sky-500" },
        { label: tx(S.metaClaimed), value: report.meta.value, cls: "bg-amber-500" },
      ]
    : [];

  // running month: GA4 syncs behind orders, so month-level rates undercount
  const isCurrentMonth = month === months[0];
  const ga4Through = report?.ga4.last_day ?? null;
  // the report itself already stops at the last complete day (migration 106);
  // the banner just says so, and shows when GA4 last pulled
  const syncLag = isCurrentMonth && !!ga4Through;
  const fmtSync = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" }) : "—";

  const visibleUntracked = showAllUntracked ? untracked : untracked.slice(0, 12);
  const sortedBooks = [...gapRows].sort((a, b) => b.spend - a.spend);
  const visibleBooks = showAllBooks ? sortedBooks : sortedBooks.slice(0, 12);

  const verdictChip = (v: GapRow["verdict"]) => (
    <span
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-[11px] font-bold",
        v === "impossible" ? "bg-red-100 text-red-700" : v === "inflated" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
      )}
    >
      {v === "impossible" ? tx(S.vImpossible) : v === "inflated" ? tx(S.vInflated) : tx(S.vPlausible)}
    </span>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="GAPS"
        subtitle={tx(S.subtitle)}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
            >
              {months.map((m, i) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                  {i === 0 ? ` ${tx(S.currentMonth)}` : ""}
                </option>
              ))}
            </select>
            <button onClick={load} className="btn-secondary flex items-center gap-1.5 text-sm">
              <RefreshCw size={14} /> {tx(S.refresh)}
            </button>
            <button
              onClick={openDesignedReport}
              disabled={reportBusy}
              className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-50"
            >
              <FileText size={14} /> {tx(S.designedReport)}
            </button>
            <button
              onClick={openOkrReport}
              disabled={reportBusy}
              className="btn-secondary flex items-center gap-1.5 text-sm disabled:opacity-50"
            >
              <FileText size={14} /> {tx(S.okrReport)}
            </button>
            <button
              onClick={openNetReport}
              disabled={reportBusy}
              className="btn-secondary flex items-center gap-1.5 text-sm disabled:opacity-50"
            >
              <FileText size={14} /> {tx(S.netReport)}
            </button>
            <button
              onClick={downloadMonthlyReport}
              disabled={reportBusy}
              className="btn-secondary flex items-center gap-1.5 text-sm disabled:opacity-50"
              title="Excel"
            >
              <Download size={14} /> {tx(S.monthlyReport)}
            </button>
          </div>
        }
      />

      {loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {tx(S.loadError)}: {loadError}
        </div>
      )}

      {!report && !loadError && <div className="card p-8 text-center text-slate-500">{tx(S.noData)}</div>}

      {report && (
        <>
          {syncLag && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              {tx(S.syncLagBanner).replace("{ga4}", ga4Through ?? "—").replace("{sync}", fmtSync(report?.freshness.ga4_last_sync))}
            </div>
          )}

          {/* ------------------------------------------------ connected sources */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {sourceCards.map((c) => (
              <div key={c.label} className="card flex items-start gap-3 p-4">
                <div className={cn("rounded-lg p-2", c.ok ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600")}>
                  <c.icon size={18} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {c.label}
                    {c.ok ? <CheckCircle2 size={13} className="text-emerald-500" /> : <AlertTriangle size={13} className="text-red-500" />}
                  </div>
                  <div className="mt-0.5 truncate text-sm font-bold text-slate-900" dir="ltr">
                    {c.main}
                  </div>
                  <div className="text-[11px] text-slate-400" dir="ltr">
                    {tx(S.syncedThrough)} {c.fresh}
                    {c.syncedAt && <span className="ms-1.5 text-slate-300">· {tx(S.syncedAt)} {fmtSync(c.syncedAt)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ------------------------------------------------------ truth chain */}
          <ChartCard title={tx(S.truthChain)}>
            <div className="space-y-3">
              {chain.map((b) => (
                <div key={b.label}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-semibold text-slate-700">{b.label}</span>
                    <span className="font-bold text-slate-900" dir="ltr">
                      {formatMoney(b.value, lang)}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                    <div className={cn("h-full rounded-full", b.cls)} style={{ width: `${(b.value * 100) / chainMax}%` }} />
                  </div>
                </div>
              ))}
              <p className="pt-1 text-xs leading-5 text-slate-500">{tx(S.truthNote)}</p>
            </div>
          </ChartCard>

          {/* ------------------------------------------------------------- KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label={tx(S.trackingRate)}
              value={trackedPct !== null ? `${trackedPct.toFixed(1)}%` : "—"}
              sub={tx(S.ofOrders)}
              accent={trackedPct !== null && trackedPct < 90 ? "amber" : "green"}
            />
            <KpiCard
              label={tx(S.untrackedRevenue)}
              value={formatMoney(t?.untracked_revenue ?? 0, lang)}
              sub={`${formatNumber(t?.untracked ?? 0)} ${tx(S.untrackedSub)}`}
              accent="red"
            />
            <KpiCard
              label={tx(S.metaClaimRatio)}
              value={claimRatio !== null ? `${claimRatio.toFixed(1)}×` : "—"}
              sub={tx(S.metaClaimSub)}
              accent={claimRatio !== null && claimRatio > 1.4 ? "amber" : "green"}
            />
            <KpiCard
              label={tx(S.unmappedSpend)}
              value={formatMoney(report.mapping.unmapped_spend, lang)}
              sub={`${formatNumber(report.mapping.unmapped)} ${tx(S.unmappedSub)}${unmappedPct !== null ? ` (${unmappedPct.toFixed(0)}%)` : ""}`}
              accent={unmappedPct !== null && unmappedPct > 10 ? "amber" : "green"}
            />
          </div>

          {/* --------------------------------------------------------- findings */}
          <ChartCard title={tx(S.findings)}>
            <div className="space-y-3">
              {findings.map((f, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-xl border p-4",
                    f.severity === "red"
                      ? "border-red-200 bg-red-50/60"
                      : f.severity === "amber"
                        ? "border-amber-200 bg-amber-50/60"
                        : "border-emerald-200 bg-emerald-50/60"
                  )}
                >
                  <div className="flex items-start gap-3">
                    {f.severity === "red" ? (
                      <ShieldAlert size={18} className="mt-0.5 shrink-0 text-red-500" />
                    ) : f.severity === "amber" ? (
                      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-500" />
                    ) : (
                      <ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-500" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900">{f.title}</div>
                      <p className="mt-1 text-xs leading-5 text-slate-600">{f.body}</p>
                      {f.action && (
                        <Link href={f.action.href} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
                          <Link2 size={12} /> {f.action.label}
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ChartCard>

          {/* --------------------------------------------------- day by day */}
          <ChartCard title={tx(S.dailyTitle)}>
            <p className="mb-3 text-xs text-slate-500">{tx(S.dailySub)}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 text-start">{tx(S.date)}</th>
                    <th className="py-2 text-end">{tx(S.orders)}</th>
                    <th className="py-2 text-end">{tx(S.ga4Purchases)}</th>
                    <th className="py-2 text-end">{tx(S.coverage)}</th>
                    <th className="py-2 text-end">{tx(S.revenue)}</th>
                    <th className="w-1/4 py-2 ps-3 text-start"></th>
                  </tr>
                </thead>
                <tbody>
                  {(report.daily ?? []).map((d) => {
                    const synced = d.sessions !== null;
                    const cov = synced && d.orders > 0 ? Math.min(((d.ga4_purchases ?? 0) * 100) / d.orders, 100) : null;
                    const maxOrders = Math.max(...(report.daily ?? []).map((x) => x.orders), 1);
                    return (
                      <tr key={d.day} className={cn("border-b border-slate-100", !synced && "opacity-60")}>
                        <td className="py-1.5 font-mono text-xs" dir="ltr">
                          {d.day.slice(5)}
                        </td>
                        <td className="py-1.5 text-end font-semibold" dir="ltr">
                          {formatNumber(d.orders)}
                        </td>
                        <td className="py-1.5 text-end" dir="ltr">
                          {synced ? formatNumber(d.ga4_purchases) : "—"}
                        </td>
                        <td className="py-1.5 text-end" dir="ltr">
                          {!synced ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                              {tx(S.notSyncedYet)}
                            </span>
                          ) : cov === null ? (
                            "—"
                          ) : (
                            <span
                              className={cn(
                                "font-bold",
                                cov < 70 ? "text-red-600" : cov < 90 ? "text-amber-600" : "text-emerald-600"
                              )}
                            >
                              {cov.toFixed(0)}%
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-end text-slate-500" dir="ltr">
                          {formatMoney(d.revenue, lang)}
                        </td>
                        <td className="py-1.5 ps-3">
                          <div className="space-y-0.5">
                            <div className="h-1.5 rounded-full bg-emerald-500/80" style={{ width: `${(d.orders * 100) / maxOrders}%` }} />
                            <div
                              className="h-1.5 rounded-full bg-sky-500/80"
                              style={{ width: `${((d.ga4_purchases ?? 0) * 100) / maxOrders}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-4 rounded-full bg-emerald-500/80" /> {tx(S.orders)}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-4 rounded-full bg-sky-500/80" /> {tx(S.ga4Purchases)}
              </span>
            </div>
          </ChartCard>

          {/* -------------------------------------------------- week by week */}
          <ChartCard title={tx(S.weeklyTitle)}>
            <p className="mb-3 text-xs text-slate-500">{tx(S.weeklySub)}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 text-start">{tx(S.week)}</th>
                    <th className="py-2 text-end">{tx(S.orders)}</th>
                    <th className="py-2 text-end">{tx(S.revenue)}</th>
                    <th className="py-2 text-end">{tx(S.ga4Purchases)}</th>
                    <th className="py-2 text-end">{tx(S.coverage)}</th>
                    <th className="py-2 text-end">{tx(S.metaSpendCol)}</th>
                    <th className="py-2 text-end">{tx(S.metaValue)}</th>
                    <th className="py-2 text-end">{tx(S.mer)}</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.weekly ?? []).map((w) => {
                    const cov = w.unsynced_days === 0 && w.orders > 0 && w.ga4_purchases !== null
                      ? Math.min((w.ga4_purchases * 100) / w.orders, 100)
                      : null;
                    const mer = w.meta_spend && w.meta_spend > 0 ? w.revenue / w.meta_spend : null;
                    return (
                      <tr key={w.week_no} className="border-b border-slate-100">
                        <td className="py-2 font-semibold text-slate-700" dir="ltr">
                          W{w.week_no} · {w.from.slice(8)}–{w.to.slice(8)}
                        </td>
                        <td className="py-2 text-end" dir="ltr">
                          {formatNumber(w.orders)}
                        </td>
                        <td className="py-2 text-end font-semibold" dir="ltr">
                          {formatMoney(w.revenue, lang)}
                        </td>
                        <td className="py-2 text-end" dir="ltr">
                          {w.ga4_purchases !== null ? formatNumber(w.ga4_purchases) : "—"}
                        </td>
                        <td className="py-2 text-end" dir="ltr">
                          {cov !== null ? (
                            <span className={cn("font-bold", cov < 70 ? "text-red-600" : cov < 90 ? "text-amber-600" : "text-emerald-600")}>
                              {cov.toFixed(0)}%
                            </span>
                          ) : w.unsynced_days > 0 ? (
                            <span className="text-[11px] text-slate-400">
                              {w.unsynced_days} {tx(S.daysNotSynced)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 text-end" dir="ltr">
                          {w.meta_spend !== null ? formatMoney(w.meta_spend, lang) : "—"}
                        </td>
                        <td className="py-2 text-end text-amber-700" dir="ltr">
                          {w.meta_value !== null ? formatMoney(w.meta_value, lang) : "—"}
                        </td>
                        <td className="py-2 text-end font-bold" dir="ltr">
                          {mer !== null ? mer.toFixed(2) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartCard>

          {/* ----------------------------------------- tracking gap by channel */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title={tx(S.gapTracking)}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-start text-xs text-slate-500">
                    <th className="py-2 text-start">{tx(S.channel)}</th>
                    <th className="py-2 text-end">{tx(S.orders)}</th>
                    <th className="py-2 text-end">{tx(S.tracked)}</th>
                    <th className="py-2 text-end">%</th>
                    <th className="py-2 text-end">{tx(S.untracked)}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.by_channel.map((c) => {
                    const rate = pct(c.tracked, c.orders);
                    return (
                      <tr key={c.channel} className="border-b border-slate-100">
                        <td className="py-2 font-semibold text-slate-700" dir="ltr">
                          {c.channel}
                        </td>
                        <td className="py-2 text-end" dir="ltr">
                          {formatNumber(c.orders)}
                        </td>
                        <td className="py-2 text-end" dir="ltr">
                          {formatNumber(c.tracked)}
                        </td>
                        <td
                          className={cn(
                            "py-2 text-end font-bold",
                            rate !== null && rate < 50 ? "text-red-600" : rate !== null && rate < 90 ? "text-amber-600" : "text-emerald-600"
                          )}
                          dir="ltr"
                        >
                          {rate !== null ? `${rate.toFixed(0)}%` : "—"}
                        </td>
                        <td className="py-2 text-end text-slate-500" dir="ltr">
                          {formatMoney(c.untracked_revenue, lang)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ChartCard>

            <ChartCard title={tx(S.gapPayment)}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 text-start">{tx(S.payment)}</th>
                    <th className="py-2 text-end">{tx(S.total)}</th>
                    <th className="py-2 text-end">{tx(S.untracked)}</th>
                    <th className="py-2 text-end">%</th>
                  </tr>
                </thead>
                <tbody>
                  {(t?.payment_breakdown ?? []).map((p) => {
                    const lost = pct(p.untracked, p.total);
                    return (
                      <tr key={p.payment_method} className="border-b border-slate-100">
                        <td className="py-2 font-semibold text-slate-700">{p.payment_method}</td>
                        <td className="py-2 text-end" dir="ltr">
                          {formatNumber(p.total)}
                        </td>
                        <td className="py-2 text-end" dir="ltr">
                          {formatNumber(p.untracked)}
                        </td>
                        <td
                          className={cn(
                            "py-2 text-end font-bold",
                            lost !== null && lost > 20 ? "text-red-600" : lost !== null && lost > 8 ? "text-amber-600" : "text-emerald-600"
                          )}
                          dir="ltr"
                        >
                          {lost !== null ? `${lost.toFixed(0)}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ChartCard>
          </div>

          {/* ------------------------------------------------- untracked orders */}
          <ChartCard title={`${tx(S.untrackedOrders)} (${formatNumber(untracked.length)})`}>
            <p className="mb-3 text-xs text-slate-500">{tx(S.untrackedOrdersSub)}</p>
            <div className="mb-3 flex gap-2">
              <button
                onClick={() =>
                  downloadCsv(
                    `untracked-orders-${month.slice(0, 7)}.csv`,
                    toCsv(untracked as unknown as Record<string, unknown>[])
                  )
                }
                className="btn-secondary flex items-center gap-1.5 text-xs"
              >
                <Download size={13} /> {tx(S.exportCsv)}
              </button>
              {untracked.length > 12 && (
                <button onClick={() => setShowAllUntracked((v) => !v)} className="btn-secondary text-xs">
                  {showAllUntracked ? tx(S.showLess) : `${tx(S.showAll)} (${untracked.length})`}
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 text-start">#</th>
                    <th className="py-2 text-start">{tx(S.date)}</th>
                    <th className="py-2 text-start">{tx(S.status)}</th>
                    <th className="py-2 text-start">{tx(S.payment)}</th>
                    <th className="py-2 text-start">{tx(S.channel)}</th>
                    <th className="py-2 text-start">{tx(S.city)}</th>
                    <th className="py-2 text-end">{tx(S.amount)}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUntracked.map((o) => (
                    <tr key={o.order_number} className="border-b border-slate-100">
                      <td className="py-1.5 font-mono text-xs" dir="ltr">
                        {o.order_number}
                      </td>
                      <td className="py-1.5 text-xs" dir="ltr">
                        {o.order_date?.slice(0, 10)}
                      </td>
                      <td className="py-1.5 text-xs">{o.order_status ?? "—"}</td>
                      <td className="py-1.5 text-xs">{o.payment_method ?? "—"}</td>
                      <td className="py-1.5 text-xs" dir="ltr">
                        {o.source ?? "—"}
                      </td>
                      <td className="py-1.5 text-xs">{o.city ?? "—"}</td>
                      <td className="py-1.5 text-end font-semibold" dir="ltr">
                        {formatMoney(o.total_order_amount, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>

          {/* ---------------------------------------------- meta reality check */}
          <ChartCard title={tx(S.metaReality)}>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: tx(S.metaClicks), value: formatNumber(report.funnel.meta_clicks) },
                { label: tx(S.ga4MetaSessions), value: formatNumber(report.funnel.ga4_meta_sessions) },
                { label: tx(S.ga4MetaTx), value: `${formatNumber(report.funnel.ga4_meta_tx)} • ${formatMoney(report.funnel.ga4_meta_revenue, lang)}` },
                { label: tx(S.metaPurchClaimed), value: `${formatNumber(report.funnel.meta_claimed_purchases)} • ${formatMoney(report.funnel.meta_claimed_value, lang)}` },
              ].map((c) => (
                <div key={c.label} className="rounded-xl bg-slate-50 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{c.label}</div>
                  <div className="mt-1 text-sm font-bold text-slate-900" dir="ltr">
                    {c.value}
                  </div>
                </div>
              ))}
            </div>
            {report.funnel.meta_clicks > 0 && (
              <p className="mt-3 text-xs leading-5 text-slate-500">
                {tx(S.clickLoss).replace("{n}", `${Math.round((report.funnel.ga4_meta_sessions * 100) / report.funnel.meta_clicks)}`)}
              </p>
            )}
          </ChartCard>

          {/* -------------------------------------------------- books witnesses */}
          <ChartCard title={tx(S.booksWitness)}>
            <p className="mb-3 text-xs text-slate-500">{tx(S.booksWitnessSub)}</p>
            <div className="mb-3 flex gap-2">
              <button
                onClick={() =>
                  downloadCsv(`gaps-books-${month.slice(0, 7)}.csv`, toCsv(sortedBooks as unknown as Record<string, unknown>[]))
                }
                className="btn-secondary flex items-center gap-1.5 text-xs"
              >
                <Download size={13} /> {tx(S.exportCsv)}
              </button>
              {sortedBooks.length > 12 && (
                <button onClick={() => setShowAllBooks((v) => !v)} className="btn-secondary text-xs">
                  {showAllBooks ? tx(S.showLess) : `${tx(S.showAll)} (${sortedBooks.length})`}
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 text-start">{tx(S.book)}</th>
                    <th className="py-2 text-end">{tx(S.spend)}</th>
                    <th className="py-2 text-end">{tx(S.metaValue)}</th>
                    <th className="py-2 text-end">{tx(S.storeRevenue)}</th>
                    <th className="py-2 text-end">{tx(S.metaRoas)}</th>
                    <th className="py-2 text-end">{tx(S.actualRoas)}</th>
                    <th className="py-2 text-center">{tx(S.verdict)}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBooks.map((b) => (
                    <tr key={b.book_label} className="border-b border-slate-100">
                      <td className="max-w-[220px] truncate py-2 font-semibold text-slate-700">{b.book_label}</td>
                      <td className="py-2 text-end" dir="ltr">
                        {formatMoney(b.spend, lang)}
                      </td>
                      <td className="py-2 text-end text-amber-700" dir="ltr">
                        {formatMoney(b.meta_value, lang)}
                      </td>
                      <td className="py-2 text-end font-semibold text-emerald-700" dir="ltr">
                        {formatMoney(b.store_revenue, lang)}
                      </td>
                      <td className="py-2 text-end" dir="ltr">
                        {b.meta_roas ?? "—"}
                      </td>
                      <td
                        className={cn(
                          "py-2 text-end font-bold",
                          (b.actual_roas ?? 0) >= 3 ? "text-emerald-600" : (b.actual_roas ?? 0) >= 1.5 ? "text-amber-600" : "text-red-600"
                        )}
                        dir="ltr"
                      >
                        {b.actual_roas ?? "—"}
                      </td>
                      <td className="py-2 text-center">{verdictChip(b.verdict)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>

          {/* ------------------------------------------------------ book lookup */}
          <ChartCard title={tx(S.lookupTitle)}>
            <p className="mb-3 text-xs text-slate-500">{tx(S.lookupSub)}</p>
            <div className="mb-4 flex gap-2">
              <input
                value={lookupQuery}
                onChange={(e) => setLookupQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runLookup()}
                placeholder={tx(S.lookupPlaceholder)}
                className="w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
              <button
                onClick={runLookup}
                disabled={lookupLoading || lookupQuery.trim().length < 3}
                className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-50"
              >
                <Search size={14} /> {lookupLoading ? tx(S.searching) : tx(S.searchBtn)}
              </button>
            </div>

            {lookupError && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{lookupError}</div>
            )}

            {lookupRows !== null && !lookupLoading && (
              <>
                {lookupRows.length === 0 ? (
                  <div className="py-6 text-center text-sm text-slate-500">{tx(S.lookupEmpty)}</div>
                ) : (
                  (() => {
                    const byOrder = new Map<string, BookOrderRow>();
                    for (const r of lookupRows) if (!byOrder.has(r.order_number)) byOrder.set(r.order_number, r);
                    const orders = Array.from(byOrder.values());
                    const bucketMeta: Record<BookOrderRow["bucket"], { label: Bi; cls: string }> = {
                      meta: { label: S.srcMeta, cls: "bg-indigo-100 text-indigo-700" },
                      google_organic: { label: S.srcGoogleOrganic, cls: "bg-emerald-100 text-emerald-700" },
                      google_ads: { label: S.srcGoogleAds, cls: "bg-teal-100 text-teal-700" },
                      direct: { label: S.srcDirect, cls: "bg-slate-200 text-slate-700" },
                      shortlinks: { label: S.srcShortlinks, cls: "bg-cyan-100 text-cyan-700" },
                      other: { label: S.srcOther, cls: "bg-slate-100 text-slate-600" },
                      gap: { label: S.srcGap, cls: "bg-red-100 text-red-700" },
                      awaiting: { label: S.srcAwaiting, cls: "bg-sky-100 text-sky-700" },
                    };
                    const counts = orders.reduce<Record<string, number>>((acc, o) => {
                      acc[o.bucket] = (acc[o.bucket] ?? 0) + 1;
                      return acc;
                    }, {});
                    return (
                      <>
                        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-bold text-slate-700">
                            {formatNumber(orders.length)} {tx(S.uniqueOrders)} · {formatNumber(lookupRows.length)} {tx(S.itemRows)}
                          </span>
                          {(Object.keys(bucketMeta) as BookOrderRow["bucket"][])
                            .filter((b) => counts[b])
                            .map((b) => (
                              <span key={b} className={cn("rounded-full px-2.5 py-0.5 font-semibold", bucketMeta[b].cls)}>
                                {tx(bucketMeta[b].label)}: {counts[b]}
                              </span>
                            ))}
                          <button
                            onClick={() =>
                              downloadCsv(
                                `book-orders-${lookupQuery.trim().slice(0, 20)}.csv`,
                                toCsv(lookupRows as unknown as Record<string, unknown>[])
                              )
                            }
                            className="btn-secondary ms-auto flex items-center gap-1.5 text-xs"
                          >
                            <Download size={13} /> {tx(S.exportCsv)}
                          </button>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-slate-200 text-xs text-slate-500">
                                <th className="py-2 text-start">{tx(S.date)}</th>
                                <th className="py-2 text-start">#</th>
                                <th className="py-2 text-start">{tx(S.book)}</th>
                                <th className="py-2 text-start">{tx(S.channel)}</th>
                                <th className="py-2 text-start">{tx(S.payment)}</th>
                                <th className="py-2 text-center">{tx(S.sourceCol)}</th>
                                <th className="py-2 text-start">{tx(S.campaignCol)}</th>
                                <th className="py-2 text-end">{tx(S.amount)}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lookupRows.map((r, i) => (
                                <tr key={`${r.order_number}-${r.sku}-${i}`} className="border-b border-slate-100">
                                  <td className="py-1.5 font-mono text-xs" dir="ltr">
                                    {r.order_date.slice(0, 10)}
                                  </td>
                                  <td className="py-1.5 font-mono text-xs" dir="ltr">
                                    {r.order_number}
                                  </td>
                                  <td className="max-w-[220px] truncate py-1.5 text-xs" title={r.product_name ?? r.sku}>
                                    {r.product_name ?? r.sku}
                                  </td>
                                  <td className="py-1.5 text-xs" dir="ltr">
                                    {r.app_channel ?? "—"}
                                  </td>
                                  <td className="py-1.5 text-xs">{r.payment_method ?? "—"}</td>
                                  <td className="py-1.5 text-center">
                                    <span
                                      className={cn(
                                        "inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold",
                                        bucketMeta[r.bucket].cls
                                      )}
                                      title={r.ga4_source ? `${r.ga4_source} / ${r.ga4_medium ?? ""}` : undefined}
                                    >
                                      {tx(bucketMeta[r.bucket].label)}
                                    </span>
                                  </td>
                                  <td className="max-w-[200px] truncate py-1.5 text-xs text-slate-500" title={r.ga4_campaign ?? undefined}>
                                    {r.ga4_campaign && !["(not set)", "(referral)", "(organic)", "(direct)"].includes(r.ga4_campaign)
                                      ? r.ga4_campaign
                                      : r.ga4_source
                                        ? `${r.ga4_source}/${r.ga4_medium ?? ""}`
                                        : "—"}
                                  </td>
                                  <td className="py-1.5 text-end font-semibold" dir="ltr">
                                    {formatMoney(r.order_total, lang)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    );
                  })()
                )}
              </>
            )}
          </ChartCard>

          {/* ------------------------------------------------------ unmapped ads */}
          {report.mapping.unmapped > 0 && (
            <ChartCard title={tx(S.unmappedTitle)}>
              <p className="mb-3 text-xs text-slate-500">{tx(S.unmappedNote)}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="py-2 text-start">{tx(S.adName)}</th>
                      <th className="py-2 text-start">{tx(S.campaign)}</th>
                      <th className="py-2 text-end">{tx(S.spend)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.mapping.unmapped_top.map((u, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-1.5 font-semibold text-slate-700">{u.ad_name ?? "—"}</td>
                        <td className="max-w-[280px] truncate py-1.5 text-xs text-slate-500">{u.campaign_name ?? "—"}</td>
                        <td className="py-1.5 text-end font-semibold" dir="ltr">
                          {formatMoney(u.spend, lang)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Link href="/ads" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
                <Link2 size={12} /> {tx(S.goMapping)}
              </Link>
            </ChartCard>
          )}

          {/* --------------------------------------------- attribution buckets */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title={tx(S.whereRevenue)}>
              <div className="space-y-2.5">
                {report.attribution.map((b) => {
                  const share = pct(b.revenue, report.ga4.revenue);
                  return (
                    <div key={b.bucket}>
                      <div className="mb-0.5 flex items-baseline justify-between text-xs">
                        <span className="font-semibold text-slate-700">{BUCKET_LABELS[b.bucket] ? tx(BUCKET_LABELS[b.bucket]) : b.bucket}</span>
                        <span className="text-slate-500" dir="ltr">
                          {formatNumber(b.tx)} • {formatMoney(b.revenue, lang)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${share ?? 0}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </ChartCard>

            <ChartCard title={tx(S.organicTitle)}>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: tx(S.gscClicks), value: formatNumber(report.organic.gsc_clicks) },
                  { label: tx(S.ga4OrgSessions), value: formatNumber(report.organic.ga4_sessions) },
                  { label: tx(S.ga4OrgRevenue), value: formatMoney(report.organic.ga4_revenue, lang) },
                ].map((c) => (
                  <div key={c.label} className="rounded-xl bg-slate-50 p-3 text-center">
                    <div className="text-[11px] font-semibold text-slate-500">{c.label}</div>
                    <div className="mt-1 text-sm font-bold text-slate-900" dir="ltr">
                      {c.value}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">{tx(S.organicNote)}</p>
            </ChartCard>
          </div>

          {/* ------------------------------------------------- fragmentation */}
          <ChartCard title={tx(S.fragTitle)}>
            <p className="mb-3 text-xs text-slate-500">{tx(S.fragNote)}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 text-start">source / medium</th>
                    <th className="py-2 text-start">{tx(S.bucket)}</th>
                    <th className="py-2 text-center">UTM</th>
                    <th className="py-2 text-end">{tx(S.txCount)}</th>
                    <th className="py-2 text-end">{tx(S.revenue)}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.fragmentation.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-1.5 font-mono text-xs" dir="ltr">
                        {r.source} / {r.medium}
                      </td>
                      <td className="py-1.5 text-xs">{BUCKET_LABELS[r.bucket] ? tx(BUCKET_LABELS[r.bucket]) : r.bucket}</td>
                      <td className="py-1.5 text-center">
                        <span
                          className={cn(
                            "inline-block rounded-full px-2 py-0.5 text-[10px] font-bold",
                            r.tagged ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"
                          )}
                        >
                          {r.tagged ? tx(S.tagged) : tx(S.untagged)}
                        </span>
                      </td>
                      <td className="py-1.5 text-end" dir="ltr">
                        {formatNumber(r.tx)}
                      </td>
                      <td className="py-1.5 text-end font-semibold" dir="ltr">
                        {formatMoney(r.revenue, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>

          {/* ------------------------------------------------------- explainer */}
          <div className="card border-s-4 border-s-brand-500 p-5">
            <h3 className="mb-2 text-sm font-bold text-slate-700">{tx(S.howToRead)}</h3>
            <p className="text-xs leading-6 text-slate-600">{tx(S.howToReadBody)}</p>
          </div>
        </>
      )}
    </div>
  );
}
