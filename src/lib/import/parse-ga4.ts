export interface Ga4Row {
  period_month: string; // YYYY-MM-01
  page_path: string;
  views: number | null;
  active_users: number | null;
  views_per_user: number | null;
  avg_engagement_secs: number | null;
  event_count: number | null;
  add_to_carts: number | null;
  key_events: number | null;
  total_revenue: number | null;
  bounce_rate: number | null;
  engagement_rate: number | null;
}

export interface Ga4Parsed {
  month: string;
  rows: Ga4Row[];
}

function num(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = parseFloat(v.replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

// Minimal CSV line splitter handling quoted fields
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export interface Ga4Transaction {
  transaction_id: string;
  period_month: string;
  purchases: number | null;
  revenue: number | null;
}

export interface Ga4Item {
  period_month: string;
  item_name: string;
  items_viewed: number | null;
  items_added: number | null;
  items_purchased: number | null;
  item_revenue: number | null;
}

export type Ga4AnyParsed =
  | { kind: "pages"; month: string; spanDays: number; rows: Ga4Row[] }
  | { kind: "transactions"; month: string; spanDays: number; transactions: Ga4Transaction[] }
  | { kind: "items"; month: string; spanDays: number; items: Ga4Item[] };

// GA4 sometimes exports transaction ids as "NM000024492" while the store
// uses plain "24492" — normalize both sides to bare digits for matching.
export function normalizeTxId(id: string): string {
  const digits = id.replace(/\D/g, "").replace(/^0+/, "");
  return digits || id;
}

// Detects and parses any of the three GA4 exports we support:
// Pages & screens, Transactions, Ecommerce purchases (Item name).
export function parseGa4Any(text: string): Ga4AnyParsed | null {
  const lines = text.split(/\r?\n/);
  let month: string | null = null;
  let endDate: Date | null = null;
  let startDate: Date | null = null;
  let headerIdx = -1;
  let kind: "pages" | "transactions" | "items" | null = null;

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    const m = line.match(/#\s*Start date:\s*(\d{4})(\d{2})(\d{2})/i);
    if (m) {
      month = `${m[1]}-${m[2]}-01`;
      startDate = new Date(`${m[1]}-${m[2]}-${m[3]}`);
    }
    const e = line.match(/#\s*End date:\s*(\d{4})(\d{2})(\d{2})/i);
    if (e) endDate = new Date(`${e[1]}-${e[2]}-${e[3]}`);
    if (!line.startsWith("#")) {
      const lower = line.toLowerCase();
      if (lower.includes("page path")) { kind = "pages"; headerIdx = i; break; }
      if (lower.includes("transaction id")) { kind = "transactions"; headerIdx = i; break; }
      if (lower.includes("item name")) { kind = "items"; headerIdx = i; break; }
    }
  }
  if (!month || headerIdx === -1 || !kind) return null;
  const spanDays =
    startDate && endDate ? Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1 : 31;

  if (kind === "pages") {
    const parsed = parseGa4File(text);
    return parsed ? { kind: "pages", month: parsed.month, spanDays, rows: parsed.rows } : null;
  }

  if (kind === "transactions") {
    const seen = new Set<string>();
    const transactions: Ga4Transaction[] = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      if (!lines[i].trim() || lines[i].startsWith("#")) continue;
      const c = splitCsv(lines[i]);
      const raw = c[0]?.trim();
      if (!raw || raw === "0") continue;
      const id = normalizeTxId(raw);
      if (!id || id === "0" || seen.has(id)) continue;
      seen.add(id);
      transactions.push({ transaction_id: id, period_month: month, purchases: num(c[1]), revenue: num(c[2]) });
    }
    return { kind: "transactions", month, spanDays, transactions };
  }

  const seen = new Set<string>();
  const items: Ga4Item[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim() || lines[i].startsWith("#")) continue;
    const c = splitCsv(lines[i]);
    const name = c[0]?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    items.push({
      period_month: month,
      item_name: name,
      items_viewed: num(c[1]),
      items_added: num(c[2]),
      items_purchased: num(c[3]),
      item_revenue: num(c[4]),
    });
  }
  return { kind: "items", month, spanDays, items };
}

// Parses a GA4 "Pages and screens" CSV export. The month is auto-detected
// from the "# Start date: YYYYMMDD" comment line.
export function parseGa4File(text: string): Ga4Parsed | null {
  const lines = text.split(/\r?\n/);
  let month: string | null = null;
  let headerIdx = -1;

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    const m = line.match(/#\s*Start date:\s*(\d{4})(\d{2})(\d{2})/i);
    if (m) month = `${m[1]}-${m[2]}-01`;
    if (!line.startsWith("#") && line.toLowerCase().includes("page path")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return null;
  if (!month) return null;

  const header = splitCsv(lines[headerIdx]).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.findIndex((h) => h.includes(name));
  const idx = {
    path: col("page path"),
    views: col("views"),
    users: col("active users"),
    vpu: col("views per active user"),
    eng: col("average engagement"),
    events: col("event count"),
    atc: col("add to carts"),
    key: col("key events"),
    rev: col("total revenue"),
    bounce: col("bounce rate"),
    engRate: col("engagement rate"),
  };
  if (idx.path === -1) return null;

  const rows: Ga4Row[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.startsWith("#")) continue;
    const cells = splitCsv(line);
    const path = cells[idx.path]?.trim();
    if (!path) continue;
    rows.push({
      period_month: month,
      page_path: path,
      views: num(cells[idx.views]),
      active_users: num(cells[idx.users]),
      views_per_user: num(cells[idx.vpu]),
      avg_engagement_secs: num(cells[idx.eng]),
      event_count: num(cells[idx.events]),
      add_to_carts: num(cells[idx.atc]),
      key_events: num(cells[idx.key]),
      total_revenue: num(cells[idx.rev]),
      bounce_rate: num(cells[idx.bounce]),
      engagement_rate: num(cells[idx.engRate]),
    });
  }
  return { month, rows };
}
