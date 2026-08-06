import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "../../../../lib/supabase/api-auth";
import { getMarketingConfig } from "../../../../lib/marketing/config";
import { fbPublish, igPublish } from "../../../../lib/marketing/meta";

export const maxDuration = 60;

interface AssetRow { fmt: string; path: string; url: string }

// POST { postId, channels: ["fb","ig"] } -> publishes the post via the Meta
// Graph API and stores the returned ids on the row. Partial success is
// recorded per channel.
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const postId = typeof body.postId === "string" ? body.postId : "";
  const channels = (Array.isArray(body.channels) ? body.channels : []).filter(
    (c: unknown): c is "fb" | "ig" => c === "fb" || c === "ig"
  );
  if (!postId || channels.length === 0) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const { data: post } = await user.supabase.from("marketing_posts").select("*").eq("id", postId).maybeSingle();
  if (!post) return NextResponse.json({ error: "post not found" }, { status: 404 });

  const { meta } = await getMarketingConfig(user);
  if (!meta.page_id || !meta.page_access_token) {
    return NextResponse.json(
      { error: "no_meta", message: "Add your Facebook Page ID + Page access token in Settings → Meta first." },
      { status: 400 }
    );
  }

  const assets = (post.assets ?? []) as AssetRow[];
  // Prefer the square asset for feed posts; landscape as fallback.
  const image = assets.find((a) => a.fmt === "sq") ?? assets.find((a) => a.fmt === "link") ?? assets[0];
  const withTags = (t: string) => [t, post.hashtags].filter(Boolean).join("\n\n");

  const update: Record<string, unknown> = {};
  const errors: string[] = [];

  if (channels.includes("fb")) {
    try {
      update.fb_post_id = await fbPublish(meta, {
        message: withTags(post.post_fb || post.post_ig),
        imageUrl: image?.url,
        link: post.buy_url ?? undefined,
      });
    } catch (e) {
      errors.push(`Facebook: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  if (channels.includes("ig")) {
    if (!meta.ig_user_id) {
      errors.push("Instagram: add the IG user id in Settings → Meta first.");
    } else if (!image) {
      errors.push("Instagram: an image asset is required — generate assets first.");
    } else {
      try {
        const r = await igPublish(meta, { caption: withTags(post.post_ig || post.post_fb), imageUrl: image.url });
        update.ig_media_id = r.mediaId;
        update.ig_permalink = r.permalink;
      } catch (e) {
        errors.push(`Instagram: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
  }

  const succeeded = Boolean(update.fb_post_id || update.ig_media_id);
  const prev = (post.channels ?? []) as string[];
  await user.supabase
    .from("marketing_posts")
    .update({
      ...update,
      status: succeeded ? "published" : "failed",
      published_at: succeeded ? (post.published_at ?? new Date().toISOString()) : post.published_at,
      channels: Array.from(new Set([...prev, ...(update.fb_post_id ? ["fb"] : []), ...(update.ig_media_id ? ["ig"] : [])])),
      publish_error: errors.length ? errors.join(" | ") : null,
    })
    .eq("id", postId);

  return NextResponse.json({ ok: succeeded, errors, fb_post_id: update.fb_post_id ?? post.fb_post_id, ig_media_id: update.ig_media_id ?? post.ig_media_id });
}
