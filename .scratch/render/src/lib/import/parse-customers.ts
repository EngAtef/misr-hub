import * as XLSX from "xlsx";

export interface CustomerRow {
  customer_id: string;
  name: string | null;
  email: string | null;
  birthdate: string | null;
  phone: string | null;
  total_orders: string | null;
  language: string | null;
  is_active: string | null;
  joined_at: string | null;
  city: string | null;
  area: string | null;
  addresses: string | null;
}

const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

// Parses the platform CustomersExport file (id, name, email, birthdate,
// contact, total_orders, language, active, Joined on, City, Area, addresses)
export function parseCustomersFile(data: ArrayBuffer): CustomerRow[] {
  const wb = XLSX.read(data, { type: "array", raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: null });
  if (!rows.length || !("id" in rows[0])) return [];

  const seen = new Set<string>();
  const out: CustomerRow[] = [];
  for (const r of rows) {
    const id = clean(r["id"]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const birth = clean(r["birthdate"]);
    out.push({
      customer_id: id,
      name: clean(r["name"]),
      email: clean(r["email"]),
      birthdate: birth && /^\d{4}-\d{2}-\d{2}/.test(birth) ? birth.slice(0, 10) : null,
      phone: clean(r["contact"]),
      total_orders: clean(r["total_orders"]),
      language: clean(r["language"]),
      is_active: clean(r["active"]),
      joined_at: clean(r["Joined on"]),
      city: clean(r["City"]),
      area: clean(r["Area"]),
      addresses: clean(r["addresses"])?.slice(0, 1000) ?? null,
    });
  }
  return out;
}
