import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const admin = createAdminClient();

  if (body.action === "create") {
    const { email, password, fullName, role } = body;
    if (!email || !password || !["admin", "manager", "viewer"].includes(role)) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName ?? "", role },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // The trigger may have assigned a bootstrap role; enforce the requested one.
    await admin
      .from("profiles")
      .update({ role, full_name: fullName ?? null })
      .eq("id", data.user.id);

    await admin.from("audit_log").insert({
      user_id: user.id,
      user_email: user.email,
      action: "create_user",
      details: { email, role },
    });

    return NextResponse.json({ ok: true, userId: data.user.id });
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

    const { error } = await admin.from("profiles").update(updates).eq("id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await admin.from("audit_log").insert({
      user_id: user.id,
      user_email: user.email,
      action: "update_user",
      details: { target_user: userId, ...updates },
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
