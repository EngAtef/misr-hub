import * as XLSX from "xlsx";

/**
 * Meta Ads Manager "Export" workbooks.
 *
 * Every export has two sheets — "Formatted Report" (pretty, values rounded to
 * 2dp, and the campaign/ad-set columns are blanked on repeat rows) and
 * "Raw Data Report" (full precision, every row fully qualified). We always
 * prefer the raw sheet.
 *
 * Neither sheet starts at A1: rows 1-2 are the report title and a blank
 * spacer, and some exports carry a leading empty column, so the header row is
 * found by looking for the cell that says "Campaign name".
 *
 * Rows come at three delivery levels and Meta repeats the SAME spend at each
 * one (a campaign row restates the total of its ad sets, which restate the
 * total of their ads). Summing the file blindly triples every number — that's
 * why `level` is preserved and only ad-level rows are ever aggregated.
 */

export type AdLevel = "campaign" | "adset" | "ad";

export interface ParsedAdRow {
  level: AdLevel;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
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
  delivery_status: string | null;
}

export interface ParsedAdReport {
  account: string;
  fileName: string;
  periodStart: string | null;
  periodEnd: string | null;
  rows: ParsedAdRow[];
  levels: Record<AdLevel, number>;
  spend: number;
  purchases: number;
  conversionValue: number;
  warnings: string[];
}

// zero-width + bidi format characters; Meta sprinkles these through ad names
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;

function txt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).replace(INVISIBLE, "").replace(/[,\s]/g, "").replace(/%$/, "");
  if (s === "" || s === "-" || s === "—") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function dateStr(v: unknown): string | null {
  const s = txt(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Excel serial dates, when a sheet was saved with raw values
  const asNum = Number(s);
  if (!isNaN(asNum) && asNum > 20000 && asNum < 90000) {
    const d = new Date(Date.UTC(1899, 11, 30) + asNum * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Column aliases — Meta renames these between account currencies and UI
// versions, so match on any of them (compared lowercase, trimmed).
const COLS: Record<string, string[]> = {
  campaign: ["campaign name"],
  adset: ["ad set name", "adset name"],
  ad: ["ad name"],
  reach: ["reach"],
  impressions: ["impressions"],
  frequency: ["frequency"],
  spend: ["amount spent (egp)", "amount spent", "amount spent (usd)", "spend"],
  cpm: ["cpm (cost per 1,000 impressions)", "cpm"],
  link_clicks: ["link clicks", "clicks (link)"],
  ctr_all: ["ctr (all)", "ctr (link click-through rate)", "ctr"],
  lpv: ["landing page views"],
  atc: ["adds to cart", "website adds to cart"],
  ic: ["checkouts initiated", "website checkouts initiated"],
  purchases: ["purchases", "website purchases"],
  value: ["purchases conversion value", "website purchases conversion value"],
  cpp: ["cost per purchase"],
  roas: ["results roas", "purchase roas (return on ad spend)", "website purchase roas"],
  status: ["delivery status"],
  level: ["delivery level"],
  start: ["reporting starts"],
  end: ["reporting ends"],
};

function normLevel(v: unknown): AdLevel | null {
  const s = (txt(v) ?? "").toLowerCase();
  if (s === "ad") return "ad";
  if (s === "adset" || s === "ad set") return "adset";
  if (s === "campaign") return "campaign";
  return null;
}

/**
 * Turns a file name into an account label: "kids from 1 to 31 JUL.xlsx" -> "kids".
 * The user can always override it before importing.
 */
export function accountFromFileName(fileName: string): string {
  const base = fileName.replace(/\.(csv|xlsx?|xlsm)$/i, "");
  const cut = base.split(
    /\s+(?:from|for|report|period|-)\s+|\s+\d{1,2}\s*[-/]|\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i
  )[0];
  return (cut || base).replace(/[_-]+/g, " ").trim() || base;
}

export function parseAdsFile(data: ArrayBuffer, fileName: string): ParsedAdReport {
  const wb = XLSX.read(data, { type: "array", raw: false });
  const warnings: string[] = [];

  // the raw sheet keeps full precision AND repeats campaign/ad-set names on
  // every row; the formatted one blanks them, which we'd have to carry down
  const sheetName =
    wb.SheetNames.find((n) => /raw data/i.test(n)) ??
    wb.SheetNames.find((n) => /formatted/i.test(n)) ??
    wb.SheetNames[0];
  const usingFormatted = !/raw data/i.test(sheetName);
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error("No sheet found in workbook");

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: true,
  });

  // find the header row (the one containing "Campaign name")
  const headerIdx = grid.findIndex(
    (row) => Array.isArray(row) && row.some((c) => (txt(c) ?? "").toLowerCase() === "campaign name")
  );
  if (headerIdx === -1) throw new Error("Could not find the 'Campaign name' header row");

  const header = (grid[headerIdx] as unknown[]).map((c) => (txt(c) ?? "").toLowerCase());
  const idx = (key: string): number => {
    for (const alias of COLS[key]) {
      const i = header.indexOf(alias);
      if (i !== -1) return i;
    }
    return -1;
  };

  const iLevel = idx("level");
  const iCampaign = idx("campaign");
  const iAdset = idx("adset");
  const iAd = idx("ad");
  const iSpend = idx("spend");
  const iStart = idx("start");
  const iEnd = idx("end");
  if (iSpend === -1) warnings.push("No 'Amount spent' column found");

  const cell = (row: unknown[], i: number) => (i === -1 ? null : row[i]);

  const rows: ParsedAdRow[] = [];
  const levels: Record<AdLevel, number> = { campaign: 0, adset: 0, ad: 0 };
  let periodStart: string | null = null;
  let periodEnd: string | null = null;

  // the formatted sheet blanks repeated names — carry the last seen value down
  let lastCampaign: string | null = null;
  let lastAdset: string | null = null;

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row) || row.every((c) => txt(c) === null)) continue;

    const campaign = txt(cell(row, iCampaign));
    const adset = txt(cell(row, iAdset));
    const ad = txt(cell(row, iAd));
    if (campaign) lastCampaign = campaign;
    if (adset && adset !== "All") lastAdset = adset;

    let level = normLevel(cell(row, iLevel));
    if (!level) {
      // exports without a "Delivery level" column: "All" marks a rollup row
      if (!ad || ad === "All") level = !adset || adset === "All" ? "campaign" : "adset";
      else level = "ad";
    }

    const start = dateStr(cell(row, iStart));
    const end = dateStr(cell(row, iEnd));
    if (start && (!periodStart || start < periodStart)) periodStart = start;
    if (end && (!periodEnd || end > periodEnd)) periodEnd = end;

    const effCampaign = campaign ?? (usingFormatted ? lastCampaign : null);
    const effAdset =
      level === "campaign" ? null : adset && adset !== "All" ? adset : usingFormatted ? lastAdset : null;

    if (!effCampaign && !ad) continue; // account-total summary row

    rows.push({
      level,
      campaign_name: effCampaign,
      adset_name: effAdset,
      ad_name: level === "ad" ? ad : null,
      reach: num(cell(row, idx("reach"))),
      impressions: num(cell(row, idx("impressions"))),
      frequency: num(cell(row, idx("frequency"))),
      spend: num(cell(row, iSpend)),
      cpm: num(cell(row, idx("cpm"))),
      link_clicks: num(cell(row, idx("link_clicks"))),
      ctr_all: num(cell(row, idx("ctr_all"))),
      landing_page_views: num(cell(row, idx("lpv"))),
      adds_to_cart: num(cell(row, idx("atc"))),
      checkouts_initiated: num(cell(row, idx("ic"))),
      purchases: num(cell(row, idx("purchases"))),
      conversion_value: num(cell(row, idx("value"))),
      cost_per_purchase: num(cell(row, idx("cpp"))),
      results_roas: num(cell(row, idx("roas"))),
      delivery_status: txt(cell(row, idx("status"))),
    });
    levels[level]++;
  }

  if (iLevel === -1) warnings.push("No 'Delivery level' column — levels were inferred from the 'All' rollup rows");
  if (!levels.ad) warnings.push("This report has no ad-level rows, so per-ad analysis will be empty");

  // fall back to the report title, e.g. "Untitled report Jul-1-2026 to Jul-31-2026"
  if (!periodStart || !periodEnd) {
    const title = grid
      .slice(0, headerIdx)
      .flat()
      .map((c) => txt(c) ?? "")
      .join(" ");
    const m = title.match(/([A-Za-z]{3}-\d{1,2}-\d{4})\s*to\s*([A-Za-z]{3}-\d{1,2}-\d{4})/);
    if (m) {
      periodStart = periodStart ?? dateStr(m[1].replace(/-/g, " "));
      periodEnd = periodEnd ?? dateStr(m[2].replace(/-/g, " "));
    }
  }
  if (!periodStart || !periodEnd) warnings.push("Could not read the reporting period — set it manually");

  const adRows = rows.filter((r) => r.level === "ad");
  const sum = (pick: (r: ParsedAdRow) => number | null) => adRows.reduce((s, r) => s + (pick(r) ?? 0), 0);

  return {
    account: accountFromFileName(fileName),
    fileName,
    periodStart,
    periodEnd,
    rows,
    levels,
    spend: sum((r) => r.spend),
    purchases: sum((r) => r.purchases),
    conversionValue: sum((r) => r.conversion_value),
    warnings,
  };
}
