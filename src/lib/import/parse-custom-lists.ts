import * as XLSX from "xlsx";

/**
 * Custom list exports from the e-commerce platform.
 *
 * One export = one curated list of books, the thing the ads actually link to
 * (/ar/products/list/<slug>). The file looks like this:
 *
 *   sku                    name              list_id  product_type  order
 *   main_C010924220964P    جدتي والديناصورات  82       main          1
 *
 * Two things the file does NOT contain:
 *
 *   the list's NAME — it only exists in the file name ("Award-Winning
 *   Books.xlsx"), so that's where the name comes from;
 *
 *   the list's SLUG — the URL segment the ad links to. It's attached later,
 *   in the Ads Center, either by hand or by pasting an ad's link.
 *
 * `sku` carries a `<product_type>_` prefix that the store's own SKUs don't
 * have (`main_C0109...` in the list vs `C0109...` in orders and stock), so it
 * is stripped or nothing would ever match.
 */

export interface CustomListItem {
  sku: string;
  raw_sku: string;
  product_name: string | null;
  sort_order: number | null;
}

export interface ParsedCustomList {
  list_id: number | null;
  name: string;
  slug: string | null;
  product_type: string;
  items: CustomListItem[];
}

export interface ParsedCustomLists {
  lists: ParsedCustomList[];
  totalItems: number;
  /** rows skipped because they had no usable SKU */
  skipped: number;
  warnings: string[];
}

// zero-width + bidi marks; the platform's Arabic names are full of them
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;

function txt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

function int(v: unknown): number | null {
  const s = txt(v);
  if (!s) return null;
  const n = parseInt(s.replace(/[^\d-]/g, ""), 10);
  return isNaN(n) ? null : n;
}

/**
 * `main_C010924220964P` -> `C010924220964P`.
 * Only a known product-type prefix is removed, and only when what follows
 * still looks like a SKU — a book whose SKU legitimately contains an
 * underscore must survive untouched.
 */
export function stripSkuPrefix(raw: string, productType?: string | null): string {
  const s = raw.replace(INVISIBLE, "").trim();
  const prefixes = [productType, "main", "variant", "bundle", "child", "parent"]
    .filter((p): p is string => !!p)
    .map((p) => `${p.toLowerCase()}_`);
  for (const p of prefixes) {
    if (s.toLowerCase().startsWith(p) && s.length > p.length) return s.slice(p.length);
  }
  return s;
}

/** "Award-Winning Books.xlsx" -> "Award-Winning Books" */
export function listNameFromFileName(fileName: string): string {
  const base = fileName.replace(/\.(csv|xlsx?|xlsm)$/i, "").replace(INVISIBLE, "").trim();
  return base.replace(/[_]+/g, " ").trim() || fileName;
}

const COLS: Record<string, string[]> = {
  sku: ["sku", "product sku", "product_sku"],
  name: ["name", "product name", "product_name", "title"],
  list: ["list_id", "list id", "listid", "list"],
  type: ["product_type", "product type", "type"],
  order: ["order", "sort", "position", "sort_order"],
};

export function parseCustomListsFile(data: ArrayBuffer, fileName: string): ParsedCustomLists {
  const wb = XLSX.read(data, { type: "array", raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("No sheet found in workbook");

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: false,
  });

  const headerIdx = grid.findIndex(
    (row) => Array.isArray(row) && row.some((c) => (txt(c) ?? "").toLowerCase() === "sku")
  );
  if (headerIdx === -1) throw new Error("Could not find a 'sku' column");

  const header = (grid[headerIdx] as unknown[]).map((c) => (txt(c) ?? "").toLowerCase());
  const idx = (key: string): number => {
    for (const alias of COLS[key]) {
      const i = header.indexOf(alias);
      if (i !== -1) return i;
    }
    return -1;
  };

  const iSku = idx("sku");
  const iName = idx("name");
  const iList = idx("list");
  const iType = idx("type");
  const iOrder = idx("order");
  const cell = (row: unknown[], i: number) => (i === -1 ? null : row[i]);

  const warnings: string[] = [];
  if (iList === -1) warnings.push("No 'list_id' column — every row is treated as one list");

  // group by list_id: one file usually holds one list, but the column allows
  // several and a multi-list export must not collapse into one pile
  const groups = new Map<string, { listId: number | null; type: string; items: CustomListItem[] }>();
  let skipped = 0;

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row) || row.every((c) => txt(c) === null)) continue;

    const rawSku = txt(cell(row, iSku));
    if (!rawSku) {
      skipped++;
      continue;
    }
    const productType = txt(cell(row, iType)) ?? "main";
    const sku = stripSkuPrefix(rawSku, productType);
    if (!sku) {
      skipped++;
      continue;
    }

    const listId = int(cell(row, iList));
    const key = listId === null ? "_" : String(listId);
    let g = groups.get(key);
    if (!g) {
      g = { listId, type: productType, items: [] };
      groups.set(key, g);
    }
    g.items.push({
      sku,
      raw_sku: rawSku,
      product_name: txt(cell(row, iName)),
      sort_order: int(cell(row, iOrder)),
    });
  }

  const fileBase = listNameFromFileName(fileName);
  const many = groups.size > 1;

  const lists: ParsedCustomList[] = Array.from(groups.values()).map((g) => ({
    list_id: g.listId,
    // a single-list file is named by its file; a multi-list file can't be, so
    // each list is labelled by its id and renamed later in the Ads Center
    name: many ? `${fileBase} · ${g.listId ?? "?"}` : fileBase,
    slug: null,
    product_type: g.type,
    items: g.items,
  }));

  if (!lists.length) throw new Error("No list rows found in this file");
  if (many) warnings.push(`${lists.length} lists in one file — rename them in the Ads Center`);

  return {
    lists,
    totalItems: lists.reduce((s, l) => s + l.items.length, 0),
    skipped,
    warnings,
  };
}
