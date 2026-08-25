// Country/market layer (migration 117). The platform has no Country column,
// so `market` is derived in the DB from City ("SA City"/"AE City"), the phone
// shape and — for carts — the linked customer. "GF" = a Gulf mobile whose
// prefix exists in both KSA and UAE (50/54/55/56/58) with no address yet.

export interface MarketInfo {
  code: string;
  flag: string;
  ar: string;
  en: string;
  dial: string; // international dialing digits (no +)
}

export const MARKETS: MarketInfo[] = [
  { code: "EG", flag: "🇪🇬", ar: "مصر", en: "Egypt", dial: "20" },
  { code: "SA", flag: "🇸🇦", ar: "السعودية", en: "Saudi Arabia", dial: "966" },
  { code: "AE", flag: "🇦🇪", ar: "الإمارات", en: "UAE", dial: "971" },
  { code: "GF", flag: "🌍", ar: "خليجي — غير محدد", en: "Gulf — unknown", dial: "966" },
  { code: "KW", flag: "🇰🇼", ar: "الكويت", en: "Kuwait", dial: "965" },
  { code: "QA", flag: "🇶🇦", ar: "قطر", en: "Qatar", dial: "974" },
  { code: "BH", flag: "🇧🇭", ar: "البحرين", en: "Bahrain", dial: "973" },
  { code: "OM", flag: "🇴🇲", ar: "عُمان", en: "Oman", dial: "968" },
  { code: "JO", flag: "🇯🇴", ar: "الأردن", en: "Jordan", dial: "962" },
];

// codes offered in filter dropdowns (the rest appear once data exists)
export const FILTER_MARKETS = ["EG", "SA", "AE", "GF"];

export function marketInfo(code: string | null | undefined): MarketInfo | null {
  if (!code) return null;
  return MARKETS.find((m) => m.code === code) ?? null;
}

export function marketLabel(code: string | null | undefined, lang: "ar" | "en"): string {
  const m = marketInfo(code);
  if (!m) return code ?? "—";
  return `${m.flag} ${lang === "ar" ? m.ar : m.en}`;
}

export function marketFlag(code: string | null | undefined): string {
  return marketInfo(code)?.flag ?? "";
}

/**
 * Turns a stored matching key (norm_phone_key output: EG => '20'+10 digits,
 * Gulf => bare national 9 digits) into international dialing digits.
 * Ambiguous Gulf numbers use the row's market; unknown Gulf defaults to KSA
 * (the primary Gulf market) unless the 52 prefix betrays UAE.
 */
export function dialFromKey(phoneKey: string | null | undefined, market?: string | null): string | null {
  if (!phoneKey) return null;
  const d = phoneKey.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("20") && d.length === 12) return d;
  if (/^5\d{8}$/.test(d)) {
    if (market && market !== "GF" && market !== "EG") {
      const dial = marketInfo(market)?.dial;
      if (dial) return dial + d;
    }
    if (d.startsWith("52")) return "971" + d;
    return "966" + d;
  }
  if (/^(966|971|965|974|973|968|962)\d{7,9}$/.test(d)) return d;
  return d.length >= 11 ? d : null;
}
