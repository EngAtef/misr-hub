import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const EXPORT_COLUMNS = [
  "order_number",
  "order_date",
  "order_status",
  "delivery_status",
  "payment_method",
  "customer_id",
  "customer_name",
  "customer_phone",
  "city",
  "area",
  "total_order_amount",
  "cod_amount",
  "online_paid_amount",
  "promo_amount",
  "items_count",
  "source",
  "awb_number",
  "delivery_date",
  "cancellation_reason",
  "applied_promotion",
  "campaign_id",
  "customer_rating",
  "driver_rating",
];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const from = params.get("from");
  const to = params.get("to");

  const admin = createAdminClient();
  const pageSize = 1000;
  let offset = 0;
  const lines: string[] = [EXPORT_COLUMNS.join(",")];

  for (;;) {
    let query = admin
      .from("orders")
      .select(EXPORT_COLUMNS.join(","))
      .order("order_date", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (from) query = query.gte("order_date", from);
    if (to) query = query.lt("order_date", to);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || !data.length) break;

    for (const row of data as unknown as Record<string, unknown>[]) {
      lines.push(EXPORT_COLUMNS.map((c) => csvEscape(row[c])).join(","));
    }
    if (data.length < pageSize) break;
    offset += pageSize;
    if (offset > 500000) break;
  }

  await admin.from("audit_log").insert({
    user_id: user.id,
    user_email: user.email,
    action: "export_orders",
    details: { from, to, rows: lines.length - 1 },
  });

  const csv = "﻿" + lines.join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="orders-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
