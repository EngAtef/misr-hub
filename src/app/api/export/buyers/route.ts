import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api-auth";

export const maxDuration = 60;

const COLUMNS = [
  "customer_id",
  "customer_name",
  "customer_phone",
  "city",
  "orders_count",
  "units",
  "spend",
  "categories",
  "first_order",
  "last_order",
];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = Array.isArray(v) ? v.join(" | ") : String(v);
  // CSV-injection guard (Excel formula execution from user-entered cells)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Buyers aggregated per category (fn_category_buyers). PostgREST caps
// RPC result sets at max-rows, so page with .range() until exhausted.
export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const category = params.getAll("category").filter(Boolean);
  const subCategory = params.getAll("sub_category").filter(Boolean);
  const brand = params.getAll("brand").filter(Boolean);

  const pageSize = 1000;
  let offset = 0;
  const lines: string[] = [COLUMNS.join(",")];

  for (;;) {
    const { data, error } = await user.supabase
      .rpc("fn_category_buyers", {
        p_categories: category.length ? category : null,
        p_sub_categories: subCategory.length ? subCategory : null,
        p_brands: brand.length ? brand : null,
        p_from: from,
        p_to: to,
      })
      .range(offset, offset + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || !data.length) break;

    for (const row of data as unknown as Record<string, unknown>[]) {
      lines.push(COLUMNS.map((c) => csvEscape(row[c])).join(","));
    }
    if (data.length < pageSize) break;
    offset += pageSize;
    if (offset > 200000) break;
  }

  await user.supabase.from("audit_log").insert({
    user_id: user.id,
    user_email: user.email,
    action: "export_category_buyers",
    details: { from, to, category, sub_category: subCategory, brand, rows: lines.length - 1 },
  });

  const csv = "﻿" + lines.join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="buyers-by-category-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
