import * as XLSX from "xlsx";

export interface StockRow {
  sku: string;
  product_name: string | null;
  ecom_stock: number | null;
  sap_stock: number | null;
  category: string | null;
  vendor?: string | null;
  // the store's own on/off switch: 616 of 3,774 SKUs are 0 (duplicates,
  // "listed under another code", closed editions) and must never be moved
  ecom_active?: boolean | null;
  // why it is off — "مكرر" (duplicate) never comes back, "اغلاق سعر"
  // (price closed) does
  ecom_note?: string | null;
}

// Which stock is this file the truth about? An upload replaces its own
// side wholesale and never touches the other one.
export type StockSide = "ecom" | "sap" | "both";

export interface StockSnapshot {
  side: StockSide;
  rows: StockRow[];
}

// The platform names its exports ProductStockExport_<user>_<unix seconds>,
// so a file downloaded last week can be recognised as last week's count
// rather than today's. Anything outside a sane range is ignored.
// SAP files are named by hand instead — Stock13.08.2026.XLSX — so a count
// pulled on Wednesday and uploaded on Friday isn't recorded as Friday's.
export function snapshotTakenAt(fileName: string): Date | null {
  const m = fileName.match(/(?:^|[_-])(1[5-9]\d{8}|2\d{9})(?:\D|$)/);
  if (m) {
    const d = new Date(parseInt(m[1], 10) * 1000);
    if (isNaN(d.getTime()) || d.getTime() > Date.now() + 86_400_000) return null;
    return d;
  }
  const iso = fileName.match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  // day-first otherwise, the local convention
  const dm = iso ? null : fileName.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](20\d{2})/);
  if (iso || dm) {
    const [year, month, day] = iso ? [iso[1], iso[2], iso[3]] : [dm![3], dm![2], dm![1]];
    const d = new Date(Date.UTC(+year, +month - 1, +day, 12));
    if (!isNaN(d.getTime()) && +month <= 12 && +day <= 31 && d.getTime() <= Date.now() + 86_400_000) return d;
  }
  return null;
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

// A pivoted SAP export puts its footer label in the Material column
// itself, so "Grand Total" arrived as a SKU holding 964,235 units — half
// of everything the app thought was in the warehouse. A total is never a
// material; drop the row rather than trust it.
const TOTAL_ROW = /^(grand\s*total|overall\s*result|total|sum|result|الإجمالي|إجمالي|المجموع)$/i;

// Accepts flexible column names: Sku, product name, ecom / e-com stock /
// current stock, sap / sap stock / warehouse, category.
// Also auto-detects raw SAP exports (Material / Unrestricted per storage
// location) and aggregates quantities per material.
export function parseStockFile(data: ArrayBuffer): StockSnapshot {
  const wb = XLSX.read(data, { type: "array", raw: false });

  // SAP export detection: a Material column is the giveaway. The quantity
  // column is named "Unrestricted" in the per-storage-location export, but
  // the pivoted one puts the storage location code itself in the header
  // ("0004"), so anything that isn't the material or its description counts
  // as a quantity column and a row may carry several locations to add up.
  // A trailing total row either has no material or carries its own label
  // there; both are dropped.
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { raw: false, defval: null });
    if (!rows.length) continue;
    const keys = Object.keys(rows[0]);
    const matKey = keys.find((k) => k.toLowerCase().trim() === "material");
    if (!matKey) continue;
    const descKey = keys.find((k) => k.toLowerCase().includes("description"));
    const unrestricted = keys.filter((k) => k.toLowerCase().includes("unrestricted"));
    const qtyKeys = unrestricted.length
      ? unrestricted
      : keys.filter((k) => k !== matKey && k !== descKey && !/total|sum|إجمالي/i.test(k));
    if (!qtyKeys.length) continue;

    const agg = new Map<string, { name: string | null; qty: number }>();
    let sawQty = false;
    for (const row of rows) {
      const sku = row[matKey] ? String(row[matKey]).trim() : "";
      if (!sku || TOTAL_ROW.test(sku)) continue;
      let qty = 0;
      for (const k of qtyKeys) {
        const n = num(row[k]);
        if (n !== null) {
          qty += n;
          sawQty = true;
        }
      }
      const prev = agg.get(sku);
      if (prev) prev.qty += qty;
      else agg.set(sku, { name: descKey && row[descKey] ? String(row[descKey]).trim() : null, qty });
    }
    if (!agg.size || !sawQty) continue;

    return {
      side: "sap",
      rows: Array.from(agg.entries()).map(([sku, v]) => ({
        sku,
        product_name: v.name,
        ecom_stock: null,
        sap_stock: v.qty,
        category: null,
      })),
    };
  }

  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: null });
  if (!rows.length) return { side: "ecom", rows: [] };

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
      // two switches: the variant's own and its parent product's. A parent
      // switched off takes every variant with it, whatever the variant
      // says — 34 SKUs read active=1 under a main_active=0 parent
      const variantActive = num(row["active"]);
      const mainActive = num(row["main_active"]);
      const active =
        variantActive === null && mainActive === null
          ? null
          : (variantActive ?? 1) !== 0 && (mainActive ?? 1) !== 0 ? 1 : 0;
      const noteRaw =
        (variantActive === 0 ? row["deactivation_notes"] : null) ??
        row["main_deactivation_notes"] ??
        row["deactivation_notes"];
      const note = noteRaw ? String(noteRaw).trim() : "";
      out.push({
        sku,
        product_name: nameKey && row[nameKey] ? String(row[nameKey]).trim() : null,
        ecom_stock: stock === null ? null : Math.max(0, stock - reserved),
        sap_stock: null,
        category: catKey && row[catKey] ? String(row[catKey]).trim() : null,
        vendor: brandKey && row[brandKey] ? String(row[brandKey]).trim() : null,
        ecom_active: active === null ? null : active !== 0,
        // "..." and "....." are the store's own placeholders, not reasons
        ecom_note: active === 0 && note && !/^\.+$/.test(note) ? note : null,
      });
    }
    return { side: "ecom", rows: out };
  }
  const skuKey = findKey(keys, ["sku", "code", "الكود"]);
  if (!skuKey) return { side: "ecom", rows: [] };
  const nameKey = findKey(keys, ["productname", "name", "product", "الاسم", "اسم"]);
  const ecomKey = findKey(keys, ["ecomstock", "ecom", "ecommercestock", "currentstock", "onlinestock", "webstock", "المتجر"]);
  const sapKey = findKey(keys, ["sapstock", "sap", "warehousestock", "warehouse", "المخزن"]);
  const catKey = findKey(keys, ["category", "الفئة", "التصنيف"]);

  const out: StockRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const sku = row[skuKey] ? String(row[skuKey]).trim() : "";
    if (!sku || seen.has(sku) || TOTAL_ROW.test(sku)) continue;
    seen.add(sku);
    out.push({
      sku,
      product_name: nameKey && row[nameKey] ? String(row[nameKey]).trim() : null,
      ecom_stock: ecomKey ? num(row[ecomKey]) : null,
      sap_stock: sapKey ? num(row[sapKey]) : null,
      category: catKey && row[catKey] ? String(row[catKey]).trim() : null,
    });
  }
  // a hand-made sheet may carry one column or both; only the columns that
  // are actually there get replaced
  const side: StockSide = ecomKey && sapKey ? "both" : sapKey ? "sap" : "ecom";
  return { side, rows: out };
}
