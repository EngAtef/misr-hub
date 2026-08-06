import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "../../../../lib/supabase/api-auth";
import { getMarketingConfig } from "../../../../lib/marketing/config";
import { createBoost, setAdStatus } from "../../../../lib/marketing/meta";

export const maxDuration = 60;

// POST { action: "boost", postId, dailyBudget, days }
//   Creates campaign -> ad set -> ad from the published FB post via the
//   Marketing API — everything is created PAUSED; nothing spends until the
//   user activates it.
// POST { action: "activate" | "pause", postId }
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const action = body.action as string;
  const postId = typeof body.postId === "string" ? body.postId : "";
  if (!postId) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const { data: post } = await user.supabase.from("marketing_posts").select("*").eq("id", postId).maybeSingle();
  if (!post) return NextResponse.json({ error: "post not found" }, { status: 404 });

  const { meta } = await getMarketingConfig(user);
  if (!meta.ad_account_id || !meta.access_token) {
    return NextResponse.json(
      { error: "no_meta_ads", message: "Add the Ad Account ID + system-user access token (with ads_management) in Settings → Meta first." },
      { status: 400 }
    );
  }

  try {
    if (action === "boost") {
      if (!post.fb_post_id) {
        return NextResponse.json({ error: "Publish the post to Facebook first — the ad promotes the existing post." }, { status: 400 });
      }
      const dailyBudget = Math.max(1, Number(body.dailyBudget) || 0);
      const days = Math.min(90, Math.max(1, Math.floor(Number(body.days) || 7)));
      const boost = await createBoost(meta, {
        pagePostId: post.fb_post_id,
        name: `NM Smart — ${String(post.book_title).slice(0, 60)}`,
        dailyBudgetEgp: dailyBudget,
        days,
      });
      const ad = { ...boost, daily_budget: dailyBudget, days, status: "PAUSED", created_at: new Date().toISOString() };
      await user.supabase.from("marketing_posts").update({ ad }).eq("id", postId);
      return NextResponse.json({ ok: true, ad });
    }

    if (action === "activate" || action === "pause") {
      const ad = post.ad as { campaign_id: string; adset_id: string; ad_id: string } | null;
      if (!ad?.ad_id) return NextResponse.json({ error: "no ad created for this post yet" }, { status: 400 });
      const status = action === "activate" ? "ACTIVE" : "PAUSED";
      await setAdStatus(meta, ad, status);
      await user.supabase.from("marketing_posts").update({ ad: { ...ad, status } }).eq("id", postId);
      return NextResponse.json({ ok: true, status });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Meta ads call failed" }, { status: 502 });
  }
}
