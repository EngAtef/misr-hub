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

  // ---- connect an ad (or a whole campaign) to what it actually sells -------
  // Three doors: a custom list, a pasted link, or hand-picked SKUs. A link
  // that resolves to a known list is stored as a list mapping by the RPC, so
  // the attribution engine only ever sees "these SKUs".
  if (body.action === "map") {
    const rawName = String(body.rawName ?? "").trim();
    if (!rawName) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    const targetKind = ["book", "list", "link"].includes(String(body.targetKind))
      ? String(body.targetKind)
      : "book";
    const destUrl = body.destUrl ? String(body.destUrl).trim().slice(0, 2000) : null;
    if (targetKind === "list" && !body.listKey) {
      return NextResponse.json({ error: "Pick a custom list" }, { status: 400 });
    }
    if (targetKind === "link" && !destUrl) {
      return NextResponse.json({ error: "Paste the ad's link" }, { status: 400 });
    }
    const skus = Array.isArray(body.skus)
      ? (body.skus as unknown[]).map((s) => String(s).trim()).filter(Boolean)
      : null;
    const { data, error } = await db.rpc("fn_ads_map_set", {
      p_match_level: body.matchLevel === "campaign" ? "campaign" : "ad",
      p_raw_name: rawName,
      p_book_label: String(body.bookLabel ?? "").trim() || null,
      p_skus: targetKind === "list" || !skus?.length ? null : skus,
      p_keyword: body.keyword ? String(body.keyword).trim() : null,
      p_target_kind: targetKind,
      p_list_key: body.listKey ? String(body.listKey) : null,
      p_dest_url: destUrl,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit("map_ad_book", {
      name: rawName,
      book: body.bookLabel,
      kind: targetKind,
      list: body.listKey ?? null,
      url: destUrl,
      skus: skus?.length ?? 0,
    });
    return NextResponse.json({ ok: true, id: data });
  }

  // ---- connect every ad whose own link points at a list we already know ----
  if (body.action === "autolink") {
    const { data, error } = await db.rpc("fn_ads_autolink");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit("ads_autolink", (data ?? {}) as Record<string, unknown>);
    return NextResponse.json({ ok: true, result: data });
  }

  // ---- custom lists: the destinations the ads link to ---------------------
  if (body.action === "list_import") {
    const lists = (Array.isArray(body.lists) ? body.lists : []) as {
      list_id?: number | null;
      name?: string;
      items?: unknown[];
    }[];
    if (!lists.length) return NextResponse.json({ error: "No lists" }, { status: 400 });
    if (!lists.some((l) => (l.items?.length ?? 0) > 0)) {
      return NextResponse.json({ error: "No products in the file" }, { status: 400 });
    }
    const { data, error } = await db.rpc("fn_custom_lists_import", {
      p_file: body.fileName ?? null,
      p_lists: lists,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit("import_custom_lists", {
      file: body.fileName ?? null,
      lists: lists.length,
      ids: lists.map((l) => l.list_id ?? null),
      result: data,
    });
    return NextResponse.json({ ok: true, result: data });
  }

  // rename a list, or attach the slug its ads link to (a full URL is fine)
  if (body.action === "list_set") {
    if (!body.id) return NextResponse.json({ error: "Invalid" }, { status: 400 });
    const { error } = await db.rpc("fn_custom_list_set", {
      p_id: String(body.id),
      p_name: body.name === undefined ? null : String(body.name).trim().slice(0, 200),
      // "" deliberately clears the slug; undefined leaves it untouched
      p_slug: body.slug === undefined ? null : String(body.slug).trim().slice(0, 300),
      p_note: body.note === undefined ? null : String(body.note).trim().slice(0, 500),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit("custom_list_set", { id: body.id, name: body.name, slug: body.slug });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "list_delete") {
    if (!body.id) return NextResponse.json({ error: "Invalid" }, { status: 400 });
    // the list is a re-uploadable snapshot, so no trash copy — but any ad
    // pointing at it falls back to unmapped rather than silently keeping SKUs
    const { error } = await db.from("custom_lists").delete().eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit("custom_list_delete", { id: body.id });
    return NextResponse.json({ ok: true });
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
