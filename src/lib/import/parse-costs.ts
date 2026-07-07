import * as XLSX from "xlsx";

export interface CostRow {
  sku: string;
  cost: string;
}

const num = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : String(n);
};

// Simple costs file: a SKU column and a cost column (any common naming).
export function parseCostsFile(data: ArrayBuffer): CostRow[] {
  const wb = XLSX.read(data, { type: "array", raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: null });
  if (!rows.length) return [];

  const keys = Object.keys(rows[0]);
  const lower = keys.map((k) => k.toLowerCase().trim());
  const skuKey = keys[lower.findIndex((k) => k.includes("sku") || k === "id" || k.includes("كود") || k === "material")];
  const costKey = keys[lower.findIndex((k) => k.includes("cost") || k.includes("التكلفة") || k.includes("تكلفة") || k.includes("سعر التكلفة") || k === "price")];
  if (!skuKey || !costKey) return [];

  const seen = new Set<string>();
  const out: CostRow[] = [];
  for (const row of rows) {
    const sku = row[skuKey] ? String(row[skuKey]).trim() : "";
    const cost = num(row[costKey]);
    if (!sku || cost === null || seen.has(sku)) continue;
    seen.add(sku);
    out.push({ sku, cost });
  }
  return out;
}
