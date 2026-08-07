import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api-auth";
import {
  debugToken,
  listAdAccounts,
  resolveAdAccounts,
  probeInsights,
  MetaError,
  REQUIRED_SCOPES,
  OPTIONAL_SCOPES,
  GRAPH_VERSION,
  type AdAccount,
} from "@/lib/meta-ads/api";
import { syncAccount, monthWindow, earliestPullableDate } from "@/lib/meta-ads/sync";
import { runBackfillStep } from "@/lib/meta-ads/backfill";
import { RateLimitedError } from "@/lib/meta-ads/throttle";

export const maxDuration = 60;

interface MappedAccount {
  id: string;
  label: string;
  enabled: boolean;
}

function fail(e: unknown) {
  if (e instanceof RateLimitedError) {
    // 429 so the browser loop can tell "wait" apart from "broken"
    return NextResponse.json(
      { error: e.message, hint: "The sync pauses itself and picks up where it stopped", rateLimited: true },
      { status: 429 }
    );
  }
  if (e instanceof MetaError) {
    return NextResponse.json(
      { error: e.message, hint: e.hint, code: e.code, subcode: e.subcode },
      { status: e.status >= 400 && e.status < 500 ? 400 : 502 }
    );
  }
  return NextResponse.json({ error: e instanceof Error ? e.message : "Meta request failed" }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "manager"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  // the token lives in the existing 'meta' settings key (Marketing Studio)
  // fn_meta_ads_token prefers the dedicated Meta Ads box, falls back to the
  // legacy shared 'meta' field, and returns null when the integration is
  // switched off — so the toggle actually stops the pull, not just hides it
  const { data: tokenRow } = await user.supabase.rpc("fn_meta_ads_token");
  const token = (tokenRow as string | null) ?? "";

  if (body.action === "save_accounts") {
    const accounts = (Array.isArray(body.accounts) ? body.accounts : []) as MappedAccount[];
    const clean = accounts
      .filter((a) => typeof a?.id === "string" && a.id.startsWith("act_"))
      .map((a) => ({
        id: a.id,
        label: String(a.label ?? "").trim().slice(0, 60) || a.id,
        enabled: a.enabled !== false,
      }));
    const { error } = await user.supabase.rpc("fn_meta_ads_config_set", { p_value: { accounts: clean } });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await user.supabase.from("audit_log").insert({
      user_id: user.id,
      user_email: user.email,
      action: "meta_ads_accounts",
      details: { accounts: clean.length, enabled: clean.filter((a) => a.enabled).length },
    });
    return NextResponse.json({ ok: true, accounts: clean });
  }

  // ---- the whole point of this step: prove the connection actually works
  if (body.action === "test") {
    if (!token) {
      return NextResponse.json(
        {
          error: "No Meta system-user token saved yet",
          hint: "Settings → Meta (Facebook & Instagram) → System-User Access Token (ads)",
        },
        { status: 400 }
      );
    }
    try {
      const info = await debugToken(token);
      const missing = REQUIRED_SCOPES.filter((s) => !info.scopes.includes(s));

      const { data: savedCfg } = await user.supabase.rpc("fn_meta_ads_config");
      const alreadyMapped =
        (((savedCfg ?? {}) as { accounts?: { accounts?: MappedAccount[] } }).accounts?.accounts ?? []) as MappedAccount[];

      let accounts: AdAccount[] = [];
      let accountsError: string | undefined;
      let accountFailures: { id: string; error: string }[] = [];
      let resolvedById = false;

      try {
        accounts = await listAdAccounts(token);
      } catch (e) {
        accountsError = e instanceof MetaError ? `${e.message}${e.hint ? ` — ${e.hint}` : ""}` : String(e);
      }

      // Enumerating the business's accounts needs business_management, but
      // reading an account you've been granted needs only ads_read. So when
      // the listing is refused, resolve explicit ids instead — the pasted
      // ones, else whatever is already mapped.
      if (!accounts.length) {
        const ids = (Array.isArray(body.accountIds) ? body.accountIds : [])
          .map((x: unknown) => String(x).trim())
          .filter(Boolean);
        const fallbackIds = ids.length ? ids : alreadyMapped.map((a) => a.id);
        if (fallbackIds.length) {
          const r = await resolveAdAccounts(token, fallbackIds);
          accounts = r.accounts;
          accountFailures = r.failures;
          resolvedById = accounts.length > 0;
          if (resolvedById) accountsError = undefined;
        }
      }

      // read-access proof on the biggest account, over a window we know has
      // spend (July 2026 is what the Ads Center already holds)
      let probe: { account: string; rows: number; actionTypes: string[]; sampleSpend: number } | null = null;
      let probeError: string | undefined;
      const target = body.probeAccount || accounts[0]?.id;
      if (target && !missing.length) {
        try {
          const since = String(body.since || "2026-07-01");
          const until = String(body.until || "2026-07-31");
          const r = await probeInsights(token, target, since, until);
          probe = { account: target, ...r };
        } catch (e) {
          probeError = e instanceof MetaError ? `${e.message}${e.hint ? ` — ${e.hint}` : ""}` : String(e);
        }
      }

      return NextResponse.json({
        ok: info.isValid && !missing.length && accounts.length > 0,
        resolvedById,
        accountFailures,
        graphVersion: GRAPH_VERSION,
        token: {
          valid: info.isValid,
          type: info.type,
          appName: info.appName,
          neverExpires: info.expiresAt === 0,
          expiresAt: info.expiresAt ? new Date(info.expiresAt * 1000).toISOString() : null,
          scopes: info.scopes,
          missingScopes: missing,
          optionalPresent: OPTIONAL_SCOPES.filter((s) => info.scopes.includes(s)),
        },
        accounts,
        accountsError,
        probe,
        probeError,
        savedAccounts: alreadyMapped,
      });
    } catch (e) {
      return fail(e);
    }
  }

  // ---- pull one account into ad_insights (the caller loops over accounts) --
  if (body.action === "sync") {
    if (!token) {
      return NextResponse.json({ error: "No Meta token saved" }, { status: 400 });
    }
    const { data: cfg } = await user.supabase.rpc("fn_meta_ads_config");
    const saved =
      (((cfg ?? {}) as { accounts?: { accounts?: MappedAccount[] } }).accounts?.accounts ?? []) as MappedAccount[];

    const win = monthWindow();
    const since = /^\d{4}-\d{2}-\d{2}$/.test(String(body.since)) ? String(body.since) : win.since;
    const until = /^\d{4}-\d{2}-\d{2}$/.test(String(body.until)) ? String(body.until) : win.until;
    if (since > until) return NextResponse.json({ error: "Start is after end" }, { status: 400 });

    // an explicit accountId wins; otherwise take the first enabled one so a
    // caller with no mapping still gets something useful
    const wanted = body.accountId ? saved.find((a) => a.id === body.accountId) : saved.find((a) => a.enabled);
    if (!wanted) {
      return NextResponse.json(
        { error: "No ad account selected", hint: "Settings → Meta Ads connection → tick an account and Save mapping" },
        { status: 400 }
      );
    }

    try {
      const result = await syncAccount(user.supabase, token, { id: wanted.id, label: wanted.label }, since, until);
      await user.supabase.from("audit_log").insert({
        user_id: user.id,
        user_email: user.email,
        action: "sync_meta_ads",
        details: { account: wanted.label, id: wanted.id, period: `${since}..${until}`, rows: result.rows },
      });
      return NextResponse.json({ ok: true, result });
    } catch (e) {
      return fail(e);
    }
  }

  // ---- plan the full-history backfill ------------------------------------
  // Meta only serves the last 37 months, so "everything" has a hard floor.
  if (body.action === "backfill_plan") {
    if (!token) return NextResponse.json({ error: "No Meta token saved" }, { status: 400 });

    const { data: cfg } = await user.supabase.rpc("fn_meta_ads_config");
    const saved =
      (((cfg ?? {}) as { accounts?: { accounts?: MappedAccount[] } }).accounts?.accounts ?? []) as MappedAccount[];
    const enabled = saved.filter((a) => a.enabled);
    if (!enabled.length) {
      return NextResponse.json(
        { error: "No ad account selected", hint: "Settings → Meta Ads connection → tick an account and Save mapping" },
        { status: 400 }
      );
    }

    const floor = earliestPullableDate();
    const asked = /^\d{4}-\d{2}-\d{2}$/.test(String(body.since)) ? String(body.since) : floor;
    const since = asked < floor ? floor : asked;
    const until = monthWindow().until;

    const { data, error } = await user.supabase.rpc("fn_ads_backfill_plan", {
      p_accounts: enabled.map((a) => ({ id: a.id, label: a.label })),
      p_from: since,
      p_to: until,
      p_redo: body.redo === true,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await user.supabase.from("audit_log").insert({
      user_id: user.id,
      user_email: user.email,
      action: "meta_ads_backfill_plan",
      details: { since, until, accounts: enabled.length, ...(data as object) },
    });
    return NextResponse.json({ ok: true, since, until, floor, clipped: asked < floor, plan: data });
  }

  // ---- run a slice of the queue; the caller loops until pending hits 0 ----
  if (body.action === "backfill_step") {
    if (!token) return NextResponse.json({ error: "No Meta token saved" }, { status: 400 });
    try {
      const result = await runBackfillStep(user.supabase, token, { budgetMs: 45_000 });
      const { data: progress } = await user.supabase.rpc("fn_ads_backfill_progress");
      return NextResponse.json({ ok: true, result, progress });
    } catch (e) {
      return fail(e);
    }
  }

  if (body.action === "backfill_progress") {
    const { data, error } = await user.supabase.rpc("fn_ads_backfill_progress");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, progress: data });
  }

  // ---- drop the hand-uploaded spreadsheets, keeping only API data ---------
  if (body.action === "purge_manual") {
    const { data, error } = await user.supabase.rpc("fn_ads_purge_manual_imports", {
      p_dry_run: body.dryRun === true,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (body.dryRun !== true) {
      await user.supabase.from("audit_log").insert({
        user_id: user.id,
        user_email: user.email,
        action: "meta_ads_purge_manual",
        details: data as object,
      });
    }
    return NextResponse.json({ ok: true, ...(data as object) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
