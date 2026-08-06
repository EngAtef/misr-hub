import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { adInsights, setAdStatus, type MetaCreds } from "../../../../lib/marketing/meta";

export const maxDuration = 120;

// The media buyer that actually watches the ads. Daily Vercel Cron:
//   * syncs insights for every ACTIVE boosted ad
//   * enforces the director's kill rule — spend >= 2x the store's average
//     order value with zero results -> pause the ad and notify the owner
//   * flags scale candidates (results with healthy cost-per-result) as an
//     in-app notification, never auto-raising budgets
// No-ops gracefully when Meta or the service-role key isn't configured.
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true, skipped: "no service role key" });
  }

  const db = createAdminClient();
  const { data: metaRow } = await db.from("app_settings").select("value").eq("key", "meta").maybeSingle();
  const meta = (metaRow?.value ?? {}) as MetaCreds;
  if (!meta.access_token || !meta.ad_account_id) {
    return NextResponse.json({ ok: true, skipped: "meta ads not configured" });
  }

  // The kill threshold: 2x average order value (last 30 days), floor 500 EGP.
  let aov = 550;
  try {
    const { data: k } = await db.rpc("fn_kpis", {
      p_from: new Date(Date.now() - 30 * 86400000).toISOString(),
      p_to: null,
    });
    const v = (k as { avg_order_value?: number })?.avg_order_value;
    if (v && v > 100) aov = v;
  } catch { /* default holds */ }
  const killSpend = Math.max(2 * aov, 500);

  const { data: posts } = await db
    .from("marketing_posts")
    .select("id, book_title, ad")
    .eq("status", "published")
    .not("ad", "is", null)
    .limit(50);

  const actions: { post: string; action: string; detail: string }[] = [];
  const notify = async (title: string, body: string) => {
    const { data: owner } = await db.from("profiles").select("id").eq("is_owner", true).maybeSingle();
    if (owner) {
      await db.from("notifications").insert({
        recipient_id: owner.id, kind: "system",
        title, body, link: "/marketing",
      });
    }
  };

  for (const p of posts ?? []) {
    const ad = p.ad as {
      ad_id?: string; campaign_id?: string; adset_id?: string; status?: string;
      daily_budget?: number; insights?: { spend?: number; results?: number };
    } | null;
    if (!ad?.ad_id || ad.status !== "ACTIVE") continue;

    try {
      const insights = await adInsights(meta, ad.ad_id);
      const spend = Number(insights.spend ?? 0);
      const results = Number(insights.results ?? 0);
      let next = { ...ad, insights, insights_at: new Date().toISOString() };

      if (spend >= killSpend && results === 0) {
        await setAdStatus(meta, { campaign_id: ad.campaign_id!, adset_id: ad.adset_id!, ad_id: ad.ad_id }, "PAUSED");
        next = { ...next, status: "PAUSED" };
        actions.push({ post: p.id, action: "killed", detail: `spend ${spend} EGP, 0 results` });
        await notify(
          "🛑 إيقاف إعلان تلقائي (قاعدة الإيقاف)",
          `إعلان «${p.book_title}» صرف ${Math.round(spend)} ج.م بدون أي نتيجة (الحد ${Math.round(killSpend)} ج.م) — تم إيقافه مؤقتًا. راجعه في استوديو التسويق.`
        );
      } else if (results >= 5 && spend / results <= aov / 3) {
        actions.push({ post: p.id, action: "scale_candidate", detail: `${results} results at ${Math.round(spend / results)} EGP each` });
        await notify(
          "📈 إعلان يستاهل زيادة الميزانية",
          `إعلان «${p.book_title}» حقق ${results} نتيجة بتكلفة ${Math.round(spend / results)} ج.م للنتيجة — مرشح لزيادة الميزانية 20%. القرار قرارك من استوديو التسويق.`
        );
      }

      await db.from("marketing_posts").update({ ad: next }).eq("id", p.id);
    } catch {
      // transient Meta error — try again on the next run
    }
  }

  return NextResponse.json({ ok: true, checked: (posts ?? []).length, actions, killSpend: Math.round(killSpend) });
}
