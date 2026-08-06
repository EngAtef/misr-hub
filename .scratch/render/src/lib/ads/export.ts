import * as XLSX from "xlsx";
import type { Lang } from "../../lib/i18n";
import type { AdRow, AdSettings } from "./types";
import { totals, groupBy } from "./types";
import { diagnose, computeBenchmarks, breakevenRoas, VERDICT_META, BOTTLENECK_LABEL, type Benchmarks } from "./diagnose";

type Cell = string | number | null;

const r2 = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);

/** CSV-injection guard: the app's toCsv does this for CSV, and the same
 *  rule has to hold for xlsx cells that start with a formula character. */
function safe(v: Cell): Cell {
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(v)) return `'${v}`;
  return v;
}

function sheet(rows: Record<string, Cell>[]): XLSX.WorkSheet {
  const clean = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safe(v)])));
  return XLSX.utils.json_to_sheet(clean);
}

export function adRowsForExport(rows: AdRow[], settings: AdSettings, bench: Benchmarks, lang: Lang) {
  return rows
    .filter((r) => r.level === "ad")
    .map((r) => {
      const d = diagnose(r, { settings, bench });
      return {
        account: r.account_label,
        period: `${r.period_start} → ${r.period_end}`,
        campaign: r.campaign_name,
        ad_set: r.adset_name,
        ad: r.ad_name,
        book: r.book_label,
        delivery_status: r.delivery_status,
        spend: r2(r.spend),
        daily_spend: r2(r.daily_spend),
        impressions: r.impressions,
        reach: r.reach,
        frequency: r2(r.frequency),
        cpm: r2(r.cpm),
        link_clicks: r.link_clicks,
        ctr_pct: r2(r.ctr_all),
        cpc: r2(r.cpc),
        landing_page_views: r.landing_page_views,
        landing_rate_pct: r2(r.lp_rate),
        adds_to_cart: r.adds_to_cart,
        atc_rate_pct: r2(r.atc_rate),
        checkouts: r.checkouts_initiated,
        checkout_rate_pct: r2(r.ic_rate),
        meta_purchases: r.purchases,
        meta_purchase_rate_pct: r2(r.purchase_rate),
        meta_value: r2(r.conversion_value),
        meta_roas: r2(r.reported_roas),
        book_orders: r.book_orders,
        book_revenue: r2(r.book_revenue),
        ad_share_pct: r2((r.spend_share ?? 0) * 100),
        attributed_orders: r2(r.att_orders),
        attributed_revenue: r2(r.att_revenue),
        actual_roas: r2(r.actual_roas),
        net_roas: r2(r.net_roas),
        real_cost_per_order: r2(r.actual_cpa),
        cancel_rate_pct: r2(r.cancel_rate),
        stock: r.book_stock,
        verdict: VERDICT_META[d.verdict].label[lang],
        score: d.score,
        bottleneck: d.bottleneck ? BOTTLENECK_LABEL[d.bottleneck]?.[lang] ?? d.bottleneck : null,
        why: d.reasons.map((x) => x.title[lang]).join(" | "),
        what_to_do: d.reasons.map((x) => x.action[lang]).join(" | "),
      };
    });
}

function totalsRow(label: string, list: AdRow[]) {
  const t = totals(list);
  return {
    name: label,
    ads: t.count,
    spend: r2(t.spend),
    impressions: t.impressions,
    clicks: t.clicks,
    ctr_pct: r2(t.ctr),
    cpm: r2(t.cpm),
    cpc: r2(t.cpc),
    landing_page_views: t.lpv,
    adds_to_cart: t.atc,
    checkouts: t.ic,
    meta_purchases: t.metaPurchases,
    meta_value: r2(t.metaValue),
    meta_roas: r2(t.metaRoas),
    attributed_orders: r2(t.attOrders),
    attributed_revenue: r2(t.attRevenue),
    actual_roas: r2(t.actualRoas),
    net_roas: r2(t.netRoas),
    real_cost_per_order: r2(t.cpa),
  };
}

/**
 * One workbook with every view the page shows — the thing to send to a media
 * buyer or keep as the month's record.
 */
export function buildAdsWorkbook(
  rows: AdRow[],
  settings: AdSettings,
  lang: Lang,
  blended: Record<string, number | null> | null
): XLSX.WorkBook {
  const ads = rows.filter((r) => r.level === "ad");
  const bench = computeBenchmarks(rows);
  const t = totals(ads);
  const be = breakevenRoas(settings);

  const wb = XLSX.utils.book_new();

  // 1. summary
  const summary: Record<string, Cell>[] = [
    { metric: "Spend", value: r2(t.spend) },
    { metric: "Impressions", value: t.impressions },
    { metric: "Link clicks", value: t.clicks },
    { metric: "CTR %", value: r2(t.ctr) },
    { metric: "CPM", value: r2(t.cpm) },
    { metric: "CPC", value: r2(t.cpc) },
    { metric: "Landing page views", value: t.lpv },
    { metric: "Adds to cart", value: t.atc },
    { metric: "Checkouts started", value: t.ic },
    { metric: "Meta purchases (claimed)", value: t.metaPurchases },
    { metric: "Meta value (claimed)", value: r2(t.metaValue) },
    { metric: "Meta ROAS (claimed)", value: r2(t.metaRoas) },
    { metric: "Attributed orders (real)", value: r2(t.attOrders) },
    { metric: "Attributed revenue (real)", value: r2(t.attRevenue) },
    { metric: "Actual ROAS", value: r2(t.actualRoas) },
    { metric: "Net ROAS (after returns)", value: r2(t.netRoas) },
    { metric: "Real cost per order", value: r2(t.cpa) },
    { metric: "Break-even ROAS", value: r2(be) },
    { metric: "Target ROAS", value: settings.target_roas },
    { metric: "Gross margin %", value: settings.gross_margin_pct },
  ];
  if (blended) {
    summary.push(
      { metric: "Store revenue (all channels)", value: r2(blended.store_revenue ?? null) },
      { metric: "Store orders", value: blended.store_orders ?? null },
      { metric: "MER (store revenue ÷ spend)", value: r2(blended.mer ?? null) },
      { metric: "Blended CAC", value: r2(blended.cac ?? null) },
      { metric: "Spend as % of revenue", value: r2(blended.spend_share_of_revenue ?? null) }
    );
  }
  XLSX.utils.book_append_sheet(wb, sheet(summary), "Summary");

  // 2. every ad, with the verdict and the reasoning
  XLSX.utils.book_append_sheet(wb, sheet(adRowsForExport(rows, settings, bench, lang) as Record<string, Cell>[]), "Ads");

  // 3-5. rollups
  const byCampaign = groupBy(ads, (r) => r.campaign_name ?? "—").map((g) => totalsRow(g.key, g.rows));
  XLSX.utils.book_append_sheet(wb, sheet(byCampaign as Record<string, Cell>[]), "Campaigns");

  const byAdset = groupBy(ads, (r) => `${r.campaign_name ?? "—"} / ${r.adset_name ?? "—"}`).map((g) => totalsRow(g.key, g.rows));
  XLSX.utils.book_append_sheet(wb, sheet(byAdset as Record<string, Cell>[]), "Ad sets");

  const byBook = groupBy(ads, (r) => r.book_label).map((g) => {
    // a book's real sales are shared by all of its ads inside one period, so
    // take them once per period — never once per ad
    const perPeriod = new Map<string, AdRow>();
    for (const r of g.rows) if (!perPeriod.has(r.period_key)) perPeriod.set(r.period_key, r);
    const demand = Array.from(perPeriod.values());
    const orders = demand.reduce((s, r) => s + (r.book_orders ?? 0), 0);
    const cancelled = demand.reduce((s, r) => s + (r.book_cancelled_orders ?? 0), 0);
    return {
      ...totalsRow(g.key, g.rows),
      book_orders_in_period: orders,
      book_revenue_in_period: r2(demand.reduce((s, r) => s + (r.book_revenue ?? 0), 0)),
      cancel_rate_pct: orders + cancelled > 0 ? r2((cancelled * 100) / (orders + cancelled)) : null,
      stock: demand[0]?.book_stock ?? null,
    };
  });
  XLSX.utils.book_append_sheet(wb, sheet(byBook as Record<string, Cell>[]), "Books");

  // 6. period-over-period
  const byPeriod = groupBy(ads, (r) => r.period_key).map((g) => ({
    ...totalsRow(g.key.replace("_", " → "), g.rows),
    accounts: Array.from(new Set(g.rows.map((r) => r.account_label))).join(", "),
  }));
  XLSX.utils.book_append_sheet(wb, sheet(byPeriod as Record<string, Cell>[]), "Periods");

  // 7. the action list — only ads that need a decision
  const actions = ads
    .map((r) => ({ r, d: diagnose(r, { settings, bench }) }))
    .filter(({ d }) => d.verdict === "kill" || d.verdict === "fix" || d.verdict === "scale")
    .sort((a, b) => (b.r.spend ?? 0) - (a.r.spend ?? 0))
    .map(({ r, d }) => ({
      priority: d.verdict === "kill" ? 1 : d.verdict === "scale" ? 2 : 3,
      verdict: VERDICT_META[d.verdict].label[lang],
      ad: r.ad_name,
      campaign: r.campaign_name,
      book: r.book_label,
      spend: r2(r.spend),
      actual_roas: r2(r.actual_roas),
      bottleneck: d.bottleneck ? BOTTLENECK_LABEL[d.bottleneck]?.[lang] ?? d.bottleneck : null,
      why: d.reasons.map((x) => `${x.title[lang]}: ${x.detail[lang]}`).join(" | "),
      what_to_do: d.reasons.map((x) => x.action[lang]).join(" | "),
    }));
  XLSX.utils.book_append_sheet(wb, sheet(actions as Record<string, Cell>[]), "Action list");

  return wb;
}

export function downloadWorkbook(wb: XLSX.WorkBook, fileName: string) {
  XLSX.writeFile(wb, fileName, { compression: true });
}
