/** How an ad is connected to what it sells. `link` only survives when the URL
 *  didn't resolve to a known list — once it does, the RPC stores it as `list`. */
export type TargetKind = "book" | "list" | "link";

// Shape returned by fn_ads_insights — one row per Meta report line.
// Only `level === "ad"` rows may be summed: Meta restates the same spend at
// campaign and ad-set level, so mixing levels triples every total.
export interface AdRow {
  id: string;
  import_id: string;
  account_label: string;
  level: "campaign" | "adset" | "ad";
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  period_start: string;
  period_end: string;
  period_key: string;
  days: number;
  delivery_status: string | null;

  reach: number | null;
  impressions: number | null;
  frequency: number | null;
  spend: number | null;
  cpm: number | null;
  link_clicks: number | null;
  ctr_all: number | null;
  landing_page_views: number | null;
  adds_to_cart: number | null;
  checkouts_initiated: number | null;
  purchases: number | null;
  conversion_value: number | null;
  cost_per_purchase: number | null;
  results_roas: number | null;

  cpc: number | null;
  lp_rate: number | null;
  atc_rate: number | null;
  ic_rate: number | null;
  purchase_rate: number | null;
  cvr: number | null;
  cost_per_lpv: number | null;
  cost_per_atc: number | null;
  cost_per_ic: number | null;
  reported_roas: number | null;
  daily_spend: number | null;

  book_label: string | null;
  book_skus: string[] | null;
  map_source: "ad" | "campaign" | null;

  // what this ad is connected to: a custom list, hand-picked SKUs, or a link
  target_kind: TargetKind | null;
  list_key: string | null;
  list_name: string | null;
  list_slug: string | null;
  list_items: number | null;
  dest_url: string | null;

  book_orders: number | null;
  book_units: number | null;
  book_revenue: number | null;
  book_net_revenue: number | null;
  book_delivered_revenue: number | null;
  book_cancelled_orders: number | null;
  book_buyers: number | null;
  book_stock: number | null;
  book_avg_price: number | null;

  spend_share: number | null;
  att_orders: number | null;
  att_units: number | null;
  att_revenue: number | null;
  att_net_revenue: number | null;
  att_cancelled_orders: number | null;
  actual_roas: number | null;
  net_roas: number | null;
  actual_cpa: number | null;
  cancel_rate: number | null;
}

export interface AdPeriod {
  import_id: string;
  account_label: string;
  period_start: string;
  period_end: string;
  period_key: string;
  period_label: string;
  days: number;
  row_count: number;
  ad_rows: number;
  spend: number;
  reported_purchases: number;
  reported_value: number;
  file_name: string | null;
  imported_at: string;
  imported_by_email: string | null;
}

export interface AdMapping {
  id: string;
  match_level: "ad" | "campaign";
  pattern: string;
  raw_name: string | null;
  book_label: string;
  skus: string[] | null;
  keyword: string | null;
  is_auto: boolean;
  active: boolean;
  updated_at: string;
  target_kind: TargetKind;
  list_key: string | null;
  list_name: string | null;
  list_slug: string | null;
  list_items: number;
  dest_url: string | null;
  ad_count: number;
  spend: number;
}

/** fn_custom_lists_overview — one row per custom list: what it holds, what it
 *  cost, and what its books really sold in the window. */
export interface CustomListRow {
  id: string;
  list_id: number | null;
  slug: string | null;
  name: string;
  note: string | null;
  item_count: number;
  known_items: number;
  /** books still sellable — the number that decides whether an ad can run */
  in_stock: number;
  out_of_stock: number;
  unknown_items: number;
  stock_units: number;
  ads: number;
  campaigns: string[] | null;
  accounts: string[] | null;
  spend: number;
  meta_purchases: number;
  meta_value: number;
  page_views: number | null;
  page_atc: number | null;
  page_revenue: number | null;
  orders: number;
  units: number;
  revenue: number;
  net_revenue: number;
  cancelled_orders: number;
  buyers: number;
  roas: number | null;
  cpa: number | null;
  cancel_rate: number | null;
  stock_health: StockHealth;
  file_name: string | null;
  updated_at: string;
}

/** Whether a list still has enough in stock for its ads to keep running.
 *  Depletion-based, not size-based: 2-of-2 available is fine, 2-of-40 is not. */
export type StockHealth = "ok" | "thin" | "last_book" | "empty" | "unknown";

/** fn_custom_list_items — the books inside one list. */
export interface CustomListItemRow {
  sku: string;
  product_name: string | null;
  sort_order: number | null;
  in_catalog: boolean;
  ecom_stock: number | null;
  price: number | null;
  orders: number;
  units: number;
  revenue: number;
}

/** fn_ads_link_resolve — what a pasted URL turned out to be. */
export interface LinkResolved {
  url: string;
  kind: "list" | "product" | "unknown";
  ref: string | null;
  list_key: string | null;
  list_name: string | null;
  list_id: number | null;
  list_items: number | null;
  sku: string | null;
  product_name: string | null;
}

export interface AdSettings {
  gross_margin_pct: number;
  target_roas: number;
  min_spend: number;
  frequency_cap: number;
}

export const DEFAULT_AD_SETTINGS: AdSettings = {
  gross_margin_pct: 35,
  target_roas: 3,
  min_spend: 300,
  frequency_cap: 3.5,
};

// ------------------------------------------------------------ aggregation

/** Sums that are safe to add across ad rows. Rate columns are recomputed from
 *  the totals rather than averaged — averaging rates weights a 10-EGP ad the
 *  same as a 10,000-EGP one. */
export interface AdTotals {
  count: number;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  lpv: number;
  atc: number;
  ic: number;
  metaPurchases: number;
  metaValue: number;
  attOrders: number;
  attUnits: number;
  attRevenue: number;
  attNetRevenue: number;
  attCancelled: number;
  // derived
  cpm: number | null;
  ctr: number | null;
  cpc: number | null;
  lpRate: number | null;
  atcRate: number | null;
  icRate: number | null;
  purchaseRate: number | null;
  cvr: number | null;
  metaRoas: number | null;
  actualRoas: number | null;
  netRoas: number | null;
  cpa: number | null;
  costPerAtc: number | null;
}

const n = (v: number | null | undefined) => v ?? 0;
const rate = (a: number, b: number) => (b > 0 ? (a * 100) / b : null);
const div = (a: number, b: number) => (b > 0 ? a / b : null);

export function totals(rows: AdRow[]): AdTotals {
  const t = {
    count: rows.length,
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    lpv: 0,
    atc: 0,
    ic: 0,
    metaPurchases: 0,
    metaValue: 0,
    attOrders: 0,
    attUnits: 0,
    attRevenue: 0,
    attNetRevenue: 0,
    attCancelled: 0,
  };
  for (const r of rows) {
    t.spend += n(r.spend);
    t.impressions += n(r.impressions);
    t.reach += n(r.reach);
    t.clicks += n(r.link_clicks);
    t.lpv += n(r.landing_page_views);
    t.atc += n(r.adds_to_cart);
    t.ic += n(r.checkouts_initiated);
    t.metaPurchases += n(r.purchases);
    t.metaValue += n(r.conversion_value);
    t.attOrders += n(r.att_orders);
    t.attUnits += n(r.att_units);
    t.attRevenue += n(r.att_revenue);
    t.attNetRevenue += n(r.att_net_revenue);
    t.attCancelled += n(r.att_cancelled_orders);
  }
  return {
    ...t,
    cpm: t.impressions > 0 ? (t.spend * 1000) / t.impressions : null,
    ctr: rate(t.clicks, t.impressions),
    cpc: div(t.spend, t.clicks),
    lpRate: rate(t.lpv, t.clicks),
    atcRate: rate(t.atc, t.lpv),
    icRate: rate(t.ic, t.atc),
    purchaseRate: rate(t.metaPurchases, t.ic),
    cvr: rate(t.metaPurchases, t.clicks),
    metaRoas: div(t.metaValue, t.spend),
    actualRoas: div(t.attRevenue, t.spend),
    netRoas: div(t.attNetRevenue, t.spend),
    cpa: div(t.spend, t.attOrders),
    costPerAtc: div(t.spend, t.atc),
  };
}

/** Group ad rows by any key and total each group. */
export function groupBy<K extends string>(rows: AdRow[], key: (r: AdRow) => K | null) {
  const map = new Map<K, AdRow[]>();
  for (const r of rows) {
    const k = key(r);
    if (k === null) continue;
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  return Array.from(map.entries()).map(([k, list]) => ({ key: k, rows: list, ...totals(list) }));
}
