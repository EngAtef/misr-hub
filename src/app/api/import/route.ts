import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api-auth";

export const maxDuration = 60;

interface ImportChunkOrder {
  order: Record<string, unknown>;
  items: { position: number; product_name: string | null; sku: string | null; price: number | null }[];
  events: { seq: number; state_name: string | null; admin_name: string | null; state_date: string | null }[];
}

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "manager"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const db = user.supabase;

  if (body.action === "start") {
    const { data, error } = await db
      .from("uploads")
      .insert({
        file_name: String(body.fileName ?? "unknown.xlsx"),
        uploaded_by: user.id,
        uploaded_by_email: user.email,
        total_rows: Number(body.totalRows ?? 0),
        status: "processing",
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ uploadId: data.id });
  }

  if (body.action === "chunk") {
    const orders = (body.orders ?? []) as ImportChunkOrder[];
    if (!orders.length) return NextResponse.json({ processed: 0 });

    const orderRows = orders.map((o) => o.order);
    const orderNumbers = orderRows.map((o) => String(o.order_number));

    const { error: orderError } = await db
      .from("orders")
      .upsert(orderRows, { onConflict: "order_number" });
    if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });

    // Replace items/events for re-imported orders
    const { error: delItemsError } = await db
      .from("order_items")
      .delete()
      .in("order_number", orderNumbers);
    if (delItemsError) return NextResponse.json({ error: delItemsError.message }, { status: 500 });

    const { error: delEventsError } = await db
      .from("order_events")
      .delete()
      .in("order_number", orderNumbers);
    if (delEventsError) return NextResponse.json({ error: delEventsError.message }, { status: 500 });

    const itemRows = orders.flatMap((o) =>
      o.items.map((it) => ({ ...it, order_number: String(o.order.order_number) }))
    );
    if (itemRows.length) {
      const { error } = await db.from("order_items").insert(itemRows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const eventRows = orders.flatMap((o) =>
      o.events.map((ev) => ({ ...ev, order_number: String(o.order.order_number) }))
    );
    if (eventRows.length) {
      const { error } = await db.from("order_events").insert(eventRows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ processed: orders.length });
  }

  if (body.action === "finish") {
    const status = body.failedRows > 0 && body.processedRows === 0 ? "failed" : "completed";
    await db
      .from("uploads")
      .update({
        processed_rows: Number(body.processedRows ?? 0),
        failed_rows: Number(body.failedRows ?? 0),
        status,
        error_message: body.errorMessage ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", body.uploadId);

    await db.from("audit_log").insert({
      user_id: user.id,
      user_email: user.email,
      action: "import_orders",
      details: {
        file_name: body.fileName,
        processed_rows: body.processedRows,
        failed_rows: body.failedRows,
      },
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
