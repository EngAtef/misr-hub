import * as XLSX from "xlsx";

export interface StockRow {
  sku: string;
  product_name: string | null;
  ecom_stock: number | null;
  sap_stock: number | null;
  category: string | null;
}

function findKey(keys: string[], candidates: string[]): string | null {
  for (const c of candidates) {
    const k = keys.find((x) => x.toLowerCase().replace(/[\s_-]/g, "") === c);
    if (k) return k;
  }
  for (const c of candidates) {
    const k = keys.find((x) => x.toLowerCase().includes(c));
    if (k) return k;
  }
  return null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : Math.round(n);
}

// Accepts flexible column names: Sku, product name, ecom / e-com stock /
// current stock, sap / sap stock / warehouse, category
export function parseStockFile(data: ArrayBuffer): StockRow[] {
  const wb = XLSX.read(data, { type: "array", raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: null });
  if (!rows.length) return [];

  const keys = Object.keys(rows[0]);
  const skuKey = findKey(keys, ["sku", "code", "الكود"]);
  if (!skuKey) return [];
  const nameKey = findKey(keys, ["productname", "name", "product", "الاسم", "اسم"]);
  const ecomKey = findKey(keys, ["ecomstock", "ecom", "ecommercestock", "currentstock", "onlinestock", "webstock", "المتجر"]);
  const sapKey = findKey(keys, ["sapstock", "sap", "warehousestock", "warehouse", "المخزن"]);
  const catKey = findKey(keys, ["category", "الفئة", "التصنيف"]);

  const out: StockRow[] = [];
  for (const row of rows) {
    const sku = row[skuKey] ? String(row[skuKey]).trim() : "";
    if (!sku) continue;
    out.push({
      sku,
      product_name: nameKey && row[nameKey] ? String(row[nameKey]).trim() : null,
      ecom_stock: ecomKey ? num(row[ecomKey]) : null,
      sap_stock: sapKey ? num(row[sapKey]) : null,
      category: catKey && row[catKey] ? String(row[catKey]).trim() : null,
    });
  }
  return out;
}
