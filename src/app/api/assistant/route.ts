import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api-auth";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 30;

interface Answer {
  answer: { ar: string; en: string };
  table?: { columns: string[]; rows: (string | number)[][] };
  link?: string;
}

const money = (n: number) => `${new Intl.NumberFormat("en-EG", { maximumFractionDigits: 0 }).format(n || 0)}`;
const num = (n: number) => new Intl.NumberFormat("en-EG", { maximumFractionDigits: 1 }).format(n || 0);

function detectPeriod(q: string): { from: string | null; to: string | null; label: { ar: string; en: string } } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString();
  const end = iso(new Date(now.getTime() + 86400000));
  if (/today|النهارده|اليوم/i.test(q))
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate())), to: end, label: { ar: "اليوم", en: "today" } };
  if (/this month|هذا الشهر|الشهر ?ده|الشهر الحالي/i.test(q))
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: end, label: { ar: "هذا الشهر", en: "this month" } };
  if (/last month|الشهر الماضي|الشهر اللي فات/i.test(q))
    return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 1)), label: { ar: "الشهر الماضي", en: "last month" } };
  if (/7|week|أسبوع|اسبوع/i.test(q))
    return { from: iso(new Date(now.getTime() - 7 * 86400000)), to: end, label: { ar: "آخر 7 أيام", en: "last 7 days" } };
  if (/90|quarter|ربع/i.test(q))
    return { from: iso(new Date(now.getTime() - 90 * 86400000)), to: end, label: { ar: "آخر 90 يوم", en: "last 90 days" } };
  if (/all|كل|إجمالي|اجمالي/i.test(q))
    return { from: null, to: null, label: { ar: "كل الفترات", en: "all time" } };
  return { from: iso(new Date(now.getTime() - 30 * 86400000)), to: end, label: { ar: "آخر 30 يوم", en: "last 30 days" } };
}

async function answerQuestion(q: string, db: SupabaseClient): Promise<Answer> {
  const lower = q.toLowerCase();
  const period = detectPeriod(lower);
  const params = { p_from: period.from, p_to: period.to };

  // Stock / reorder
  if (/stock|reorder|restock|مخزون|تجهيز|ينفد|نفاد|أعد الطلب/i.test(q)) {
    const { data } = await db.rpc("fn_reorder_suggestions", { p_period_days: 30, p_cover_days: 30, p_min_units: 3 });
    const rows = ((data as Record<string, unknown>[]) ?? []).filter((r) => ["urgent", "high", "rising"].includes(r.priority as string)).slice(0, 10);
    return {
      answer: {
        ar: `أهم ${rows.length} كتاب يحتاج تجهيز مخزون بناءً على سرعة البيع آخر 30 يوم:`,
        en: `Top ${rows.length} books needing restock based on the last 30 days of sales velocity:`,
      },
      table: {
        columns: ["Book", "SKU", "Units/30d", "Suggested", "Priority"],
        rows: rows.map((r) => [String(r.product_name).slice(0, 40), r.sku as string, r.units_recent as number, num(r.suggested_reorder as number), r.priority as string]),
      },
      link: "/stock",
    };
  }

  // Ads / ROAS
  if (/ads?|roas|advertis|إعلان|اعلان|تسويق مدفوع/i.test(q)) {
    const { data } = await db.rpc("fn_ads_performance", { p_from: null, p_to: null, p_batch: null });
    const list = (data as Record<string, unknown>[]) ?? [];
    if (!list.length) return { answer: { ar: "لا توجد بيانات إعلانات بعد — استورد تقرير الإعلانات من صفحة الإعلانات.", en: "No ads data yet — import an ads report from the Ads page." }, link: "/ads" };
    const spend = list.reduce((s, r) => s + ((r.spend as number) ?? 0), 0);
    const actual = list.reduce((s, r) => s + ((r.actual_revenue as number) ?? 0), 0);
    const top = [...list].sort((a, b) => ((b.actual_roas as number) ?? 0) - ((a.actual_roas as number) ?? 0)).slice(0, 8);
    return {
      answer: {
        ar: `إجمالي الإنفاق ${money(spend)} ج.م حقّق إيراد فعلي ${money(actual)} ج.م (ROAS فعلي ${(spend ? actual / spend : 0).toFixed(2)}x). أفضل الإعلانات بالعائد الفعلي:`,
        en: `Total spend ${money(spend)} EGP produced ${money(actual)} EGP actual revenue (actual ROAS ${(spend ? actual / spend : 0).toFixed(2)}x). Best ads by real ROAS:`,
      },
      table: {
        columns: ["Ad", "Spend", "Actual Rev", "Actual ROAS", "CR%"],
        rows: top.map((r) => [String(r.ad_name ?? "").slice(0, 30), money(r.spend as number), money(r.actual_revenue as number), r.actual_roas != null ? `${r.actual_roas}x` : "—", r.actual_cr != null ? `${r.actual_cr}%` : "—"]),
      },
      link: "/ads",
    };
  }

  // Targets
  if (/target|goal|هدف|أهداف|تارجت/i.test(q)) {
    const { data } = await db.rpc("fn_targets_overview");
    const list = (data as Record<string, unknown>[]) ?? [];
    const now = new Date();
    const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const cur = list.find((r) => String(r.period_month).startsWith(curKey)) ?? list.filter((r) => (r.actual_revenue as number) > 0).slice(-1)[0];
    if (!cur) return { answer: { ar: "لا توجد أهداف محددة.", en: "No targets set." }, link: "/targets" };
    const remaining = Math.max((cur.total_target as number) - (cur.actual_revenue as number), 0);
    const orders = Math.ceil(remaining / ((cur.aov as number) || 550));
    return {
      answer: {
        ar: `هدف ${cur.label}: ${money(cur.total_target as number)} ج.م. المحقق ${money(cur.actual_revenue as number)} ج.م (${cur.progress_pct}%). المتبقي ${money(remaining)} ج.م ≈ ${num(orders)} طلب. افتح صفحة الأهداف لخطوات التحقيق التفصيلية.`,
        en: `Target ${cur.label}: ${money(cur.total_target as number)} EGP. Achieved ${money(cur.actual_revenue as number)} EGP (${cur.progress_pct}%). Remaining ${money(remaining)} EGP ≈ ${num(orders)} orders. Open Targets for full steps.`,
      },
      link: "/targets",
    };
  }

  // Website traffic / tracking health (GA4 API sync)
  if (/traffic|session|visitor|زيارات|زوار|جلسات|تتبع|tracking|ga4/i.test(q)) {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const { data } = await db.rpc("fn_tracking_daily", { p_from: from, p_to: to });
    const days = (data as { day: string; sessions: number; ga4_purchases: number; orders: number }[]) ?? [];
    const sessions = days.reduce((s, r) => s + Number(r.sessions || 0), 0);
    if (!sessions) return { answer: { ar: "لا توجد بيانات زيارات بعد — اضغط \"مزامنة من GA4\" في صفحة الزيارات.", en: "No traffic data yet — press 'Sync from GA4' on the Traffic page." }, link: "/traffic" };
    const ga4P = days.reduce((s, r) => s + Number(r.ga4_purchases || 0), 0);
    const orders = days.reduce((s, r) => s + Number(r.orders || 0), 0);
    const rate = orders > 0 ? ((ga4P / orders) * 100).toFixed(1) : "—";
    const cr = sessions > 0 ? ((orders / sessions) * 100).toFixed(2) : "—";
    return {
      answer: {
        ar: `آخر 30 يوم: ${num(sessions)} جلسة على الموقع حققت ${num(orders)} طلب فعلي (معدل تحويل ${cr}%). GA4 تتبّع ${num(ga4P)} عملية شراء — نسبة التتبع ${rate}%.`,
        en: `Last 30 days: ${num(sessions)} website sessions produced ${num(orders)} actual orders (CR ${cr}%). GA4 tracked ${num(ga4P)} purchases — tracking rate ${rate}%.`,
      },
      table: {
        columns: ["Day", "Sessions", "GA4 Purchases", "Orders"],
        rows: days.slice(-7).map((r) => [r.day, num(Number(r.sessions)), num(Number(r.ga4_purchases)), num(Number(r.orders))]),
      },
      link: "/traffic",
    };
  }

  // Traffic channels / campaigns ROI (GA4 attribution + Meta spend)
  if (/channel|قناة|قنوات|مصدر|traffic source|فيسبوك ولا|أفضل حملة|افضل حملة/i.test(q)) {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const { data } = await db.rpc("fn_channel_summary", { p_from: from, p_to: to });
    const d = (data ?? {}) as { channels?: Record<string, unknown>[]; campaigns?: Record<string, unknown>[] };
    const channels = (d.channels ?? []).slice(0, 8);
    if (!channels.length) return { answer: { ar: "لا توجد بيانات قنوات بعد — اضغط \"مزامنة من GA4\" في صفحة الزيارات.", en: "No channel data yet — press 'Sync from GA4' on the Traffic page." }, link: "/traffic" };
    return {
      answer: {
        ar: "أداء قنوات الزيارات آخر 30 يوم (الطلبات الفعلية مطابقة برقم المعاملة):",
        en: "Traffic channel performance, last 30 days (actual orders matched by transaction id):",
      },
      table: {
        columns: ["Channel", "Sessions", "Actual Orders", "Delivered", "Revenue"],
        rows: channels.map((c) => [
          `${c.source}/${c.medium}`,
          num(c.sessions as number),
          num(c.orders as number),
          num(c.delivered as number),
          money(c.order_revenue as number),
        ]),
      },
      link: "/traffic",
    };
  }

  // Google SEO (Search Console)
  if (/seo|بحث جوجل|جوجل|google search|ترتيب|ranking/i.test(q)) {
    const { data: latest } = await db.from("gsc_queries").select("period_month").order("period_month", { ascending: false }).limit(1);
    const m = (latest as { period_month: string }[] | null)?.[0]?.period_month;
    if (!m) return { answer: { ar: "Search Console غير مفعّل بعد — أضف رابط الموقع في الإعدادات ثم اضغط مزامنة.", en: "Search Console isn't connected yet — add the property URL in Settings, then Sync." }, link: "/settings" };
    const { data: rows } = await db.from("gsc_queries").select("query, clicks, impressions, position").eq("period_month", m).order("clicks", { ascending: false }).limit(10);
    const list = (rows as { query: string; clicks: number; impressions: number; position: number }[]) ?? [];
    return {
      answer: {
        ar: "أعلى كلمات البحث في جوجل التي تجلب زيارات للموقع (آخر شهر مُزامن):",
        en: "Top Google search queries bringing visits (latest synced month):",
      },
      table: {
        columns: ["Query", "Clicks", "Impressions", "Position"],
        rows: list.map((r) => [r.query, num(r.clicks), num(r.impressions), Number(r.position).toFixed(1)]),
      },
      link: "/traffic",
    };
  }

  // What visitors search for inside the store (GA4 site search)
  if (/site search|search terms|يبحث|بيدوروا|بحث الموقع|بيدور/i.test(q)) {
    const { data: latest } = await db.from("ga4_search_terms").select("period_month").order("period_month", { ascending: false }).limit(1);
    const m = (latest as { period_month: string }[] | null)?.[0]?.period_month;
    if (!m) return { answer: { ar: "لا توجد بيانات بحث الموقع بعد — اضغط \"مزامنة من GA4\".", en: "No site-search data yet — press 'Sync from GA4'." }, link: "/traffic" };
    const { data: rows } = await db.from("ga4_search_terms").select("term, searches, sessions").eq("period_month", m).order("searches", { ascending: false }).limit(10);
    const list = (rows as { term: string; searches: number; sessions: number }[]) ?? [];
    return {
      answer: {
        ar: "أكثر ما يبحث عنه الزوار داخل المتجر (آخر شهر مُزامن) — الكلمات غير المتوفرة في الكتالوج فرص توريد:",
        en: "What visitors search for inside the store (latest synced month) — unmatched terms are sourcing opportunities:",
      },
      table: {
        columns: ["Term", "Searches", "Sessions"],
        rows: list.map((r) => [r.term, num(r.searches), num(r.sessions)]),
      },
      link: "/traffic",
    };
  }

  // Who bought a specific book (purchasers)
  const buyMatch = q.match(/(?:who bought|buyers of|purchasers of|مين اشترى|مشتري|مشترين)\s+(.+)/i);
  if (buyMatch) {
    const keyword = buyMatch[1].replace(/[?؟."']/g, "").trim();
    const { data } = await db.rpc("fn_sku_purchasers", { p_sku: null, p_keyword: keyword, p_from: null, p_to: null, p_limit: 5000 });
    const list = (data as Record<string, unknown>[]) ?? [];
    return {
      answer: {
        ar: `عدد ${list.length} طلب يحتوي على "${keyword}". افتح صفحة المنتجات لتصدير قائمة المشترين كاملة (CSV).`,
        en: `${list.length} orders contain "${keyword}". Open the Products page to export the full buyer list (CSV).`,
      },
      table: {
        columns: ["Order", "Customer", "Phone", "City", "Units"],
        rows: list.slice(0, 10).map((r) => [r.order_number as string, (r.customer_name as string) ?? "—", (r.customer_phone as string) ?? "—", (r.city as string) ?? "—", r.units as number]),
      },
      link: "/products",
    };
  }

  // Top products / books
  if (/top|best ?sell|most sold|أفضل|اعلى|أعلى|الأكثر|احسن|كتب مبيع/i.test(q)) {
    const { data } = await db.rpc("fn_product_stats", { ...params, p_search: null, p_limit: 10 });
    const list = (data as Record<string, unknown>[]) ?? [];
    return {
      answer: {
        ar: `أعلى ${list.length} كتاب مبيعاً (${period.label.ar}):`,
        en: `Top ${list.length} best-selling books (${period.label.en}):`,
      },
      table: {
        columns: ["Book", "SKU", "Units", "Revenue"],
        rows: list.map((r) => [String(r.product_name).slice(0, 40), r.sku as string, r.units as number, money(r.revenue as number)]),
      },
      link: "/products",
    };
  }

  // Cities
  if (/city|cities|governorate|محافظ|مدين|مناطق/i.test(q)) {
    const { data } = await db.rpc("fn_breakdown", { p_dim: "city", ...params, p_limit: 10 });
    const list = (data as Record<string, unknown>[]) ?? [];
    return {
      answer: { ar: `أعلى المحافظات (${period.label.ar}):`, en: `Top cities (${period.label.en}):` },
      table: {
        columns: ["City", "Orders", "Revenue"],
        rows: list.map((r) => [r.label as string, r.orders as number, money(r.revenue as number)]),
      },
      link: "/analytics",
    };
  }

  // Customers / segments
  if (/customer|segment|rfm|عملاء|عميل|شريحة|شرايح/i.test(q)) {
    const { data } = await db.rpc("fn_rfm_summary");
    const list = (data as Record<string, unknown>[]) ?? [];
    return {
      answer: { ar: "شرائح العملاء (RFM):", en: "Customer segments (RFM):" },
      table: {
        columns: ["Segment", "Customers", "Revenue"],
        rows: list.map((r) => [r.segment as string, r.customers as number, money(r.total_revenue as number)]),
      },
      link: "/customers",
    };
  }

  // Revenue / sales / KPIs (default for money questions)
  if (/revenue|sales|orders|kpi|how many|how much|مبيع|إيراد|ايراد|طلبات|فلوس|كام|عدد/i.test(q)) {
    const { data } = await db.rpc("fn_kpis", params);
    const k = (data as Record<string, number>) ?? {};
    return {
      answer: {
        ar: `${period.label.ar}: ${num(k.total_orders)} طلب بإجمالي ${money(k.gross_revenue)} ج.م. تم توصيل ${num(k.delivered_orders)}، ملغي ${num(k.cancelled_orders)}. متوسط الطلب ${money(k.avg_order_value)} ج.م، وعدد العملاء ${num(k.unique_customers)}.`,
        en: `${period.label.en}: ${num(k.total_orders)} orders totalling ${money(k.gross_revenue)} EGP. Delivered ${num(k.delivered_orders)}, cancelled ${num(k.cancelled_orders)}. Avg order ${money(k.avg_order_value)} EGP, ${num(k.unique_customers)} customers.`,
      },
      link: "/",
    };
  }

  // Fallback
  return {
    answer: {
      ar: "أقدر أساعدك في: المبيعات والإيراد، أعلى الكتب مبيعاً، الكتب اللي محتاجة مخزون، أداء الإعلانات (ROAS الفعلي)، زيارات الموقع وقنوات الزيارات، بحث جوجل (SEO)، ما يبحث عنه الزوار داخل المتجر، تقدم الأهداف، شرائح العملاء، ومين اشترى كتاب معين. اسألني بأي صيغة.",
      en: "I can help with: sales & revenue, top-selling books, books needing stock, ad performance (actual ROAS), website traffic & channels, Google SEO, what visitors search for in the store, target progress, customer segments, and who bought a specific book. Ask me anything.",
    },
  };
}

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { question, lang } = await request.json();
  if (!question || typeof question !== "string") {
    return NextResponse.json({ error: "No question" }, { status: 400 });
  }

  const result = await answerQuestion(question, user.supabase);

  // AI-ready: if an Anthropic key is configured (Settings → AI card, or the
  // ANTHROPIC_API_KEY env var), use Claude to rephrase the grounded answer
  // more naturally. Falls back silently to the built-in text.
  let apiKey = process.env.ANTHROPIC_API_KEY;
  try {
    const { data: cfg } = await user.supabase.rpc("fn_marketing_config");
    const dbKey = (cfg as { ai?: { anthropic_api_key?: string } } | null)?.ai?.anthropic_api_key;
    if (dbKey) apiKey = dbKey;
  } catch {
    // config fn not deployed yet or viewer role — env fallback stands
  }
  if (apiKey) {
    try {
      const context = JSON.stringify(result);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 400,
          system: `You are the Misr Hub bookstore assistant. Answer ONLY from the provided data JSON. Reply in ${lang === "en" ? "English" : "Arabic"}, concise and friendly. Never invent numbers.`,
          messages: [{ role: "user", content: `Question: ${question}\n\nData: ${context}` }],
        }),
      });
      if (res.ok) {
        const j = await res.json();
        const text = j.content?.[0]?.text;
        if (text) {
          return NextResponse.json({ ...result, answer: { ar: text, en: text }, ai: true });
        }
      }
    } catch {
      // fall through to built-in answer
    }
  }

  return NextResponse.json(result);
}
