import * as XLSX from "xlsx";

export interface ParsedOrder {
  order: Record<string, unknown>;
  items: { position: number; product_name: string | null; sku: string | null; price: number | null }[];
  events: { seq: number; state_name: string | null; admin_name: string | null; state_date: string | null }[];
}

export interface ParseResult {
  orders: ParsedOrder[];
  totalRows: number;
  skippedRows: number;
}

// Maps export column headers -> orders table columns
const COLUMN_MAP: Record<string, string> = {
  "Order number": "order_number",
  "Customer ID": "customer_id",
  AWBnumber: "awb_number",
  "ERP Sales order number": "erp_sales_order_number",
  "Order Date": "order_date",
  "Shipping date": "shipping_date",
  "Delivery date": "delivery_date",
  "Delivery status": "delivery_status",
  "Order status": "order_status",
  "Payment method": "payment_method",
  "Plan Installment": "plan_installment",
  "Accept Transaction number": "transaction_number",
  "ERP Customer account number": "erp_customer_account",
  "Full Customer name": "customer_name",
  "Customer phone number": "customer_phone",
  "Customer IP": "customer_ip",
  "Is Bundle": "is_bundle",
  "Promo amount": "promo_amount",
  "Actual Delivery Fees": "actual_delivery_fees",
  "Original Delivery Fees": "original_delivery_fees",
  "Purchase Fees": "purchase_fees",
  "Provider Purchase Fees": "provider_purchase_fees",
  "Total Cart amount": "total_cart_amount",
  "Total Order Amount": "total_order_amount",
  "Online Paid Amount": "online_paid_amount",
  "Total Cash Amount": "total_cash_amount",
  "Loyalty Discount": "loyalty_discount",
  "COD amount": "cod_amount",
  "insurance amount": "insurance_amount",
  "Branch Name": "branch_name",
  "Address Name": "address_name",
  City: "city",
  Area: "area",
  District: "district",
  "Full Address": "full_address",
  "Customer Notes": "customer_notes",
  "Admin Notes": "admin_notes",
  "Cancellation Reason": "cancellation_reason",
  "Cancellation Note": "cancellation_note",
  "Store Name": "store_name",
  "Time Slot": "time_slot",
  Source: "source",
  "Created by": "created_by",
  "Applied Offer": "applied_offer",
  "Applied Promotion": "applied_promotion",
  "Campaign Id": "campaign_id",
  "ERP Send Date": "erp_send_date",
  "Erp Delivery Number": "erp_delivery_number",
  "Customer Rating": "customer_rating",
  "Driver Rating": "driver_rating",
};

const DATE_COLUMNS = new Set([
  "order_date",
  "shipping_date",
  "delivery_date",
  "erp_send_date",
]);

const NUMERIC_COLUMNS = new Set([
  "promo_amount",
  "actual_delivery_fees",
  "original_delivery_fees",
  "purchase_fees",
  "provider_purchase_fees",
  "total_cart_amount",
  "total_order_amount",
  "online_paid_amount",
  "total_cash_amount",
  "loyalty_discount",
  "cod_amount",
  "insurance_amount",
  "customer_rating",
  "driver_rating",
]);

function cleanText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "" || s === "-") return null;
  return s;
}

function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  const s = String(v).trim().replace(/,/g, "");
  if (s === "" || s === "-") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Handles "05-07-26 13:03 PM" (DD-MM-YY, 24h hour with literal AM/PM),
// Excel date serials, and JS Dates.
function parseExportDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "number") {
    // Excel serial date (days since 1899-12-30)
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const s = String(v).trim();
  if (s === "" || s === "-") return null;
  const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    let hour = m[4] ? parseInt(m[4], 10) : 0;
    const minute = m[5] ? parseInt(m[5], 10) : 0;
    const second = m[6] ? parseInt(m[6], 10) : 0;
    const meridiem = m[7]?.toUpperCase();
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    if (hour > 23) hour = hour % 24;
    const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function splitPipe(v: unknown): string[] {
  const s = cleanText(v);
  if (!s) return [];
  return s.split("|").map((x) => x.trim());
}

export function parseOrdersWorkbook(data: ArrayBuffer): ParseResult {
  const wb = XLSX.read(data, { type: "array", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: null });

  const orders: ParsedOrder[] = [];
  let skippedRows = 0;
  const seen = new Set<string>();

  for (const row of rows) {
    const orderNumber = cleanText(row["Order number"]);
    if (!orderNumber) {
      skippedRows++;
      continue;
    }
    if (seen.has(orderNumber)) {
      skippedRows++;
      continue;
    }
    seen.add(orderNumber);

    const order: Record<string, unknown> = {};
    for (const [header, column] of Object.entries(COLUMN_MAP)) {
      const raw = row[header];
      if (column === "is_bundle") {
        const s = cleanText(raw);
        order[column] = s ? ["1", "true", "yes"].includes(s.toLowerCase()) : null;
      } else if (DATE_COLUMNS.has(column)) {
        order[column] = parseExportDate(raw);
      } else if (NUMERIC_COLUMNS.has(column)) {
        order[column] = parseNumber(raw);
      } else {
        order[column] = cleanText(raw);
      }
    }

    // Pipe-separated product columns -> order_items
    const names = splitPipe(row["Product name"]);
    const skus = splitPipe(row["Product Sku"]);
    const prices = splitPipe(row["Items Prices"]);
    const count = Math.max(names.length, skus.length, prices.length);
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push({
        position: i + 1,
        product_name: names[i] || null,
        sku: skus[i] || null,
        price: prices[i] !== undefined ? parseNumber(prices[i]) : null,
      });
    }
    order["items_count"] = items.length;

    // state_name_1..29 -> order_events
    const events = [];
    for (let i = 1; i <= 29; i++) {
      const state = cleanText(row[`state_name_${i}`]);
      if (!state) continue;
      events.push({
        seq: i,
        state_name: state,
        admin_name: cleanText(row[`admin_name_${i}`]),
        state_date: parseExportDate(row[`state_date_${i}`]),
      });
    }

    orders.push({ order, items, events });
  }

  return { orders, totalRows: rows.length, skippedRows };
}

export function hasOrderNumberColumn(data: ArrayBuffer): boolean {
  const wb = XLSX.read(data, { type: "array", sheetRows: 2 });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: null });
  if (!rows.length) return false;
  return "Order number" in rows[0];
}
