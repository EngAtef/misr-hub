import * as XLSX from "xlsx";

// Row shape matches fn_upsert_promo_codes(p_rows jsonb).
// type: 1 = fixed EGP, 2 = percent, 3 = free delivery, 4 = gift.
export interface PromoRow {
  id: string;
  name: string;
  description: string | null;
  amount: string | null;
  minimum_order_amount: string | null;
  type: string | null;
  uses: string | null;
  start_date: string | null;
  expiration_date: string | null;
  max_uses_per_user: string | null;
  max_usage_limit: string | null;
  free_delivery: string | null;
  active: string | null;
}

const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "-" ? null : s;
};

const cleanNumber = (v: unknown): string | null => {
  const s = clean(v);
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, ""));
  return isNaN(n) ? null : String(n);
};

// "2025-01-01 00:00:00" -> ISO
const cleanDate = (v: unknown): string | null => {
  const s = clean(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
  return isNaN(d.getTime()) ? null : d.toISOString();
};

// Parses the platform Promos export — one row per promo code
// (id, name, amount, minimum_order_amount, type, uses, dates, flags).
// Orders reference codes via applied_offer = name.
export function parsePromosFile(data: ArrayBuffer): PromoRow[] {
  const wb = XLSX.read(data, { type: "array", raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: null });
  if (!rows.length || !("id" in rows[0]) || !("name" in rows[0])) return [];

  const out: PromoRow[] = [];
  for (const r of rows) {
    const id = cleanNumber(r["id"]);
    const name = clean(r["name"]);
    if (!id || !name) continue;
    out.push({
      id,
      name,
      description: clean(r["description"]),
      amount: cleanNumber(r["amount"]),
      minimum_order_amount: cleanNumber(r["minimum_order_amount"]),
      type: cleanNumber(r["type"]),
      uses: cleanNumber(r["uses"]),
      start_date: cleanDate(r["start_date"]),
      expiration_date: cleanDate(r["expiration_date"]),
      max_uses_per_user: cleanNumber(r["max_uses_per_user"]),
      max_usage_limit: cleanNumber(r["max_usage_limit"]),
      free_delivery: cleanNumber(r["free_delivery"]),
      active: cleanNumber(r["active"]),
    });
  }
  return out;
}
