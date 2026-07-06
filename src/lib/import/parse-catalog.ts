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
}

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
] as const;

export type CatalogField = (typeof CATALOG_FIELDS)[number];

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
};

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim().toLowerCase();
  return s === "" || s === "-" || s === "n/a" || s === "na" || s === "0000-00-00" || s === "null" || s === "لا يوجد";
}

// Flexible products/catalog file parser: matches columns by Arabic or
// English header names; SKU column required.
export function parseCatalogFile(data: ArrayBuffer): CatalogBook[] {
  const wb = XLSX.read(data, { type: "array", raw: false });

  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { raw: false, defval: null });
    if (rows.length < 2) continue;
    const keys = Object.keys(rows[0]);
    const lower = keys.map((k) => k.toLowerCase().trim());

    const skuKey = keys[lower.findIndex((k) => k.includes("sku") || k === "id" || k.includes("الكود") || k.includes("كود"))];
    if (!skuKey) continue;

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
      out.push(book);
    }
    if (out.length) return out;
  }
  return [];
}
