// Traffic-source buckets — the same keys public.ga4_source_bucket() writes
// to orders.attr_bucket (migration 109) and GAPS' source report uses.
// "untracked" is the UI name for attr_bucket IS NULL (no GA4 transaction).
//
// Only what GA4 actually recorded is asserted. UTM-tagged ads, google/cpc,
// google/organic, bit.ly, referrer domains and the app store are proven.
// GA4 "(direct)" / "(not set)" / misc means GA4 could NOT see a source, so
// those buckets are labelled Unknown, never presented as a channel.
// meta_untagged = the visitor provably came from facebook/instagram, but
// without a UTM tag it cannot be told whether that was an ad or a post.

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
  meta_untagged: { ar: "ميتا — بدون وسم (إعلان أو منشور)", en: "Meta — untagged (ad or post)" },
  google_ads: { ar: "إعلانات جوجل", en: "Google Ads" },
  seo: { ar: "بحث طبيعي", en: "Organic search" },
  direct: { ar: "غير معروف (مباشر)", en: "Unknown (direct)" },
  bitly: { ar: "روابط مختصرة", en: "Short links" },
  referral: { ar: "إحالة", en: "Referral" },
  appstore: { ar: "متجر التطبيقات", en: "App store" },
  other: { ar: "غير معروف (أخرى)", en: "Unknown (other)" },
  untracked: { ar: "غير متتبَّع", en: "Untracked" },
};

// badge colours: paid = amber/violet, organic = emerald/sky, unknown = slate
export const ATTR_CLASS: Record<AttrBucket, string> = {
  meta_tagged: "bg-violet-50 text-violet-800",
  meta_untagged: "bg-violet-50 text-violet-600",
  google_ads: "bg-amber-50 text-amber-800",
  seo: "bg-emerald-50 text-emerald-800",
  direct: "bg-slate-100 text-slate-500",
  bitly: "bg-pink-50 text-pink-800",
  referral: "bg-teal-50 text-teal-800",
  appstore: "bg-indigo-50 text-indigo-800",
  other: "bg-slate-100 text-slate-500",
  untracked: "bg-slate-100 text-slate-400",
};

export function attrLabel(bucket: string | null | undefined, lang: "ar" | "en"): string {
  const key = (bucket ?? "untracked") as AttrBucket;
  return (ATTR_LABEL[key] ?? ATTR_LABEL.other)[lang];
}

export function attrClass(bucket: string | null | undefined): string {
  return ATTR_CLASS[(bucket ?? "untracked") as AttrBucket] ?? ATTR_CLASS.other;
}
