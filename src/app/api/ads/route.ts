import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api-auth";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "manager"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const db = user.supabase;

  if (body.action === "import") {
    const rows = (body.rows ?? []) as Record<string, unknown>[];
    const batchLabel = String(body.batchLabel ?? "").trim() || null;
    if (!rows.length) return NextResponse.json({ error: "No rows" }, { status: 400 });

    // Re-uploading the same file replaces its batch instead of duplicating it
    if (batchLabel) {
      await db.from("ad_spend").delete().eq("batch_label", batchLabel);
    }

    const payload = rows.map((r) => ({ ...r, batch_label: batchLabel, imported_by: user.id }));
    const { error } = await db.from("ad_spend").insert(payload);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await db.from("audit_log").insert({
      user_id: user.id,
      user_email: user.email,
      action: "import_ads",
      details: { rows: rows.length, batch: batchLabel },
    });

    return NextResponse.json({ ok: true, inserted: rows.length });
  }

  if (body.action === "update") {
    const { id, match_keyword, mapped_sku } = body;
    if (!id) return NextResponse.json({ error: "Invalid" }, { status: 400 });
    const { error } = await db
      .from("ad_spend")
      .update({ match_keyword: match_keyword ?? null, mapped_sku: mapped_sku ?? null })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "clear_batch") {
    // snapshots the whole batch into the owner's trash before deleting
    const { error } = await db.rpc("trash_ad_batch", { p_batch_label: body.batchLabel });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
