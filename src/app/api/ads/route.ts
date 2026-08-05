import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api-auth";

export const maxDuration = 60;

// All Ads Center writes go through here so every change lands in the audit log.
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "manager"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const db = user.supabase;

  const audit = async (action: string, details: Record<string, unknown>) => {
    await db.from("audit_log").insert({
      user_id: user.id,
      user_email: user.email,
      action,
      details,
    });
  };

  // ---- import one Meta report (one account × one reporting period) --------
  if (body.action === "import") {
    const rows = (body.rows ?? []) as Record<string, unknown>[];
    const account = String(body.account ?? "").trim();
    const start = String(body.periodStart ?? "");
    const end = String(body.periodEnd ?? "");
    if (!rows.length) return NextResponse.json({ error: "No rows" }, { status: 400 });
    if (!account || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return NextResponse.json({ error: "Account and reporting period are required" }, { status: 400 });
    }
    if (start > end) return NextResponse.json({ error: "Period start is after period end" }, { status: 400 });

    const { data, error } = await db.rpc("fn_ads_import", {
      p_account: account,
      p_start: start,
      p_end: end,
      p_file: body.fileName ?? null,
      p_rows: rows,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await audit("import_ads", { account, period: `${start}..${end}`, rows: rows.length, file: body.fileName ?? null });
    return NextResponse.json({ ok: true, result: data });
  }

  // ---- link an ad (or a whole campaign) to the book it promotes -----------
  if (body.action === "map") {
    const rawName = String(body.rawName ?? "").trim();
    if (!rawName) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    const skus = Array.isArray(body.skus)
      ? (body.skus as unknown[]).map((s) => String(s).trim()).filter(Boolean)
      : null;
    const { data, error } = await db.rpc("fn_ads_map_set", {
      p_match_level: body.matchLevel === "campaign" ? "campaign" : "ad",
      p_raw_name: rawName,
      p_book_label: String(body.bookLabel ?? "").trim() || rawName,
      p_skus: skus && skus.length ? skus : null,
      p_keyword: body.keyword ? String(body.keyword).trim() : null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit("map_ad_book", { name: rawName, book: body.bookLabel, skus: skus?.length ?? 0 });
    return NextResponse.json({ ok: true, id: data });
  }

  if (body.action === "map_toggle") {
    if (!body.id) return NextResponse.json({ error: "Invalid" }, { status: 400 });
    const { error } = await db.from("ad_book_map").update({ active: !!body.active }).eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "map_delete") {
    if (!body.id) return NextResponse.json({ error: "Invalid" }, { status: 400 });
    const { error } = await db.from("ad_book_map").delete().eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit("delete_ad_map", { id: body.id });
    return NextResponse.json({ ok: true });
  }

  // ---- break-even / target thresholds shared by the whole team ------------
  if (body.action === "settings") {
    const v = body.value ?? {};
    const clean = {
      gross_margin_pct: Math.min(Math.max(Number(v.gross_margin_pct) || 35, 1), 95),
      target_roas: Math.min(Math.max(Number(v.target_roas) || 3, 0.5), 20),
      min_spend: Math.max(Number(v.min_spend) || 0, 0),
      frequency_cap: Math.min(Math.max(Number(v.frequency_cap) || 3.5, 1), 20),
    };
    const { error } = await db.rpc("fn_ads_settings_set", { p_value: clean });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit("ads_settings", clean);
    return NextResponse.json({ ok: true, value: clean });
  }

  // ---- remove a whole imported period (snapshotted into the owner's trash)
  if (body.action === "delete_import") {
    if (!body.importId) return NextResponse.json({ error: "Invalid" }, { status: 400 });
    const { error } = await db.rpc("trash_ad_import", { p_import_id: body.importId });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
