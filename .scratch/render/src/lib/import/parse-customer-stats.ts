import * as XLSX from "xlsx";

// Row shape matches fn_upsert_customer_stats(p_rows jsonb)
export interface CustomerStatsRow {
  customer_id: string;
  name: string | null;
  phone: string | null;
  lifetime_orders: string | null;
  lifetime_delivered: string | null;
  lifetime_canceled: string | null;
  lifetime_amount: string | null;
  lifetime_delivered_amount: string | null;
  lifetime_canceled_amount: string | null;
  last_order_at: string | null;
  last_order_state: string | null;
  last_delivered_at: string | null;
  city: string | null;
  area: string | null;
  addresses: string | null;
}

const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const cleanNumber = (v: unknown): string | null => {
  const s = clean(v);
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, ""));
  return isNaN(n) ? null : String(n);
};

const cleanDate = (v: unknown): string | null => {
  const s = clean(v);
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

// Parses the platform CustomerOrdersExport bulk file — one row per
// customer with full lifetime order history aggregates (ID, Name,
// Phone, Orders Count, Delivered/Canceled counts & amounts, last
// order date/state, City, Area, Addresses).
export function parseCustomerStatsFile(data: ArrayBuffer): CustomerStatsRow[] {
  const wb = XLSX.read(data, { type: "array", raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: null });
  if (!rows.length || !("ID" in rows[0]) || !("Orders Count" in rows[0])) return [];

  const seen = new Set<string>();
  const out: CustomerStatsRow[] = [];
  for (const r of rows) {
    const id = clean(r["ID"]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      customer_id: id,
      name: clean(r["Name"]),
      phone: clean(r["Phone"]),
      lifetime_orders: cleanNumber(r["Orders Count"]),
      lifetime_delivered: cleanNumber(r["Delivered Orders Count"]),
      lifetime_canceled: cleanNumber(r["Canceled Orders Count"]),
      lifetime_amount: cleanNumber(r["Orders Amount"]),
      lifetime_delivered_amount: cleanNumber(r["Delivered Orders Amount"]),
      lifetime_canceled_amount: cleanNumber(r["Canceled Orders Amount"]),
      last_order_at: cleanDate(r["Last Order Date"]),
      last_order_state: clean(r["Last Order State"]),
      last_delivered_at: cleanDate(r["Last Delivered Order Date"]),
      city: clean(r["City"]),
      area: clean(r["Area"]),
      addresses: clean(r["Addresses"])?.slice(0, 1000) ?? null,
    });
  }
  return out;
}
