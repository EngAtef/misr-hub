import * as XLSX from "xlsx";

export interface CatalogBook {
  sku: string;
  name: string | null;
  english_name: string | null;
  price: string | null;
  stock: string | null;
  section: string | null;
  category: string | null;
  language: string | null;
  age: string | null;
  series: string | null;
  publisher: string | null;
  author: string | null;
  link: string | null;
  release_date: string | null;
  description: string | null;
  image: string | null;
  barcode: string | null;
  // numeric available stock (stock - reserved) when the file provides it
  stock_qty?: number | null;
  // vendor/brand for multi-supplier analysis (e.g. Al Adwaa)
  vendor?: string | null;
  // extra book detail carried by the export's attribute columns
  other_authors?: string | null;
  translated_from?: string | null;
  book_type?: string | null;
  cover_type?: string | null;
  paper_type?: string | null;
  pages?: string | null;
  dimensions?: string | null;
  semester?: string | null;
  // every attribute_name/value pair as-is, so a field the platform adds
  // later is stored even before it gets a column of its own
  attributes?: Record<string, string>;
  // shipping weight in kg (FullProductExport `weight` column) — feeds
  // order / abandoned-cart weight totals
  weight_kg?: number | null;
}

// The export's weight column is kilograms; a value above 100 can only be
// grams typed into the kg field (one real case: 1096 → 1.096 kg).
export function parseWeightKg(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  if (!isFinite(n) || n <= 0) return null;
  return n > 100 ? n / 1000 : n;
}

export type ExtraField =
  | "other_authors"
  | "translated_from"
  | "book_type"
  | "cover_type"
  | "paper_type"
  | "pages"
  | "dimensions"
  | "semester";

export const CATALOG_FIELDS = [
  "name",
  "english_name",
  "price",
  "stock",
  "section",
  "category",
  "language",
  "age",
  "series",
  "publisher",
  "author",
  "link",
  "release_date",
  "description",
  "image",
  "barcode",
] as const;

export type CatalogField = (typeof CATALOG_FIELDS)[number];

// Attribute names used in the FullProductExport attribute_name_N columns.
// Keys are matched after lowercasing AND after stripping apostrophes and
// collapsing whitespace — the live export writes "Author's Name", which a
// literal "author name" key silently missed for ~3k books.
const ATTR_MAP: Record<string, CatalogField | ExtraField> = {
  // English names used by the platform's FullProductExport
  "author name": "author",
  "authors name": "author",
  author: "author",
  "other authors": "other_authors",
  "translated from book": "translated_from",
  "translated from": "translated_from",
  publisher: "publisher",
  "publishing house": "publisher",
  "first publisher": "publisher",
  "book language": "language",
  language: "language",
  "age group": "age",
  age: "age",
  "series name": "series",
  series: "series",
  "release date": "release_date",
  "ean/upc/isbn": "barcode",
  "book type": "book_type",
  "cover type": "cover_type",
  "paper type": "paper_type",
  "no.book pages": "pages",
  "no. book pages": "pages",
  "book pages": "pages",
  pages: "pages",
  "book dimensions (cm)": "dimensions",
  "book dimensions": "dimensions",
  semester: "semester",
  // Arabic variants
  "المؤلف": "author",
  "الكاتب": "author",
  "اسم المؤلف": "author",
  "الناشر": "publisher",
  "دار النشر": "publisher",
  "اللغة": "language",
  "العمر": "age",
  "الفئة العمرية": "age",
  "السلسلة": "series",
  "تاريخ الإصدار": "release_date",
  "تاريخ الاصدار": "release_date",
  "نوع الكتاب": "book_type",
  "نوع الغلاف": "cover_type",
  "عدد الصفحات": "pages",
  "المقاس": "dimensions",
  "الفصل الدراسي": "semester",
};

// "Author's Name" -> "authors name"
function attrKey(name: string): string {
  return name.toLowerCase().replace(/[’'`]/g, "").replace(/\s+/g, " ").trim();
}

const HEADER_MAP: Record<CatalogField, string[]> = {
  name: ["اسم الكتاب", "الاسم", "name", "arabic name", "البند"],
  english_name: ["english name", "الاسم الانجليزي", "الاسم الإنجليزي"],
  price: ["السعر", "price"],
  stock: ["stock", "المخزون", "الكمية"],
  section: ["القسم الرئيسي", "القسم", "main section", "section"],
  category: ["التصنيف الفرعي", "التصنيف", "category", "sub"],
  language: ["اللغة", "language"],
  age: ["الفئة العمرية", "العمر", "age"],
  series: ["السلسلة", "series name", "series"],
  publisher: ["الناشر", "publisher"],
  author: ["المؤلف", "author"],
  link: ["الرابط", "link", "url"],
  release_date: ["release date", "تاريخ الإصدار", "تاريخ الاصدار"],
  description: ["description", "الوصف"],
  image: ["main_image", "image", "الصورة"],
  barcode: ["barcode", "الباركود"],
};

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim().toLowerCase();
  return s === "" || s === "-" || s === "n/a" || s === "na" || s === "0000-00-00" || s === "null" || s === "لا يوجد";
}

function buildBooks(rows: Record<string, unknown>[]): CatalogBook[] {
  if (rows.length < 2) return [];
  const keys = Object.keys(rows[0]);
  const lower = keys.map((k) => k.toLowerCase().trim());

  const skuIdx = lower.findIndex((k) => k.includes("sku") || k === "id" || k.includes("الكود") || k.includes("كود"));
  if (skuIdx === -1) return [];
  const skuKey = keys[skuIdx];

  const fieldKeys: Partial<Record<CatalogField, string>> = {};
  for (const field of CATALOG_FIELDS) {
    for (const candidate of HEADER_MAP[field]) {
      const i = lower.findIndex((k) => k.includes(candidate.toLowerCase()));
      if (i !== -1 && !Object.values(fieldKeys).includes(keys[i])) {
        fieldKeys[field] = keys[i];
        break;
      }
    }
  }

  const weightIdx = lower.findIndex((k) => k === "weight" || k.includes("weight (kg)") || k.includes("الوزن"));
  const weightKey = weightIdx === -1 ? null : keys[weightIdx];

  const seen = new Set<string>();
  const out: CatalogBook[] = [];
  for (const row of rows) {
    const sku = row[skuKey] ? String(row[skuKey]).trim() : "";
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    const book = { sku } as CatalogBook;
    for (const field of CATALOG_FIELDS) {
      const key = fieldKeys[field];
      book[field] = key && !isEmpty(row[key]) ? String(row[key]).trim() : null;
    }
    if (weightKey) book.weight_kg = parseWeightKg(row[weightKey]);
    out.push(book);
  }
  return out;
}

// Dedicated mapper for the platform FullProductExport (163 columns):
// variant_sku, name/name_ar, category (export only), subcategory, price,
// stock/reserved_stock, main_image, slug, and attribute_name/value_1..18.
function buildFromFullExport(rows: Record<string, unknown>[]): CatalogBook[] {
  const clean = (v: unknown): string | null => (isEmpty(v) ? null : String(v).trim());
  const seen = new Set<string>();
  const out: CatalogBook[] = [];

  for (const row of rows) {
    const sku = clean(row["variant_sku"]) ?? clean(row["main_sku"])?.replace(/^main_/, "") ?? null;
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);

    const nameAr = clean(row["name_ar"]);
    const nameEn = clean(row["name"]);
    const stockRaw = clean(row["stock"]);
    const reserved = parseFloat(String(row["reserved_stock"] ?? "")) || 0;
    const stockNum = stockRaw !== null ? parseFloat(stockRaw.replace(/,/g, "")) : NaN;

    const book: CatalogBook = {
      sku,
      name: nameAr ?? nameEn,
      english_name: nameEn && nameEn !== nameAr ? nameEn : null,
      price: clean(row["price"]),
      stock: stockRaw,
      section: clean(row["category (export only)"]) ?? clean(row["category"]),
      category: clean(row["subcategory (export only)"]) ?? clean(row["group (export only)"]),
      language: null,
      age: null,
      series: null,
      publisher: null,
      author: null,
      link: clean(row["slug_ar"]) ?? clean(row["slug"]),
      release_date: null,
      description: clean(row["description_ar"]) ?? clean(row["description"]),
      image: clean(row["main_image"]),
      barcode: clean(row["barcode"]),
      stock_qty: isNaN(stockNum) ? null : Math.max(Math.round(stockNum - reserved), 0),
      vendor: clean(row["brand"]) ?? clean(row["vendor"]) ?? clean(row["publisher"]),
      weight_kg: parseWeightKg(row["weight"]),
    };

    // book metadata lives in the attribute_name/value_N pairs. Every pair
    // is kept in `attributes` even when it has no column, so an attribute
    // the platform adds later is still stored rather than dropped.
    const attributes: Record<string, string> = {};
    for (let n = 1; n <= 18; n++) {
      const attrName = clean(row[`attribute_name_${n}`]);
      if (!attrName) continue;
      const value = clean(row[`attribute_value_ar_${n}`]) ?? clean(row[`attribute_value_${n}`]);
      if (!value) continue;
      attributes[attrName] = value;
      const field = ATTR_MAP[attrKey(attrName)] ?? ATTR_MAP[attrName];
      if (field && !book[field]) book[field] = value;
    }
    if (Object.keys(attributes).length) book.attributes = attributes;

    out.push(book);
  }
  return out;
}

// Flexible products/catalog file parser: matches columns by Arabic or
// English header names; SKU column required. Detects the platform's
// FullProductExport automatically.
export function parseCatalogFile(data: ArrayBuffer): CatalogBook[] {
  const wb = XLSX.read(data, { type: "array", raw: false });
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { raw: false, defval: null });
    if (!rows.length) continue;
    if ("variant_sku" in rows[0] || "main_sku" in rows[0]) {
      const out = buildFromFullExport(rows);
      if (out.length) return out;
    }
    const out = buildBooks(rows);
    if (out.length) return out;
  }
  return [];
}

// Parses the inventory-report HTML: scans every <table>, picks those whose
// header contains a SKU column, and maps them like a spreadsheet.
export function parseCatalogHtml(html: string): CatalogBook[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tables = Array.from(doc.querySelectorAll("table"));
  let best: CatalogBook[] = [];
  for (const table of tables) {
    const headerCells = Array.from(table.querySelectorAll("thead th, tr:first-child th"));
    if (!headerCells.length) continue;
    const headers = headerCells.map((th) => (th.textContent ?? "").trim());
    if (!headers.some((h) => h.toLowerCase().includes("sku") || h.includes("الكود"))) continue;

    const rows: Record<string, unknown>[] = [];
    for (const tr of Array.from(table.querySelectorAll("tbody tr"))) {
      const cells = Array.from(tr.querySelectorAll("td"));
      if (!cells.length) continue;
      const row: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        row[h || `col${i}`] = cells[i] ? (cells[i].textContent ?? "").trim() : null;
      });
      rows.push(row);
    }
    const books = buildBooks(rows);
    if (books.length > best.length) best = books;
  }
  return best;
}
