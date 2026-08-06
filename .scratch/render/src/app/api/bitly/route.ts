import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "../../../lib/supabase/api-auth";
import { getUser, getGroups, BitlyError, type BitlyCreds } from "../../../lib/bitly/api";
import { syncBitly, resolveGroup } from "../../../lib/bitly/sync";

export const maxDuration = 60;

// The access token is pasted by the user into Settings → Bitly and stored in
// app_settings (admin-only RLS); it is read back here through the role-gated
// fn_bitly_config RPC and never leaves the server.
async function creds(user: Awaited<ReturnType<typeof getApiUser>>): Promise<BitlyCreds> {
  const { data } = await user!.supabase.rpc("fn_bitly_config");
  return (data ?? {}) as BitlyCreds;
}

function fail(e: unknown) {
  if (e instanceof BitlyError) {
    return NextResponse.json({ error: e.message, hint: e.hint }, { status: e.status === 429 ? 429 : 400 });
  }
  return NextResponse.json({ error: e instanceof Error ? e.message : "Bitly request failed" }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "manager"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const cfg = await creds(user);
  if (!cfg.access_token) {
    return NextResponse.json(
      { error: "No Bitly token saved yet", hint: "Settings → Integrations → Bitly" },
      { status: 400 }
    );
  }

  // ---- confirm the token works and show which account/group it belongs to
  if (body.action === "test") {
    try {
      const [me, groups] = await Promise.all([getUser(cfg), getGroups(cfg).catch(() => [])]);
      // remember the group so the user never has to find the GUID themselves
      if (!cfg.group_guid && me.default_group_guid) {
        await user.supabase.rpc("fn_bitly_config_set", { p_patch: { group_guid: me.default_group_guid } });
      }
      return NextResponse.json({
        ok: true,
        login: me.login,
        name: me.name,
        group_guid: cfg.group_guid || me.default_group_guid,
        groups: groups.map((g) => ({ guid: g.guid, name: g.name })),
      });
    } catch (e) {
      return fail(e);
    }
  }

  // ---- pull links + clicks into the app's own tables
  if (body.action === "sync") {
    const days = Math.min(Math.max(Number(body.days) || 60, 1), 365);
    const startedAt = new Date().toISOString();
    let syncId: string | null = null;
    try {
      const group = await resolveGroup(cfg);
      const { data: row } = await user.supabase
        .from("bitly_syncs")
        .insert({ started_at: startedAt, ran_by: user.id, ran_by_email: user.email })
        .select("id")
        .maybeSingle();
      syncId = (row as { id: string } | null)?.id ?? null;

      const result = await syncBitly(user.supabase, cfg, group, { days });

      if (syncId) {
        await user.supabase
          .from("bitly_syncs")
          .update({
            finished_at: new Date().toISOString(),
            links_seen: result.linksSeen,
            links_detailed: result.linksDetailed,
            days_from: result.from,
            days_to: result.to,
            ok: true,
          })
          .eq("id", syncId);
      }
      await user.supabase.from("audit_log").insert({
        user_id: user.id,
        user_email: user.email,
        action: "sync_bitly",
        details: { links: result.linksSeen, days, truncated: result.truncated },
      });
      return NextResponse.json({ ok: true, result });
    } catch (e) {
      const message = e instanceof Error ? e.message : "sync failed";
      if (syncId) {
        await user.supabase
          .from("bitly_syncs")
          .update({ finished_at: new Date().toISOString(), ok: false, error: message })
          .eq("id", syncId);
      }
      return fail(e);
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
