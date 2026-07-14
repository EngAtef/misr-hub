import type { SupabaseClient } from "@supabase/supabase-js";
import { CATALOG_FIELDS, type CatalogBook } from "./parse-catalog";

// Stored in app_settings under key "catalog_snapshot" — the single
// source of truth for catalog quality, written by the Data Center
// products upload and by the Catalog page upload alike.
export interface CatalogSnapshot {
  date: string;
  fileName: string;
  total: number;
  score: number;
  fields: string[];
  books: Record<string, number>; // sku -> bitmask of MISSING field indexes
  names?: Record<string, string>; // sku -> display name
}

export interface CatalogCompare {
  prev: CatalogSnapshot;
  added: number;
  removed: number;
  fixed: number;
  regressed: number;
}

export function missMask(b: CatalogBook): number {
  let mask = 0;
  CATALOG_FIELDS.forEach((f, i) => {
    if (!b[f]) mask |= 1 << i;
  });
  return mask;
}

export function bitCount(n: number): number {
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
}

export function catalogScore(books: CatalogBook[]): number {
  if (!books.length) return 0;
  const totalCells = books.length * CATALOG_FIELDS.length;
  let filled = 0;
  for (const b of books) filled += CATALOG_FIELDS.length - bitCount(missMask(b));
  return (filled / totalCells) * 100;
}

export interface CatalogSyncResult {
  syncedStock: number;
  stockFailed: boolean;
  compare: CatalogCompare | null;
  score: number;
}

// Everything a products-file upload must do besides parsing:
// 1) push available e-com stock (stock - reserved) into the stock engine
// 2) compare with the previous snapshot and save the new one
export async function syncCatalogUpload(
  supabase: SupabaseClient,
  books: CatalogBook[],
  fileName: string,
  onProgress?: (done: number, total: number) => void
): Promise<CatalogSyncResult> {
  const score = catalogScore(books);

  // 1) e-commerce stock sync
  const withStock = books.filter((b) => b.stock_qty !== null && b.stock_qty !== undefined);
  let syncedStock = 0;
  let stockFailed = false;
  for (let i = 0; i < withStock.length; i += 2000) {
    const chunk = withStock.slice(i, i + 2000).map((b) => ({
      sku: b.sku,
      product_name: b.name ?? b.english_name ?? "",
      ecom_stock: String(b.stock_qty),
      sap_stock: "",
      category: b.section ?? "",
      vendor: b.vendor ?? "",
    }));
    const { error } = await supabase.rpc("fn_upsert_stock", { p_rows: chunk });
    if (error) {
      stockFailed = true;
      break;
    }
    syncedStock += chunk.length;
    onProgress?.(syncedStock, withStock.length);
  }

  // 2) snapshot compare + save
  const { data } = await supabase.from("app_settings").select("value").eq("key", "catalog_snapshot").maybeSingle();
  const prev = (data?.value ?? null) as CatalogSnapshot | null;
  const current: Record<string, number> = {};
  const names: Record<string, string> = {};
  for (const b of books) {
    current[b.sku] = missMask(b);
    const n = b.name ?? b.english_name;
    if (n) names[b.sku] = n;
  }

  let compare: CatalogCompare | null = null;
  if (prev && prev.books) {
    let added = 0;
    let removed = 0;
    let fixed = 0;
    let regressed = 0;
    for (const sku of Object.keys(current)) {
      if (!(sku in prev.books)) added++;
      else {
        const was = prev.books[sku];
        const now = current[sku];
        fixed += bitCount(was & ~now);
        regressed += bitCount(now & ~was);
      }
    }
    for (const sku of Object.keys(prev.books)) if (!(sku in current)) removed++;
    compare = { prev, added, removed, fixed, regressed };
  }

  const snapshot: CatalogSnapshot = {
    date: new Date().toISOString(),
    fileName,
    total: books.length,
    score,
    fields: [...CATALOG_FIELDS],
    books: current,
    names,
  };
  await supabase
    .from("app_settings")
    .upsert({ key: "catalog_snapshot", value: snapshot, updated_at: new Date().toISOString() }, { onConflict: "key" });

  return { syncedStock, stockFailed, compare, score };
}
