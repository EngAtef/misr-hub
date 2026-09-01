import * as XLSX from "xlsx";

// The SMS provider's contact-import format — the ONLY shape its importer
// accepts (verified 2026-09-01 against a file that imported vs one that
// didn't): columns PhoneNumber / FirstName / LastName / V1..V10, the phone
// as a TEXT cell holding "20" + the 10-digit mobile (a numeric cell fails
// the import), every cell present as a string, one sheet named Sheet1.
export function downloadSmsContactsXlsx(
  rows: { name?: string | null; phone?: string | null }[],
  filename: string
): number {
  const seen = new Set<string>();
  const data: string[][] = [
    ["PhoneNumber", "FirstName", "LastName", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10"],
  ];
  for (const r of rows) {
    const digits = (r.phone ?? "").replace(/\D/g, "");
    const local = digits.length >= 10 ? digits.slice(-10) : "";
    if (!/^1[0125]\d{8}$/.test(local)) continue; // valid EG mobiles only
    const msisdn = "20" + local;
    if (seen.has(msisdn)) continue;
    seen.add(msisdn);
    const name = (r.name ?? "").trim().replace(/\s+/g, " ");
    const sp = name.indexOf(" ");
    const first = sp === -1 ? name : name.slice(0, sp);
    const last = sp === -1 ? "" : name.slice(sp + 1);
    data.push([msisdn, first, last, "", "", "", "", "", "", "", "", "", ""]);
  }
  if (data.length === 1) return 0;

  const ws = XLSX.utils.aoa_to_sheet(data);
  // belt and braces: force the phone column to text formatting
  for (let R = 1; R < data.length; R++) {
    const cell = ws[XLSX.utils.encode_cell({ r: R, c: 0 })];
    if (cell) {
      cell.t = "s";
      cell.z = "@";
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
  return data.length - 1;
}
