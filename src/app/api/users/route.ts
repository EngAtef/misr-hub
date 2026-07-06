import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api-auth";

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const db = user.supabase;

  if (body.action === "create") {
    const { email, password, fullName, phone, role } = body;
    if (!email || !password || !["admin", "manager", "viewer"].includes(role)) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    let { data, error } = await db.rpc("admin_create_user", {
      p_email: email,
      p_password: password,
      p_full_name: fullName ?? "",
      p_role: role,
      p_phone: phone || null,
    });
    // Fallback for databases where migration 012 (p_phone) isn't applied yet
    if (error && /function|p_phone|does not exist/i.test(error.message)) {
      ({ data, error } = await db.rpc("admin_create_user", {
        p_email: email,
        p_password: password,
        p_full_name: fullName ?? "",
        p_role: role,
      }));
      if (!error && data && phone) {
        await db.from("profiles").update({ phone }).eq("id", data);
      }
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await db.from("audit_log").insert({
      user_id: user.id,
      user_email: user.email,
      action: "create_user",
      details: { email, role },
    });

    return NextResponse.json({ ok: true, userId: data });
  }

  if (body.action === "update") {
    const { userId, role, isActive } = body;
    if (!userId) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    if (userId === user.id && (role !== "admin" || isActive === false)) {
      return NextResponse.json({ error: "You cannot demote or deactivate yourself" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (role && ["admin", "manager", "viewer"].includes(role)) updates.role = role;
    if (typeof isActive === "boolean") updates.is_active = isActive;

    const { error } = await db.from("profiles").update(updates).eq("id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await db.from("audit_log").insert({
      user_id: user.id,
      user_email: user.email,
      action: "update_user",
      details: { target_user: userId, ...updates },
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
