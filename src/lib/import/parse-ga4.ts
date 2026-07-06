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
