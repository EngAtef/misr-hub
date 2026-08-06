import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import type { MetaCreds } from "../../../../lib/marketing/meta";

export const maxDuration = 30;

// Meta webhook: auto-reply to purchase-intent comments on the Page's posts.
// GET  — Meta's webhook verification handshake (hub.challenge echo).
// POST — feed events; when a comment matches a buy-intent keyword, reply
//        with the book's buy link (looked up from the marketing post that
//        owns the FB post), or the store's generic answer.
//
// Setup (Settings → Meta card guide): Meta App → Webhooks → Page → subscribe
// to "feed", callback = /api/marketing/comments, verify token = the value
// saved in Settings. The page access token must have pages_manage_engagement.

const INTENT = /بكام|بكم|السعر|سعره|عايز|عاوز|اطلب|أطلب|اشتري|أشتري|متوفر|متاح|فين ألاقيه|ازاي اطلب|إزاي أطلب|how much|price|want|available|order/i;

interface CommentsCfg extends MetaCreds {
  comment_verify_token?: string;
  comments_enabled?: string; // "on" to enable auto-replies
  comment_reply?: string;    // optional custom reply template, {link} placeholder
}

async function loadCfg(): Promise<CommentsCfg | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const db = createAdminClient();
  const { data } = await db.from("app_settings").select("value").eq("key", "meta").maybeSingle();
  return (data?.value ?? null) as CommentsCfg | null;
}

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe") {
    const cfg = await loadCfg();
    if (cfg?.comment_verify_token && p.get("hub.verify_token") === cfg.comment_verify_token) {
      return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
    }
    return NextResponse.json({ error: "verify token mismatch" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}

interface FeedChange {
  field?: string;
  value?: {
    item?: string;
    verb?: string;
    comment_id?: string;
    post_id?: string;
    message?: string;
    from?: { id?: string; name?: string };
  };
}

export async function POST(request: NextRequest) {
  const cfg = await loadCfg();
  // Always 200 — Meta disables webhooks that keep failing.
  if (!cfg?.page_access_token || cfg.comments_enabled !== "on") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const body = await request.json().catch(() => null) as
    { entry?: { changes?: FeedChange[] }[] } | null;
  if (!body?.entry) return NextResponse.json({ ok: true });

  const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null;
  let replied = 0;

  for (const entry of body.entry) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value;
      if (ch.field !== "feed" || v?.item !== "comment" || v.verb !== "add") continue;
      if (!v.comment_id || !v.message) continue;
      if (v.from?.id && v.from.id === cfg.page_id) continue; // our own replies
      if (!INTENT.test(v.message)) continue;

      // Which book is this post about?
      let link = "";
      let title = "";
      if (db && v.post_id) {
        const { data: post } = await db
          .from("marketing_posts")
          .select("book_title, buy_url")
          .eq("fb_post_id", v.post_id)
          .maybeSingle();
        link = (post?.buy_url as string) ?? "";
        title = (post?.book_title as string) ?? "";
      }

      const reply = (cfg.comment_reply || "").trim()
        ? (cfg.comment_reply as string).replace("{link}", link || "متجر نهضة مصر")
        : link
          ? `أهلًا بيك 🌟 تقدر تطلب ${title ? `«${title.split(" + ")[0]}»` : "الكتاب"} مباشرة من هنا 👉 ${link}\nوالتوصيل لحد باب البيت 🚚`
          : `أهلًا بيك 🌟 ابعتلنا رسالة على الصفحة وهنساعدك في طلبك فورًا 📚`;

      try {
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${v.comment_id}/comments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ message: reply, access_token: cfg.page_access_token }).toString(),
          }
        );
        if (res.ok) replied++;
      } catch {
        // never fail the webhook
      }
    }
  }

  return NextResponse.json({ ok: true, replied });
}
