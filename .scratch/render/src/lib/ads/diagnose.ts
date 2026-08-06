import type { AdRow, AdSettings, AdTotals } from "./types";

/**
 * The media-buyer layer: what's wrong with an ad, and what to do about it.
 *
 * The reasoning follows the funnel in order, because only the FIRST broken
 * step is actionable — an ad with a 0.4% CTR doesn't have a checkout problem,
 * it has a creative problem, and its checkout numbers are too small to read.
 *
 *   impressions -> clicks     weak = creative / audience
 *   clicks      -> landings   weak = speed, broken link, wrong destination
 *   landings    -> add to cart weak = price, cover, description, out of stock
 *   add to cart -> checkout   weak = shipping cost shock, cart friction
 *   checkout    -> purchase   weak = payment options, form length, trust
 *
 * Benchmarks are the account's own spend-weighted medians wherever possible,
 * so the advice adapts as the account changes instead of hard-coding numbers
 * from a different market.
 */

export type Verdict = "scale" | "keep" | "watch" | "fix" | "kill" | "no_data" | "unmapped";

export interface Bi {
  ar: string;
  en: string;
}

export interface Reason {
  code: string;
  severity: "red" | "amber" | "info" | "good";
  title: Bi;
  detail: Bi;
  action: Bi;
}

export interface Diagnosis {
  verdict: Verdict;
  score: number; // 0-100, for ranking
  reasons: Reason[];
  bottleneck: string | null;
}

export interface Benchmarks {
  ctr: number;
  cpm: number;
  cpc: number;
  lpRate: number;
  atcRate: number;
  icRate: number;
  purchaseRate: number;
  cvr: number;
}

// Floors used when the account is too small to produce a stable median.
// Sourced from the store's own July 2026 aggregate, rounded down.
const FLOORS: Benchmarks = {
  ctr: 1.2,
  cpm: 45,
  cpc: 4,
  lpRate: 45,
  atcRate: 40,
  icRate: 20,
  purchaseRate: 30,
  cvr: 1.5,
};

function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Medians across the ads that actually spent something — tiny ads have wild
 *  rates that would drag a plain average around. */
export function computeBenchmarks(rows: AdRow[], minSpend = 100): Benchmarks {
  const live = rows.filter((r) => r.level === "ad" && (r.spend ?? 0) >= minSpend);
  const pick = (f: (r: AdRow) => number | null) =>
    live.map(f).filter((x): x is number => x !== null && Number.isFinite(x) && x > 0);
  return {
    ctr: median(pick((r) => r.ctr_all)) ?? FLOORS.ctr,
    cpm: median(pick((r) => r.cpm)) ?? FLOORS.cpm,
    cpc: median(pick((r) => r.cpc)) ?? FLOORS.cpc,
    lpRate: median(pick((r) => r.lp_rate)) ?? FLOORS.lpRate,
    atcRate: median(pick((r) => r.atc_rate)) ?? FLOORS.atcRate,
    icRate: median(pick((r) => r.ic_rate)) ?? FLOORS.icRate,
    purchaseRate: median(pick((r) => r.purchase_rate)) ?? FLOORS.purchaseRate,
    cvr: median(pick((r) => r.cvr)) ?? FLOORS.cvr,
  };
}

/** Revenue multiple at which an ad stops losing money, given the book margin.
 *  35% margin -> every EGP of spend needs 2.86 EGP of revenue to break even. */
export function breakevenRoas(settings: AdSettings): number {
  const margin = Math.min(Math.max(settings.gross_margin_pct, 1), 99) / 100;
  return 1 / margin;
}

const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const money = (v: number) => `${Math.round(v).toLocaleString("en-EG")} EGP`;

export function diagnose(
  row: {
    spend: number | null;
    impressions: number | null;
    frequency: number | null;
    cpm: number | null;
    ctr_all: number | null;
    link_clicks: number | null;
    lp_rate: number | null;
    atc_rate: number | null;
    ic_rate: number | null;
    purchase_rate: number | null;
    purchases: number | null;
    actual_roas: number | null;
    reported_roas: number | null;
    book_label: string | null;
    book_stock: number | null;
    cancel_rate: number | null;
    delivery_status: string | null;
  },
  ctx: { settings: AdSettings; bench: Benchmarks }
): Diagnosis {
  const { settings, bench } = ctx;
  const spend = row.spend ?? 0;
  const reasons: Reason[] = [];
  const be = breakevenRoas(settings);
  const roas = row.actual_roas;

  // ---------------------------------------------------------- data gates
  if (!row.book_label) {
    reasons.push({
      code: "unmapped",
      severity: "amber",
      title: { ar: "غير مربوط بكتاب", en: "Not linked to a book" },
      detail: {
        ar: "مفيش كتاب مربوط بالإعلان ده، فمش قادرين نحسب المبيعات الحقيقية — الرقم الظاهر من ميتا بس.",
        en: "No book is mapped to this ad, so real sales can't be measured — only Meta's own claim.",
      },
      action: {
        ar: "افتح تبويب «الربط» واربط اسم الإعلان بالكتاب أو الـ SKU اللي بيروّج له.",
        en: "Open the Mapping tab and link this ad name to the book or SKU it promotes.",
      },
    });
  }

  if (spend < settings.min_spend) {
    return {
      verdict: row.book_label ? "no_data" : "unmapped",
      score: 50,
      reasons: [
        ...reasons,
        {
          code: "low_spend",
          severity: "info",
          title: { ar: "إنفاق قليل للحكم", en: "Too little spend to judge" },
          detail: {
            ar: `صرف ${money(spend)} فقط — أقل من حد القراءة (${money(settings.min_spend)}).`,
            en: `Only ${money(spend)} spent — below the reading threshold of ${money(settings.min_spend)}.`,
          },
          action: {
            ar: "سيبه يجمع بيانات أو اقفله لو مش جزء من اختبار.",
            en: "Let it gather data, or switch it off if it isn't part of a test.",
          },
        },
      ],
      bottleneck: null,
    };
  }

  // ------------------------------------------------------- funnel, in order
  let bottleneck: string | null = null;

  const weak = (v: number | null, mark: number, ratio = 0.7) => v !== null && v < mark * ratio;

  if (weak(row.ctr_all, bench.ctr)) {
    bottleneck = bottleneck ?? "creative";
    reasons.push({
      code: "creative",
      severity: "red",
      title: { ar: "الإبداع ضعيف (CTR منخفض)", en: "Weak creative (low CTR)" },
      detail: {
        ar: `نسبة النقر ${pct(row.ctr_all)} مقابل متوسط الحساب ${pct(bench.ctr)} — الناس بتعدّي الإعلان.`,
        en: `CTR is ${pct(row.ctr_all)} vs the account median ${pct(bench.ctr)} — people are scrolling past.`,
      },
      action: {
        ar: "غيّر أول 3 ثوانٍ/الهوك، جرّب فيديو 9:16، واطرح 3-4 أفكار إبداعية مختلفة مش نسخ من نفس التصميم.",
        en: "Rewrite the first 3 seconds / hook, try 9:16 video, and run 3-4 genuinely different concepts — not copies of one design.",
      },
    });
  } else if (weak(row.lp_rate, bench.lpRate)) {
    bottleneck = bottleneck ?? "landing";
    reasons.push({
      code: "landing",
      severity: "red",
      title: { ar: "تسريب بين النقر والصفحة", en: "Clicks aren't landing" },
      detail: {
        ar: `${pct(row.lp_rate)} بس من النقرات وصلت الصفحة (المتوسط ${pct(bench.lpRate)}) — يعني بطء تحميل أو لينك غلط.`,
        en: `Only ${pct(row.lp_rate)} of clicks reached the page (median ${pct(bench.lpRate)}) — slow load or a broken/wrong link.`,
      },
      action: {
        ar: "افتح لينك الإعلان من الموبايل واقِس زمن التحميل، وتأكد إنه بيروح لصفحة الكتاب نفسه مش الصفحة الرئيسية.",
        en: "Open the ad's link on mobile and time the load; make sure it goes to the book's own page, not the homepage.",
      },
    });
  } else if (weak(row.atc_rate, bench.atcRate)) {
    bottleneck = bottleneck ?? "product_page";
    reasons.push({
      code: "product_page",
      severity: "amber",
      title: { ar: "صفحة المنتج مش بتقنع", en: "Product page isn't converting" },
      detail: {
        ar: `${pct(row.atc_rate)} من الزوار ضافوا للسلة (المتوسط ${pct(bench.atcRate)}) — الوعد في الإعلان مش مطابق للصفحة.`,
        en: `${pct(row.atc_rate)} of visitors added to cart (median ${pct(bench.atcRate)}) — the page isn't delivering the ad's promise.`,
      },
      action: {
        ar: "راجع السعر والصور والوصف وتوافر المخزون، وخلّي الإعلان يوعد بنفس اللي في الصفحة.",
        en: "Review price, images, description and stock, and make the ad promise exactly what the page delivers.",
      },
    });
  } else if (weak(row.ic_rate, bench.icRate)) {
    bottleneck = bottleneck ?? "cart";
    reasons.push({
      code: "cart",
      severity: "amber",
      title: { ar: "السلة بتتساب", en: "Carts are being abandoned" },
      detail: {
        ar: `${pct(row.ic_rate)} بس من السلات بدأت الدفع (المتوسط ${pct(bench.icRate)}) — غالباً مفاجأة مصاريف الشحن.`,
        en: `Only ${pct(row.ic_rate)} of carts started checkout (median ${pct(bench.icRate)}) — usually a shipping-cost surprise.`,
      },
      action: {
        ar: "اعرض مصاريف الشحن بدري، وفكّر في حد أدنى للشحن المجاني، وشغّل رسائل استرجاع السلات من صفحة «السلات المتروكة».",
        en: "Show shipping cost early, consider a free-shipping threshold, and run cart recovery from the Abandoned Carts page.",
      },
    });
  } else if (weak(row.purchase_rate, bench.purchaseRate)) {
    bottleneck = bottleneck ?? "checkout";
    reasons.push({
      code: "checkout",
      severity: "amber",
      title: { ar: "تسريب في الدفع", en: "Checkout is leaking" },
      detail: {
        ar: `${pct(row.purchase_rate)} من اللي بدأوا الدفع أتموا الطلب (المتوسط ${pct(bench.purchaseRate)}).`,
        en: `${pct(row.purchase_rate)} of started checkouts completed (median ${pct(bench.purchaseRate)}).`,
      },
      action: {
        ar: "قلّل خانات الفورم، أكّد إن الدفع عند الاستلام واضح، وراجع بوابة الدفع (الكارت بيسقط كتير).",
        en: "Cut form fields, make cash-on-delivery obvious, and check the payment gateway (card payments drop out most).",
      },
    });
  }

  // --------------------------------------------------- delivery-side flags
  if ((row.frequency ?? 0) >= settings.frequency_cap) {
    reasons.push({
      code: "fatigue",
      severity: "amber",
      title: { ar: "إرهاق إبداعي", en: "Creative fatigue" },
      detail: {
        ar: `التكرار ${(row.frequency ?? 0).toFixed(1)} — نفس الناس شافت الإعلان كتير.`,
        en: `Frequency is ${(row.frequency ?? 0).toFixed(1)} — the same people keep seeing it.`,
      },
      action: {
        ar: "غيّر التصميم أو وسّع الجمهور؛ الاستمرار بنفس الإعلان هيرفع الـ CPM ويقلّل النتائج.",
        en: "Refresh the creative or widen the audience; running it longer raises CPM and lowers results.",
      },
    });
  }

  if (row.cpm !== null && row.cpm > bench.cpm * 1.5) {
    reasons.push({
      code: "expensive_reach",
      severity: "amber",
      title: { ar: "وصول غالي (CPM مرتفع)", en: "Expensive reach (high CPM)" },
      detail: {
        ar: `CPM ${Math.round(row.cpm)} مقابل ${Math.round(bench.cpm)} للحساب — الجمهور ضيق أو المزاد مزدحم.`,
        en: `CPM is ${Math.round(row.cpm)} vs ${Math.round(bench.cpm)} for the account — narrow audience or a crowded auction.`,
      },
      action: {
        ar: "وسّع الاستهداف أو ادمج المجموعات الإعلانية الصغيرة في مجموعة واحدة عشان الخوارزمية تتعلّم أسرع.",
        en: "Broaden targeting or merge small ad sets into one so the algorithm exits learning faster.",
      },
    });
  }

  if ((row.cancel_rate ?? 0) > 15) {
    reasons.push({
      code: "cancellations",
      severity: "red",
      title: { ar: "نسبة إلغاء عالية", en: "High cancellation rate" },
      detail: {
        ar: `${pct(row.cancel_rate)} من طلبات الكتاب ده اتلغت — الإعلان بيجيب طلبات مش بتوصل.`,
        en: `${pct(row.cancel_rate)} of this book's orders were cancelled — the ad brings orders that don't stick.`,
      },
      action: {
        ar: "راجع وضوح السعر والشحن في الإعلان، وأكّد الطلبات بواتساب قبل الشحن.",
        en: "Make price and shipping unambiguous in the ad, and confirm orders on WhatsApp before dispatch.",
      },
    });
  }

  if (row.book_label && row.book_stock !== null && row.book_stock <= 0) {
    reasons.push({
      code: "stockout",
      severity: "red",
      title: { ar: "بتصرف على كتاب مخزونه صفر", en: "Spending on an out-of-stock book" },
      detail: {
        ar: "المخزون على الموقع صفر — كل جنيه بيتصرف دلوقتي ضايع.",
        en: "On-site stock is zero — every pound spent right now is wasted.",
      },
      action: {
        ar: "أوقف الإعلان لحد ما يتوفر المخزون، أو حوّل الميزانية لكتاب تاني من نفس السلسلة.",
        en: "Pause the ad until stock arrives, or move the budget to another book in the same series.",
      },
    });
  }

  // ------------------------------------------------------------- the verdict
  let verdict: Verdict;
  if (roas === null) {
    verdict = row.book_label ? "watch" : "unmapped";
  } else if (roas >= settings.target_roas && (row.frequency ?? 0) < settings.frequency_cap) {
    verdict = "scale";
    reasons.unshift({
      code: "winner",
      severity: "good",
      title: { ar: "إعلان رابح — زوّد الميزانية", en: "Winner — scale it" },
      detail: {
        ar: `عائد فعلي ${roas.toFixed(2)}x فوق الهدف ${settings.target_roas}x.`,
        en: `Actual ROAS ${roas.toFixed(2)}x, above the ${settings.target_roas}x target.`,
      },
      action: {
        ar: "زوّد الميزانية 20-30% كل يومين بحد أقصى، ونزّل نسخة جديدة من نفس الفكرة قبل ما يتشبع.",
        en: "Raise budget by 20-30% every couple of days at most, and queue a fresh variant of the same idea before it saturates.",
      },
    });
  } else if (roas >= be) {
    verdict = reasons.some((r) => r.severity === "red") ? "fix" : "keep";
    reasons.push({
      code: "profitable",
      severity: "good",
      title: { ar: "بيربح لكن تحت الهدف", en: "Profitable but under target" },
      detail: {
        ar: `عائد ${roas.toFixed(2)}x فوق التعادل ${be.toFixed(2)}x وتحت الهدف ${settings.target_roas}x.`,
        en: `${roas.toFixed(2)}x — above the ${be.toFixed(2)}x break-even, below the ${settings.target_roas}x target.`,
      },
      action: {
        ar: "سيبه شغال بنفس الميزانية وحسّن أضعف خطوة في القمع قبل ما تزوّد الصرف.",
        en: "Hold the budget where it is and fix the weakest funnel step before spending more.",
      },
    });
  } else if (roas >= be * 0.5) {
    verdict = "fix";
    // an ad can land here with a clean funnel — say why it's still flagged
    reasons.push({
      code: "under_breakeven",
      severity: "amber",
      title: { ar: "تحت نقطة التعادل", en: "Below break-even" },
      detail: {
        ar: `عائد ${roas.toFixed(2)}x مقابل ${be.toFixed(2)}x المطلوبة عند هامش ${settings.gross_margin_pct}% — بيغطي جزء من تكلفته بس.`,
        en: `${roas.toFixed(2)}x against the ${be.toFixed(2)}x needed at a ${settings.gross_margin_pct}% margin — it only covers part of its cost.`,
      },
      action: {
        ar: "قلّل الميزانية وجرّب تصميم أو عرض جديد؛ لو ما اتحسّنش خلال أسبوع اقفله.",
        en: "Cut the budget and test a new creative or offer; if it doesn't move within a week, switch it off.",
      },
    });
  } else {
    verdict = "kill";
    reasons.unshift({
      code: "losing",
      severity: "red",
      title: { ar: "بيخسر فلوس", en: "Losing money" },
      detail: {
        ar: `عائد فعلي ${roas.toFixed(2)}x مقابل نقطة التعادل ${be.toFixed(2)}x عند هامش ${settings.gross_margin_pct}%.`,
        en: `Actual ROAS ${roas.toFixed(2)}x against a ${be.toFixed(2)}x break-even at a ${settings.gross_margin_pct}% margin.`,
      },
      action: {
        ar: "اقفله وحوّل ميزانيته لأقوى إعلان في نفس الحساب.",
        en: "Switch it off and move its budget to the strongest ad in the same account.",
      },
    });
  }

  if (spend >= settings.min_spend && (row.purchases ?? 0) === 0 && (row.actual_roas ?? 0) === 0) {
    verdict = "kill";
    reasons.unshift({
      code: "dead_spend",
      severity: "red",
      title: { ar: "إنفاق بلا نتيجة", en: "Spend with zero result" },
      detail: {
        ar: `${money(spend)} من غير أي عملية شراء.`,
        en: `${money(spend)} spent with no purchases at all.`,
      },
      action: {
        ar: "اقفله فوراً وراجع إعدادات التتبع (Pixel/CAPI) قبل ما تطلق نسخة تانية.",
        en: "Switch it off now and verify tracking (Pixel/CAPI) before launching another version.",
      },
    });
  }

  // ------------------------------------------------------------------ score
  const roasScore = roas === null ? 40 : Math.min(100, (roas / settings.target_roas) * 70);
  const funnelPenalty = reasons.filter((r) => r.severity === "red").length * 12 + reasons.filter((r) => r.severity === "amber").length * 6;
  const score = Math.max(0, Math.min(100, Math.round(roasScore + 30 - funnelPenalty)));

  return { verdict, score, reasons, bottleneck };
}

// -------------------------------------------------------------- portfolio

export interface PortfolioInsight {
  code: string;
  severity: "red" | "amber" | "info" | "good";
  title: Bi;
  detail: Bi;
  action: Bi;
  value?: number;
}

/**
 * Account-level observations that only appear when you look across ads:
 * budget concentrated in losers, the same creative duplicated across ad sets,
 * a gap between what Meta claims and what the store actually sold.
 */
export function portfolioInsights(
  rows: AdRow[],
  agg: AdTotals,
  settings: AdSettings,
  storeRevenue: number | null
): PortfolioInsight[] {
  const out: PortfolioInsight[] = [];
  const ads = rows.filter((r) => r.level === "ad");
  const be = breakevenRoas(settings);
  const bench = computeBenchmarks(rows);

  // 1. how much money sits in ads that lose money
  const losing = ads.filter(
    (r) => (r.spend ?? 0) >= settings.min_spend && r.actual_roas !== null && r.actual_roas < be
  );
  const losingSpend = losing.reduce((s, r) => s + (r.spend ?? 0), 0);
  if (losingSpend > 0 && agg.spend > 0) {
    const share = (losingSpend / agg.spend) * 100;
    out.push({
      code: "losing_budget",
      severity: share > 30 ? "red" : "amber",
      value: losingSpend,
      title: {
        ar: `${Math.round(share)}% من الميزانية تحت نقطة التعادل`,
        en: `${Math.round(share)}% of budget is below break-even`,
      },
      detail: {
        ar: `${losing.length} إعلان صرفوا ${money(losingSpend)} بعائد أقل من ${be.toFixed(2)}x.`,
        en: `${losing.length} ads spent ${money(losingSpend)} at under ${be.toFixed(2)}x return.`,
      },
      action: {
        ar: "اقفل أضعف 3 إعلانات وحوّل ميزانيتهم للرابحين — ده أسرع تحسين ممكن من غير أي تصميم جديد.",
        en: "Kill the weakest three and move their budget to the winners — the fastest gain available without new creative.",
      },
    });
  }

  // 2. concentration risk: one ad carrying the account
  const top = [...ads].sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))[0];
  if (top && agg.spend > 0 && (top.spend ?? 0) / agg.spend > 0.25) {
    out.push({
      code: "concentration",
      severity: "info",
      value: (top.spend ?? 0) / agg.spend,
      title: {
        ar: `إعلان واحد بياخد ${Math.round(((top.spend ?? 0) / agg.spend) * 100)}% من الإنفاق`,
        en: `One ad takes ${Math.round(((top.spend ?? 0) / agg.spend) * 100)}% of spend`,
      },
      detail: {
        ar: `«${top.ad_name}» — لو اتشبع أو وقف، الحساب كله هيتأثر.`,
        en: `"${top.ad_name}" — if it saturates or stops, the whole account feels it.`,
      },
      action: {
        ar: "جهّز بديلين على الأقل بنفس الفكرة عشان تحل محله من غير هبوط.",
        en: "Have at least two replacements on the same idea ready so it can be swapped without a dip.",
      },
    });
  }

  // 3. the same creative running in several ad sets — usually competing with itself
  const byName = new Map<string, AdRow[]>();
  for (const r of ads) {
    const k = `${r.period_key}|${(r.ad_name ?? "").toLowerCase()}`;
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  const duplicated = Array.from(byName.values()).filter((list) => list.length > 1);
  if (duplicated.length) {
    const worst = duplicated
      .map((list) => {
        const sorted = [...list].sort((a, b) => (b.actual_roas ?? 0) - (a.actual_roas ?? 0));
        return { list, best: sorted[0], worst: sorted[sorted.length - 1] };
      })
      .filter((d) => (d.worst.spend ?? 0) >= settings.min_spend && (d.best.actual_roas ?? 0) > (d.worst.actual_roas ?? 0) * 1.6)
      .sort((a, b) => (b.worst.spend ?? 0) - (a.worst.spend ?? 0))[0];
    if (worst) {
      out.push({
        code: "duplicate_creative",
        severity: "amber",
        value: worst.worst.spend ?? 0,
        title: { ar: "نفس الإعلان في أكتر من مجموعة بنتائج مختلفة", en: "Same creative in several ad sets, different results" },
        detail: {
          ar: `«${worst.best.ad_name}» بيعمل ${(worst.best.actual_roas ?? 0).toFixed(2)}x في «${worst.best.adset_name}» و ${(worst.worst.actual_roas ?? 0).toFixed(2)}x في «${worst.worst.adset_name}».`,
          en: `"${worst.best.ad_name}" returns ${(worst.best.actual_roas ?? 0).toFixed(2)}x in "${worst.best.adset_name}" but ${(worst.worst.actual_roas ?? 0).toFixed(2)}x in "${worst.worst.adset_name}".`,
        },
        action: {
          ar: "اقفل النسخة الأضعف وركّز الميزانية في المجموعة الأقوى — الاتنين بيتنافسوا على نفس المزاد.",
          en: "Turn off the weaker copy and concentrate budget in the stronger ad set — they're bidding against each other.",
        },
      });
    }
  }

  // 4. Meta's claim vs what the store really sold
  if (agg.metaValue > 0 && agg.attRevenue > 0) {
    const gap = agg.metaValue / agg.attRevenue;
    if (gap > 1.5) {
      out.push({
        code: "overclaim",
        severity: "info",
        value: gap,
        title: { ar: `ميتا بتدّعي ${gap.toFixed(1)}× المبيعات الفعلية`, en: `Meta claims ${gap.toFixed(1)}× the real sales` },
        detail: {
          ar: `المنصة بتقول ${money(agg.metaValue)} والمبيعات الحقيقية للكتب المعلن عنها ${money(agg.attRevenue)} — ميتا بتحسب أي شراء بعد النقر حتى لو لكتاب تاني.`,
          en: `The platform reports ${money(agg.metaValue)} while the advertised books really sold ${money(agg.attRevenue)} — Meta credits any purchase after a click, even of another book.`,
        },
        action: {
          ar: "خُد قرارات الميزانية من عمود «العائد الفعلي» مش من أرقام ميتا.",
          en: "Make budget decisions from the Actual ROAS column, not Meta's numbers.",
        },
      });
    }
  }

  // 5. paid share of the whole store
  if (storeRevenue && storeRevenue > 0 && agg.spend > 0) {
    const share = (agg.spend / storeRevenue) * 100;
    out.push({
      code: "spend_share",
      severity: share > 30 ? "amber" : "good",
      value: share,
      title: { ar: `الإعلانات = ${share.toFixed(1)}% من إيراد المتجر`, en: `Ads = ${share.toFixed(1)}% of store revenue` },
      detail: {
        ar: `صرفت ${money(agg.spend)} مقابل إيراد إجمالي ${money(storeRevenue)} (MER ${(storeRevenue / agg.spend).toFixed(2)}x).`,
        en: `Spent ${money(agg.spend)} against ${money(storeRevenue)} total revenue (MER ${(storeRevenue / agg.spend).toFixed(2)}x).`,
      },
      action: {
        ar: "ده الرقم اللي مايتغشّش — لو الـ MER بيقل والإنفاق بيزيد، التوسع بقى بيأكل الربح.",
        en: "This is the number that can't be gamed — if MER falls while spend rises, scaling is eating the profit.",
      },
    });
  }

  // 6. is creative or targeting the account-wide bottleneck?
  if (agg.ctr !== null && agg.ctr < bench.ctr * 0.9 && agg.clicks > 500) {
    out.push({
      code: "account_ctr",
      severity: "amber",
      value: agg.ctr,
      title: { ar: "متوسط النقر للحساب منخفض", en: "Account-wide CTR is low" },
      detail: {
        ar: `${pct(agg.ctr)} على ${Math.round(agg.impressions).toLocaleString("en-EG")} ظهور.`,
        en: `${pct(agg.ctr)} across ${Math.round(agg.impressions).toLocaleString("en-EG")} impressions.`,
      },
      action: {
        ar: "المشكلة إبداعية مش ميزانية — اطلب 8-12 فكرة مختلفة الشهر الجاي بدل تعديلات صغيرة.",
        en: "This is a creative problem, not a budget one — brief 8-12 distinct concepts next month instead of small edits.",
      },
    });
  }

  return out;
}

export const VERDICT_META: Record<Verdict, { label: Bi; className: string }> = {
  scale: { label: { ar: "وسّع", en: "Scale" }, className: "bg-emerald-100 text-emerald-700" },
  keep: { label: { ar: "استمر", en: "Keep" }, className: "bg-teal-100 text-teal-700" },
  watch: { label: { ar: "راقب", en: "Watch" }, className: "bg-slate-100 text-slate-600" },
  fix: { label: { ar: "صلّح", en: "Fix" }, className: "bg-amber-100 text-amber-700" },
  kill: { label: { ar: "اقفل", en: "Kill" }, className: "bg-red-100 text-red-700" },
  no_data: { label: { ar: "بيانات قليلة", en: "Low data" }, className: "bg-slate-100 text-slate-500" },
  unmapped: { label: { ar: "غير مربوط", en: "Unmapped" }, className: "bg-violet-100 text-violet-700" },
};

export const BOTTLENECK_LABEL: Record<string, Bi> = {
  creative: { ar: "الإبداع", en: "Creative" },
  landing: { ar: "الوصول للصفحة", en: "Landing" },
  product_page: { ar: "صفحة المنتج", en: "Product page" },
  cart: { ar: "السلة", en: "Cart" },
  checkout: { ar: "الدفع", en: "Checkout" },
};
