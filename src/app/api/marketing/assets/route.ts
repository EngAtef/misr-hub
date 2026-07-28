import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api-auth";

// POST { postId, files: ["sq.jpg" | "story.jpg" | "link.jpg", ...] }
// -> { uploads: [{ name, signedUrl, path, publicUrl }] }
//
// Signs upload URLs for a post's design assets in the public flipbooks bucket
// under marketing/{postId}/. Meta fetches the images from the public URL when
// publishing, so no separate hosting is needed.
const ID_RE = /^[0-9a-f-]{36}$/;
const FILE_RE = /^(sq|story|link)\.jpg$/;

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const postId = typeof body.postId === "string" ? body.postId : "";
  const files = Array.isArray(body.files) ? (body.files as unknown[]) : [];
  if (!ID_RE.test(postId) || files.length === 0 || files.length > 6 || files.some((f) => typeof f !== "string" || !FILE_RE.test(f))) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const uploads = [];
  for (const name of files as string[]) {
    const path = `marketing/${postId}/${name}`;
    // Re-generating an asset overwrites the old object at the same path.
    await user.supabase.storage.from("flipbooks").remove([path]);
    const { data, error } = await user.supabase.storage.from("flipbooks").createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ error: error?.message ?? "sign failed" }, { status: 500 });
    uploads.push({
      name,
      signedUrl: data.signedUrl,
      path,
      publicUrl: `${base}/storage/v1/object/public/flipbooks/${path}`,
    });
  }
  return NextResponse.json({ uploads });
}
