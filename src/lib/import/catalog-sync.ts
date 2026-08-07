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
  savedProducts: number;
  productsFailed: boolean;
  compare: CatalogCompare | null;
  score: number;
}

// Everything a products-file upload must do besides parsing:
// 1) store the FULL parsed catalog row per SKU (price, cover, author,
//    publisher, barcode, ... ) so the uploaded detail is actually usable
// 2) push available e-com stock (stock - reserved) into the stock engine
// 3) compare with the previous snapshot and save the new one
export async function syncCatalogUpload(
  supabase: SupabaseClient,
  books: CatalogBook[],
  fileName: string,
  onProgress?: (done: number, total: number) => void
): Promise<CatalogSyncResult> {
  const score = catalogScore(books);

  // 1) persist the full catalog. Chunked small: rows carry descriptions.
  let savedProducts = 0;
  let productsFailed = false;
  for (let i = 0; i < books.length; i += 400) {
    const chunk = books.slice(i, i + 400).map((b) => ({
      sku: b.sku,
      name: b.name,
      english_name: b.english_name,
      price: b.price,
      stock: b.stock,
      stock_qty: b.stock_qty === null || b.stock_qty === undefined ? null : String(b.stock_qty),
      section: b.section,
      category: b.category,
      language: b.language,
      age: b.age,
      series: b.series,
      publisher: b.publisher,
      author: b.author,
      other_authors: b.other_authors ?? null,
      translated_from: b.translated_from ?? null,
      book_type: b.book_type ?? null,
      cover_type: b.cover_type ?? null,
      paper_type: b.paper_type ?? null,
      pages: b.pages ?? null,
      dimensions: b.dimensions ?? null,
      semester: b.semester ?? null,
      link: b.link,
      release_date: b.release_date,
      description: b.description,
      image: b.image,
      barcode: b.barcode,
      vendor: b.vendor ?? null,
      attributes: b.attributes ?? {},
    }));
    const { error } = await supabase.rpc("fn_upsert_products", { p_rows: chunk });
    if (error) {
      productsFailed = true;
      break;
    }
    savedProducts += chunk.length;
  }

  // 2) register the SKUs in the stock engine. The catalogue may be an old
  // download, so its stock column only seeds books nobody has counted yet —
  // the Data Center's e-commerce stock card owns the live number.
  const withStock = books.filter((b) => b.stock_qty !== null && b.stock_qty !== undefined);
  let syncedStock = 0;
  let stockFailed = false;
  for (let i = 0; i < withStock.length; i += 2000) {
    const chunk = withStock.slice(i, i + 2000).map((b) => ({
      sku: b.sku,
      product_name: b.name ?? b.english_name ?? "",
      ecom_stock: String(b.stock_qty),
      category: b.section ?? "",
      vendor: b.vendor ?? "",
    }));
    const { error } = await supabase.rpc("fn_upsert_stock_catalog", { p_rows: chunk });
    if (error) {
      stockFailed = true;
      break;
    }
    syncedStock += chunk.length;
    onProgress?.(syncedStock, withStock.length);
  }

  // 3) snapshot compare + save
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

  return { syncedStock, stockFailed, savedProducts, productsFailed, compare, score };
}
