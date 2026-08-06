import * as XLSX from "xlsx";

export interface TargetRowImport {
  period_month: string; // YYYY-MM-01
  quarter: string | null;
  label: string | null;
  total_target: number;
  kids_target: number;
  cultural_target: number;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseMonthCell(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-01`;
  }
  const s = String(v).trim();
  // "Jul-25", "Jul-2025", "July 25"
  const m = s.match(/^([A-Za-z]{3,9})[\s-]+(\d{2,4})$/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (!mon) return null;
    let year = parseInt(m[2], 10);
    if (year < 100) year += 2000;
    return `${year}-${String(mon).padStart(2, "0")}-01`;
  }
  // "2025-07" or "2025-07-01"
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-01`;
  // Excel serial
  const n = parseFloat(s);
  if (!isNaN(n) && n > 40000 && n < 60000) {
    const d = new Date(Math.round((n - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  return null;
}

function parseMoney(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[^0-9.]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// Parses the Target-e-com sheet: header row contains Month + Total columns
// (Q | Month | Note | Total / Month | Kids | Cultural | ...)
export function parseTargetsFile(data: ArrayBuffer): TargetRowImport[] {
  const wb = XLSX.read(data, { type: "array", raw: false });

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: null });
    // find the header row
    let headerIdx = -1;
    for (let i = 0; i < Math.min(grid.length, 10); i++) {
      const cells = (grid[i] ?? []).map((c) => String(c ?? "").toLowerCase());
      if (cells.some((c) => c.includes("month")) && cells.some((c) => c.includes("total"))) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) continue;

    const header = (grid[headerIdx] as unknown[]).map((c) => String(c ?? "").toLowerCase().trim());
    const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
    const idx = {
      q: col("q"),
      month: col("month"),
      note: col("note"),
      total: col("total"),
      kids: col("kids"),
      cultural: col("cultural"),
    };
    if (idx.month === -1 || idx.total === -1) continue;

    const out: TargetRowImport[] = [];
    const seen = new Set<string>();
    for (let i = headerIdx + 1; i < grid.length; i++) {
      const row = grid[i] as unknown[];
      if (!row) continue;
      const month = parseMonthCell(row[idx.month]);
      if (!month || seen.has(month)) continue;
      const total = parseMoney(row[idx.total]);
      if (total <= 0) continue;
      seen.add(month);
      out.push({
        period_month: month,
        quarter: idx.q !== -1 && row[idx.q] ? String(row[idx.q]).trim() : null,
        label: idx.note !== -1 && row[idx.note] ? String(row[idx.note]).trim() : null,
        total_target: total,
        kids_target: idx.kids !== -1 ? parseMoney(row[idx.kids]) : 0,
        cultural_target: idx.cultural !== -1 ? parseMoney(row[idx.cultural]) : 0,
      });
    }
    if (out.length) return out;
  }
  return [];
}
