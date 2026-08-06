import * as XLSX from "xlsx";

// Parsers for the platform's abandoned-cart exports:
//  * customers_abandoned_cart_export  -> one row per abandoned CART
//  * customer_cart_export             -> one row per cart ITEM
//  * revenue_lost_to_abandoned_carts_over_time         -> daily totals
//  * average_revenue_lost_to_abandoned_carts_over_time -> daily averages
// All four can be re-uploaded any time; imports are idempotent upserts.

export interface AbandonedCartRow {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  products_count: string | null;
  skus: string | null; // comma separated, trimmed
  cart_value: string | null;
  created_at: string | null;
  cart_updated_at: string | null;
  notified_at: string | null;
  user_ip: string | null;
  user_agent: string | null;
  web_url: string | null;
}

export interface AbandonedItemRow {
  cart_name: string | null;
  sku: string | null;
  product_name: string | null;
  qty: string | null;
  email: string | null;
  phone: string | null;
  created_at: string | null;
}

export interface AbandonedDailyRow {
  day: string;
  lost_value?: string | null;
  avg_cart_value?: string | null;
}

export type AbandonedParsed =
  | { kind: "carts"; carts: AbandonedCartRow[] }
  | { kind: "items"; items: AbandonedItemRow[] }
  | { kind: "daily"; daily: AbandonedDailyRow[]; metric: "lost" | "avg" };

const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// "July 22, 2026, 12 PM" / "July 01, 2025" -> ISO string (Egypt wall
// time stored as UTC, same convention as orders).
export function parseAbandonedDate(v: unknown): string | null {
  const s = clean(v);
  if (!s) return null;
  const m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(?:,\s*(\d{1,2})\s*(AM|PM))?$/i);
  if (!m) {
    // already ISO-ish?
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s : null;
  }
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  let hour = 0;
  if (m[4]) {
    hour = parseInt(m[4], 10) % 12;
    if (m[5].toUpperCase() === "PM") hour += 12;
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p(month)}-${p(day)}T${p(hour)}:00:00Z`;
}

const dateOnly = (v: unknown): string | null => {
  const iso = parseAbandonedDate(v);
  return iso ? iso.slice(0, 10) : null;
};

export function parseAbandonedAny(data: ArrayBuffer): AbandonedParsed | null {
  const wb = XLSX.read(data, { type: "array", raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: null });
  if (!rows.length) return null;
  const first = rows[0];

  // carts export: has Cart Value + Products skus
  if ("Cart Value" in first && "Products skus" in first) {
    const carts: AbandonedCartRow[] = [];
    for (const r of rows) {
      const created = parseAbandonedDate(r["Created At"]);
      if (!created) continue;
      const skus = clean(r["Products skus"])
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(",") ?? null;
      carts.push({
        full_name: clean(r["Full Name"]),
        email: clean(r["User Email"]),
        phone: clean(r["User Phone"]),
        products_count: clean(r["Products Count"]),
        skus,
        cart_value: clean(r["Cart Value"])?.replace(/,/g, "") ?? null,
        created_at: created,
        cart_updated_at: parseAbandonedDate(r["Updated At"]),
        notified_at: parseAbandonedDate(r["Notified At"]),
        user_ip: clean(r["User Ip"]),
        user_agent: clean(r["User Agent"]),
        web_url: clean(r["Web Url"]),
      });
    }
    return carts.length ? { kind: "carts", carts } : null;
  }

  // items export: has Product sku + Amount
  if ("Product sku" in first || ("Product Name" in first && "Amount" in first)) {
    const items: AbandonedItemRow[] = [];
    for (const r of rows) {
      const name = [clean(r["First Name"]), clean(r["Last Name"])].filter(Boolean).join(" ") || null;
      items.push({
        cart_name: name,
        sku: clean(r["Product sku"]),
        product_name: clean(r["Product Name"]),
        qty: clean(r["Amount"]),
        email: clean(r["User Email"]),
        phone: clean(r["User Phone"]),
        created_at: parseAbandonedDate(r["Created At"]),
      });
    }
    const valid = items.filter((i) => i.sku || i.product_name);
    return valid.length ? { kind: "items", items: valid } : null;
  }

  // daily exports: Day + (Cart Value | Cart Average Value)
  if ("Day" in first && ("Cart Value" in first || "Cart Average Value" in first)) {
    const metric: "lost" | "avg" = "Cart Average Value" in first ? "avg" : "lost";
    const daily: AbandonedDailyRow[] = [];
    for (const r of rows) {
      const day = dateOnly(r["Day"]);
      if (!day) continue;
      const val = clean(r[metric === "avg" ? "Cart Average Value" : "Cart Value"])?.replace(/,/g, "") ?? null;
      daily.push(metric === "avg" ? { day, avg_cart_value: val } : { day, lost_value: val });
    }
    return daily.length ? { kind: "daily", daily, metric } : null;
  }

  return null;
}
