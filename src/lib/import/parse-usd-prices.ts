import * as XLSX from "xlsx";

export interface UsdPriceRow {
  sku: string;
  usd: string;
}

// Parses the global storefront USD price list (SAP export for the global
// ship-to): columns "Old Material #" + "Amount" (+ optional Currency).
// Also accepts a plain SKU,USD two-column sheet.
export function parseUsdPricesFile(data: ArrayBuffer): UsdPriceRow[] {
  const wb = XLSX.read(data, { type: "array", raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: null });
  if (!rows.length) return [];

  const keys = Object.keys(rows[0]);
  const lower = keys.map((k) => k.toLowerCase().trim());
  const skuKey =
    keys[lower.findIndex((k) => k.includes("old material"))] ??
    keys[lower.findIndex((k) => k.includes("material") || k.includes("sku") || k.includes("كود"))];
  const usdKey =
    keys[lower.findIndex((k) => k === "amount" || k.includes("usd") || k.includes("دولار") || k === "price")];
  const curKey = keys[lower.findIndex((k) => k.includes("currency"))];
  if (!skuKey || !usdKey) return [];

  const out: UsdPriceRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const sku = r[skuKey] ? String(r[skuKey]).trim() : "";
    const n = parseFloat(String(r[usdKey] ?? "").replace(/,/g, ""));
    if (!sku || isNaN(n) || n <= 0 || seen.has(sku)) continue;
    // if the file carries a currency column, only accept USD rows
    if (curKey && r[curKey] && !String(r[curKey]).toUpperCase().includes("USD")) continue;
    seen.add(sku);
    out.push({ sku, usd: String(n) });
  }
  return out;
}
