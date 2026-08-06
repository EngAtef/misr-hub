import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "../../../../lib/supabase/api-auth";
import { getMarketingConfig } from "../../../../lib/marketing/config";
import { fbPostInsights, igMediaInsights, adInsights } from "../../../../lib/marketing/meta";

export const maxDuration = 60;

// POST { postId? } -> refreshes Meta insights for one published post (or all
// of them when postId is omitted) and stores them on the rows.
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const postId = typeof body.postId === "string" ? body.postId : null;

  const { meta } = await getMarketingConfig(user);
  if (!meta.page_access_token) {
    return NextResponse.json({ error: "no_meta", message: "Meta is not connected in Settings." }, { status: 400 });
  }

  let q = user.supabase.from("marketing_posts").select("id, fb_post_id, ig_media_id, ad").eq("status", "published");
  if (postId) q = q.eq("id", postId);
  const { data: posts } = await q.limit(30);

  let updated = 0;
  for (const p of posts ?? []) {
    const insights: Record<string, unknown> = {};
    if (p.fb_post_id) insights.fb = await fbPostInsights(meta, p.fb_post_id);
    if (p.ig_media_id) insights.ig = await igMediaInsights(meta, p.ig_media_id);

    let ad = p.ad as Record<string, unknown> | null;
    if (ad?.ad_id && meta.access_token) {
      try {
        ad = { ...ad, insights: await adInsights(meta, ad.ad_id as string), insights_at: new Date().toISOString() };
      } catch {
        // keep the previous ad insights on transient failures
      }
    }

    await user.supabase
      .from("marketing_posts")
      .update({ insights, insights_at: new Date().toISOString(), ...(ad ? { ad } : {}) })
      .eq("id", p.id);
    updated++;
  }

  return NextResponse.json({ ok: true, updated });
}
