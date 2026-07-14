import * as XLSX from "xlsx";

export interface StockRow {
  sku: string;
  product_name: string | null;
  ecom_stock: number | null;
  sap_stock: number | null;
  category: string | null;
  vendor?: string | null;
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
// current stock, sap / sap stock / warehouse, category.
// Also auto-detects raw SAP exports (Material / Unrestricted per storage
// location) and aggregates quantities per material.
export function parseStockFile(data: ArrayBuffer): StockRow[] {
  const wb = XLSX.read(data, { type: "array", raw: false });

  // SAP export detection: look across sheets for Material + Unrestricted
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { raw: false, defval: null });
    if (!rows.length) continue;
    const keys = Object.keys(rows[0]).map((k) => k.toLowerCase());
    if (keys.some((k) => k === "material") && keys.some((k) => k.includes("unrestricted"))) {
      const matKey = Object.keys(rows[0]).find((k) => k.toLowerCase() === "material")!;
      const descKey = Object.keys(rows[0]).find((k) => k.toLowerCase().includes("description"));
      const qtyKey = Object.keys(rows[0]).find((k) => k.toLowerCase().includes("unrestricted"))!;
      const agg = new Map<string, { name: string | null; qty: number }>();
      for (const row of rows) {
        const sku = row[matKey] ? String(row[matKey]).trim() : "";
        if (!sku) continue;
        const qty = num(row[qtyKey]) ?? 0;
        const prev = agg.get(sku);
        if (prev) prev.qty += qty;
        else agg.set(sku, { name: descKey && row[descKey] ? String(row[descKey]).trim() : null, qty });
      }
      return Array.from(agg.entries()).map(([sku, v]) => ({
        sku,
        product_name: v.name,
        ecom_stock: null,
        sap_stock: v.qty,
        category: null,
      }));
    }
  }

  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: null });
  if (!rows.length) return [];

  const keys = Object.keys(rows[0]);

  // Platform ProductStockExport: sku / stock / reserved_stock columns,
  // names & category in "... exportOnly" columns. Available e-com stock
  // = stock - reserved_stock.
  if (keys.includes("sku") && keys.includes("stock") && keys.includes("reserved_stock")) {
    const nameKey = keys.find((k) => k.startsWith("name") && k.includes("exportOnly")) ?? null;
    const catKey = keys.find((k) => k.startsWith("category") && k.includes("exportOnly")) ?? null;
    const brandKey = keys.find((k) => k.startsWith("brand") && k.includes("exportOnly")) ?? null;
    const out: StockRow[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const sku = row["sku"] ? String(row["sku"]).trim() : "";
      if (!sku || seen.has(sku)) continue;
      seen.add(sku);
      const stock = num(row["stock"]);
      const reserved = num(row["reserved_stock"]) ?? 0;
      out.push({
        sku,
        product_name: nameKey && row[nameKey] ? String(row[nameKey]).trim() : null,
        ecom_stock: stock === null ? null : Math.max(0, stock - reserved),
        sap_stock: null,
        category: catKey && row[catKey] ? String(row[catKey]).trim() : null,
        vendor: brandKey && row[brandKey] ? String(row[brandKey]).trim() : null,
      });
    }
    return out;
  }
  const skuKey = findKey(keys, ["sku", "code", "الكود"]);
  if (!skuKey) return [];
  const nameKey = findKey(keys, ["productname", "name", "product", "الاسم", "اسم"]);
  const ecomKey = findKey(keys, ["ecomstock", "ecom", "ecommercestock", "currentstock", "onlinestock", "webstock", "المتجر"]);
  const sapKey = findKey(keys, ["sapstock", "sap", "warehousestock", "warehouse", "المخزن"]);
  const catKey = findKey(keys, ["category", "الفئة", "التصنيف"]);

  const out: StockRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const sku = row[skuKey] ? String(row[skuKey]).trim() : "";
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
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
