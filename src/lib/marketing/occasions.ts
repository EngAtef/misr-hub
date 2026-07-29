// Egyptian retail/book-market occasions calendar. Fixed civil dates recur
// yearly; Hijri occasions (Ramadan/Eids) are hardcoded per year with
// approximate civil dates (moon-sighting shifts them ±1-2 days).

export interface Occasion {
  key: string;
  name: string;
  date: Date;
  prepDays: number; // start campaigns this many days before
  genres: string[]; // genre keys that benefit most
  advice: string;
  approximate?: boolean;
}

function yearly(md: string, year: number): Date {
  return new Date(`${year}-${md}T00:00:00`);
}

function buildAll(year: number): Occasion[] {
  const hijri: Record<number, { ramadan: string; fitr: string; adha: string }> = {
    2026: { ramadan: "2026-02-18", fitr: "2026-03-20", adha: "2026-05-27" },
    2027: { ramadan: "2027-02-08", fitr: "2027-03-10", adha: "2027-05-17" },
    2028: { ramadan: "2028-01-28", fitr: "2028-02-27", adha: "2028-05-05" },
  };
  const h = hijri[year];
  const list: Occasion[] = [
    {
      key: "book_fair", name: "معرض القاهرة الدولي للكتاب", date: yearly("01-25", year), prepDays: 21,
      genres: ["novel", "history", "selfdev", "general"],
      advice: "أهم موسم للكتب في السنة — القراء بيجهزوا قوائم شراء. نافس بعروض «وفّر مشوار المعرض: نفس الكتب لحد بابك».",
    },
    {
      key: "mothers_day", name: "عيد الأم", date: yearly("03-21", year), prepDays: 14,
      genres: ["kids", "religion", "general"],
      advice: "موسم إهداء قوي — بوستات «هدية لماما» وباقات إهداء مغلفة. ابدأ الحملة قبلها بأسبوعين.",
    },
    {
      key: "summer", name: "بداية إجازة الصيف", date: yearly("06-01", year), prepDays: 14,
      genres: ["kids", "novel"],
      advice: "الأمهات بتدور على بديل للشاشات، والقراء بيجهزوا قراءات المصيف — باقات «مكتبة الإجازة».",
    },
    {
      key: "back_to_school", name: "العودة للمدارس", date: yearly("09-20", year), prepDays: 30,
      genres: ["kids", "selfdev"],
      advice: "أكبر موسم شراء للأطفال — القصص التعليمية وقصص القيم. ابدأ من منتصف أغسطس.",
    },
    {
      key: "new_year", name: "بداية السنة الجديدة", date: yearly("01-01", year), prepDays: 10,
      genres: ["selfdev"],
      advice: "موسم «نسخة أحسن مني» — كتب تطوير الذات والتخطيط بتبيع أقوى ما يمكن في يناير.",
    },
  ];
  if (h) {
    list.push(
      {
        key: "ramadan", name: "شهر رمضان", date: new Date(`${h.ramadan}T00:00:00`), prepDays: 21, approximate: true,
        genres: ["religion", "kids"],
        advice: "ذروة الكتب الدينية وقصص الأطفال الإيمانية — «حقيبة رمضان» + محتوى يومي (آية/دعاء/اقتباس). جهّز الحملة قبل الشهر بـ 3 أسابيع.",
      },
      {
        key: "eid_fitr", name: "عيد الفطر", date: new Date(`${h.fitr}T00:00:00`), prepDays: 10, approximate: true,
        genres: ["kids", "general"],
        advice: "العيدية بقت كتاب — باقات هدايا الأطفال بتغليف العيد.",
      },
      {
        key: "eid_adha", name: "عيد الأضحى", date: new Date(`${h.adha}T00:00:00`), prepDays: 10, approximate: true,
        genres: ["kids", "religion"],
        advice: "إجازة طويلة = وقت قراءة — باقات العيد للأطفال والعائلة.",
      },
    );
  }
  return list;
}

export interface UpcomingOccasion extends Occasion {
  daysLeft: number;
  inPrepWindow: boolean;
}

// Occasions within the horizon (default ~11 weeks), nearest first.
export function upcomingOccasions(now: Date, horizonDays = 80): UpcomingOccasion[] {
  const all = [...buildAll(now.getFullYear()), ...buildAll(now.getFullYear() + 1)];
  return all
    .map((o) => ({
      ...o,
      daysLeft: Math.ceil((o.date.getTime() - now.getTime()) / 86400000),
      inPrepWindow: false,
    }))
    .filter((o) => o.daysLeft >= -5 && o.daysLeft <= horizonDays)
    .map((o) => ({ ...o, inPrepWindow: o.daysLeft <= o.prepDays }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

// One-line hint for the director's plan: the nearest occasion that fits the
// book's genre (or the nearest overall if none match).
export function occasionHint(now: Date, genreKey: string): string {
  const up = upcomingOccasions(now);
  if (!up.length) return "";
  const fit = up.find((o) => o.genres.includes(genreKey)) ?? up[0];
  const when = fit.daysLeft <= 0 ? "بدأ بالفعل" : `بعد ${fit.daysLeft} يوم${fit.approximate ? " تقريبًا" : ""}`;
  const urgency = fit.inPrepWindow ? "⏰ ابدأ الحملة الآن — " : "";
  return `${urgency}${fit.name} (${when}): ${fit.advice}`;
}
