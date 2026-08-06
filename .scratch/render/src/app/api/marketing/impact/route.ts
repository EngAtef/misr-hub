import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "../../../../lib/supabase/api-auth";

export const maxDuration = 30;

// GET ?postId=... -> { impact: {before_*, after_*, days}, keyword }
// Post → real sales attribution: orders containing the post's book in the
// 7 days after publishing vs the 7 days before (normalized-title match).
export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const postId = request.nextUrl.searchParams.get("postId");
  if (!postId) return NextResponse.json({ error: "postId required" }, { status: 400 });

  const { data: post } = await user.supabase
    .from("marketing_posts")
    .select("book_title, published_at")
    .eq("id", postId)
    .maybeSingle();
  if (!post?.published_at) {
    return NextResponse.json({ error: "post not published yet" }, { status: 400 });
  }

  // A bundle title is "«A» + «B»" — measure on the first book's title.
  const keyword = (post.book_title as string).split(" + ")[0].trim().slice(0, 120);
  if (!keyword) return NextResponse.json({ error: "no book title on post" }, { status: 400 });

  const { data: impact, error } = await user.supabase.rpc("fn_post_sales_impact", {
    p_keyword: keyword,
    p_published: post.published_at,
    p_days: 7,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ impact, keyword });
}
