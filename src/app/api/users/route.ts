import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api-auth";
import { isStrongPassword } from "@/lib/password";

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const db = user.supabase;

  if (body.action === "create") {
    const { email, password, fullName, phone, role, mustChange } = body;
    if (!email || !password || !["admin", "manager", "viewer"].includes(role)) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    if (!isStrongPassword(password)) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters with a capital letter, a number and a special character" },
        { status: 400 }
      );
    }

    // migration 105: the RPC re-checks strength and stores the first-login flag
    const { data, error } = await db.rpc("admin_create_user", {
      p_email: email,
      p_password: password,
      p_full_name: fullName ?? "",
      p_role: role,
      p_phone: phone || null,
      p_must_change: mustChange !== false,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await db.from("audit_log").insert({
      user_id: user.id,
      user_email: user.email,
      action: "create_user",
      details: { email, role, must_change_password: mustChange !== false },
    });

    return NextResponse.json({ ok: true, userId: data });
  }

  if (body.action === "update") {
    const { userId, role, isActive } = body;
    if (!userId) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    if (userId === user.id && (role !== "admin" || isActive === false)) {
      return NextResponse.json({ error: "You cannot demote or deactivate yourself" }, { status: 400 });
    }

    // migration 130: go through the guarded RPC so the full hierarchy applies —
    // only the owner may touch the owner row, other admins, or grant admin.
    // A raw profiles update here used to slip past those checks.
    const nextRole = role && ["admin", "manager", "viewer"].includes(role) ? role : null;
    const nextActive = typeof isActive === "boolean" ? isActive : null;
    const { error } = await db.rpc("admin_update_user", {
      p_user_id: userId,
      p_role: nextRole,
      p_is_active: nextActive,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await db.from("audit_log").insert({
      user_id: user.id,
      user_email: user.email,
      action: "update_user",
      details: { target_user: userId, role: nextRole ?? undefined, is_active: nextActive ?? undefined },
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
