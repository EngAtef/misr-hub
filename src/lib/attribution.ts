// Traffic-source buckets — the same keys public.ga4_source_bucket() writes
// to orders.attr_bucket (migration 109) and GAPS' source report uses.
// "untracked" is the UI name for attr_bucket IS NULL (no GA4 transaction).

export const ATTR_BUCKETS = [
  "meta_tagged",
  "meta_untagged",
  "google_ads",
  "seo",
  "direct",
  "bitly",
  "referral",
  "appstore",
  "other",
  "untracked",
] as const;

export type AttrBucket = (typeof ATTR_BUCKETS)[number];

export const ATTR_LABEL: Record<AttrBucket, { ar: string; en: string }> = {
  meta_tagged: { ar: "إعلانات ميتا", en: "Meta ads" },
  meta_untagged: { ar: "ميتا (بدون وسم)", en: "Meta (untagged)" },
  google_ads: { ar: "إعلانات جوجل", en: "Google Ads" },
  seo: { ar: "بحث طبيعي", en: "Organic search" },
  direct: { ar: "مباشر", en: "Direct" },
  bitly: { ar: "روابط مختصرة", en: "Short links" },
  referral: { ar: "إحالة", en: "Referral" },
  appstore: { ar: "متجر التطبيقات", en: "App store" },
  other: { ar: "أخرى", en: "Other" },
  untracked: { ar: "غير متتبَّع", en: "Untracked" },
};

// badge colours: paid = amber/violet, organic = emerald/sky, unknown = slate
export const ATTR_CLASS: Record<AttrBucket, string> = {
  meta_tagged: "bg-violet-50 text-violet-800",
  meta_untagged: "bg-violet-50 text-violet-600",
  google_ads: "bg-amber-50 text-amber-800",
  seo: "bg-emerald-50 text-emerald-800",
  direct: "bg-sky-50 text-sky-800",
  bitly: "bg-pink-50 text-pink-800",
  referral: "bg-teal-50 text-teal-800",
  appstore: "bg-indigo-50 text-indigo-800",
  other: "bg-slate-100 text-slate-700",
  untracked: "bg-slate-100 text-slate-400",
};

export function attrLabel(bucket: string | null | undefined, lang: "ar" | "en"): string {
  const key = (bucket ?? "untracked") as AttrBucket;
  return (ATTR_LABEL[key] ?? ATTR_LABEL.other)[lang];
}

export function attrClass(bucket: string | null | undefined): string {
  return ATTR_CLASS[(bucket ?? "untracked") as AttrBucket] ?? ATTR_CLASS.other;
}
