// Egyptian retail/book-market occasions calendar. Fixed civil dates recur
// yearly; Hijri occasions (Ramadan/Eids) are hardcoded per year with
// approximate civil dates (moon-sighting shifts them ±1-2 days).
// Bilingual: pass lang to get the localized name/advice.

export type OccLang = "ar" | "en";
type Bi = { ar: string; en: string };

interface OccasionDef {
  key: string;
  name: Bi;
  date: Date;
  prepDays: number; // start campaigns this many days before
  genres: string[]; // genre keys that benefit most
  advice: Bi;
  approximate?: boolean;
}

function yearly(md: string, year: number): Date {
  return new Date(`${year}-${md}T00:00:00`);
}

function buildAll(year: number): OccasionDef[] {
  const hijri: Record<number, { ramadan: string; fitr: string; adha: string }> = {
    2026: { ramadan: "2026-02-18", fitr: "2026-03-20", adha: "2026-05-27" },
    2027: { ramadan: "2027-02-08", fitr: "2027-03-10", adha: "2027-05-17" },
    2028: { ramadan: "2028-01-28", fitr: "2028-02-27", adha: "2028-05-05" },
  };
  const h = hijri[year];
  const list: OccasionDef[] = [
    {
      key: "book_fair",
      name: { ar: "معرض القاهرة الدولي للكتاب", en: "Cairo International Book Fair" },
      date: yearly("01-25", year), prepDays: 21,
      genres: ["novel", "history", "selfdev", "general"],
      advice: {
        ar: "أهم موسم للكتب في السنة — القراء بيجهزوا قوائم شراء. نافس بعروض «وفّر مشوار المعرض: نفس الكتب لحد بابك».",
        en: "The biggest book season of the year — readers prepare buying lists. Compete with “skip the fair trip: same books to your door” offers.",
      },
    },
    {
      key: "mothers_day",
      name: { ar: "عيد الأم", en: "Mother's Day (Egypt, Mar 21)" },
      date: yearly("03-21", year), prepDays: 14,
      genres: ["kids", "religion", "general"],
      advice: {
        ar: "موسم إهداء قوي — بوستات «هدية لماما» وباقات إهداء مغلفة. ابدأ الحملة قبلها بأسبوعين.",
        en: "A strong gifting season — “a gift for mom” posts and wrapped gift bundles. Start the campaign two weeks ahead.",
      },
    },
    {
      key: "summer",
      name: { ar: "بداية إجازة الصيف", en: "Start of summer break" },
      date: yearly("06-01", year), prepDays: 14,
      genres: ["kids", "novel"],
      advice: {
        ar: "الأمهات بتدور على بديل للشاشات، والقراء بيجهزوا قراءات المصيف — باقات «مكتبة الإجازة».",
        en: "Moms look for screen-time alternatives and readers stock up on beach reads — push “holiday library” bundles.",
      },
    },
    {
      key: "back_to_school",
      name: { ar: "العودة للمدارس", en: "Back to school" },
      date: yearly("09-20", year), prepDays: 30,
      genres: ["kids", "selfdev"],
      advice: {
        ar: "أكبر موسم شراء للأطفال — القصص التعليمية وقصص القيم. ابدأ من منتصف أغسطس.",
        en: "The biggest kids' buying season — educational stories and values stories. Start from mid-August.",
      },
    },
    {
      key: "new_year",
      name: { ar: "بداية السنة الجديدة", en: "New year" },
      date: yearly("01-01", year), prepDays: 10,
      genres: ["selfdev"],
      advice: {
        ar: "موسم «نسخة أحسن مني» — كتب تطوير الذات والتخطيط بتبيع أقوى ما يمكن في يناير.",
        en: "“Better-me” season — self-development and planning books sell strongest in January.",
      },
    },
  ];
  if (h) {
    list.push(
      {
        key: "ramadan",
        name: { ar: "شهر رمضان", en: "Ramadan" },
        date: new Date(`${h.ramadan}T00:00:00`), prepDays: 21, approximate: true,
        genres: ["religion", "kids"],
        advice: {
          ar: "ذروة الكتب الدينية وقصص الأطفال الإيمانية — «حقيبة رمضان» + محتوى يومي (آية/دعاء/اقتباس). جهّز الحملة قبل الشهر بـ 3 أسابيع.",
          en: "Peak season for religious books and kids' faith stories — “Ramadan bag” bundles + daily content (verse/dua/quote). Prepare the campaign 3 weeks before the month.",
        },
      },
      {
        key: "eid_fitr",
        name: { ar: "عيد الفطر", en: "Eid al-Fitr" },
        date: new Date(`${h.fitr}T00:00:00`), prepDays: 10, approximate: true,
        genres: ["kids", "general"],
        advice: {
          ar: "العيدية بقت كتاب — باقات هدايا الأطفال بتغليف العيد.",
          en: "Eidiya as a book — kids' gift bundles in Eid wrapping.",
        },
      },
      {
        key: "eid_adha",
        name: { ar: "عيد الأضحى", en: "Eid al-Adha" },
        date: new Date(`${h.adha}T00:00:00`), prepDays: 10, approximate: true,
        genres: ["kids", "religion"],
        advice: {
          ar: "إجازة طويلة = وقت قراءة — باقات العيد للأطفال والعائلة.",
          en: "A long holiday = reading time — Eid bundles for kids and family.",
        },
      },
    );
  }
  return list;
}

export interface UpcomingOccasion {
  key: string;
  name: string;
  date: Date;
  prepDays: number;
  genres: string[];
  advice: string;
  approximate?: boolean;
  daysLeft: number;
  inPrepWindow: boolean;
}

// Occasions within the horizon (default ~11 weeks), nearest first, localized.
export function upcomingOccasions(now: Date, lang: OccLang = "ar", horizonDays = 80): UpcomingOccasion[] {
  const all = [...buildAll(now.getFullYear()), ...buildAll(now.getFullYear() + 1)];
  return all
    .map((o) => ({
      key: o.key,
      name: o.name[lang],
      date: o.date,
      prepDays: o.prepDays,
      genres: o.genres,
      advice: o.advice[lang],
      approximate: o.approximate,
      daysLeft: Math.ceil((o.date.getTime() - now.getTime()) / 86400000),
      inPrepWindow: false,
    }))
    .filter((o) => o.daysLeft >= -5 && o.daysLeft <= horizonDays)
    .map((o) => ({ ...o, inPrepWindow: o.daysLeft <= o.prepDays }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

// One-line hint for the director's plan: the nearest occasion that fits the
// book's genre (or the nearest overall if none match).
export function occasionHint(now: Date, genreKey: string, lang: OccLang = "ar"): string {
  const up = upcomingOccasions(now, lang);
  if (!up.length) return "";
  const fit = up.find((o) => o.genres.includes(genreKey)) ?? up[0];
  const when = lang === "ar"
    ? fit.daysLeft <= 0 ? "بدأ بالفعل" : `بعد ${fit.daysLeft} يوم${fit.approximate ? " تقريبًا" : ""}`
    : fit.daysLeft <= 0 ? "already started" : `in ${fit.daysLeft} days${fit.approximate ? " (approx.)" : ""}`;
  const urgency = fit.inPrepWindow ? (lang === "ar" ? "⏰ ابدأ الحملة الآن — " : "⏰ Start the campaign now — ") : "";
  return `${urgency}${fit.name} (${when}): ${fit.advice}`;
}
