import * as XLSX from "xlsx";

export interface ParsedAdRow {
  source: string;
  campaign_name: string | null;
  ad_group: string | null;
  ad_name: string | null;
  reach: number | null;
  impressions: number | null;
  amount_spent: number | null;
  reported_purchases: number | null;
  cost_per_purchase: number | null;
  reported_conversion_value: number | null;
  frequency: number | null;
  clicks_all: number | null;
  link_clicks: number | null;
  report_start: string | null;
  report_end: string | null;
  match_keyword: string | null;
  mapped_sku: string | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function txt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  // strip invisible bidi/format chars often present in FB exports
  const s = String(v).replace(/[‎‏‪-‮⁦-⁩]/g, "").trim();
  return s === "" ? null : s;
}

function dateStr(v: unknown): string | null {
  const s = txt(v);
  if (!s) return null;
  // Facebook exports YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Handles both export shapes:
//  Ads1: Campaign name, Ad set name, Ad name, ...
//  Ads2: Campaign name, Account name, Ad name, Currency, ...
export function parseAdsFile(data: ArrayBuffer, fileName: string): ParsedAdRow[] {
  const wb = XLSX.read(data, { type: "array", raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: null });

  const source = /insta|ig/i.test(fileName) ? "instagram" : "facebook";
  const out: ParsedAdRow[] = [];

  for (const row of rows) {
    const keys = Object.keys(row);
    const get = (name: string) => {
      const k = keys.find((x) => x.toLowerCase().trim() === name.toLowerCase());
      return k ? row[k] : null;
    };

    const campaign = txt(get("Campaign name"));
    const adName = txt(get("Ad name"));
    const spent = num(get("Amount spent (EGP)")) ?? num(get("Amount spent"));

    // Skip the account-total summary row (no campaign, no ad name)
    if (!campaign && !adName) continue;
    if (spent === null && !adName) continue;

    out.push({
      source,
      campaign_name: campaign,
      ad_group: txt(get("Ad set name")) ?? txt(get("Account name")),
      ad_name: adName,
      reach: num(get("Reach")),
      impressions: num(get("Impressions")),
      amount_spent: spent,
      reported_purchases: num(get("Purchases")),
      cost_per_purchase: num(get("Cost per purchase")),
      reported_conversion_value: num(get("Purchases conversion value")),
      frequency: num(get("Frequency")),
      clicks_all: num(get("Clicks (all)")),
      link_clicks: num(get("Link clicks")),
      report_start: dateStr(get("Reporting starts")),
      report_end: dateStr(get("Reporting ends")),
      // default the match keyword to the ad name so actual-revenue works out of the box
      match_keyword: adName,
      mapped_sku: null,
    });
  }

  return out;
}
