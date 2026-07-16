import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api-auth";

export const dynamic = "force-dynamic";

// ASCII-only slug for the storage key; Arabic titles fall back to "book"
// (the real title is kept in public.flipbooks).
function slugify(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/\.html?$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;

// POST { filename, title } -> a one-time signed upload URL for the flipbooks
// bucket plus the public reader URL to embed. The browser uploads directly to
// Supabase Storage, so file size is not limited by the serverless body cap.
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let filename = "";
  let title = "";
  try {
    const body = await request.json();
    filename = typeof body?.filename === "string" ? body.filename : "";
    title = typeof body?.title === "string" ? body.title.slice(0, 300) : "";
  } catch {
    // no body — fall back to the default slug
  }

  const slug = slugify(filename) || "book";
  const id = `${slug}-${crypto.randomUUID().slice(0, 8)}`;
  const path = `${id}.html`;

  const { data, error } = await user.supabase.storage
    .from("flipbooks")
    .createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: error?.message || "could not sign upload" }, { status: 500 });
  }

  // Best-effort title record; hosting still works if this fails.
  await user.supabase
    .from("flipbooks")
    .upsert({ path, title: title || filename || slug, created_by: user.id });

  return NextResponse.json({
    id,
    uploadUrl: data.signedUrl,
    readerUrl: `${request.nextUrl.origin}/reader/${id}`,
  });
}

// GET -> the hosted books (newest first) with titles, sizes and total usage.
export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: objects, error } = await user.supabase.storage
    .from("flipbooks")
    .list("", { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: meta } = await user.supabase.from("flipbooks").select("path, title");
  const titles = new Map((meta || []).map((m) => [m.path, m.title]));

  // View counters (per book: lifetime total + last 7 days)
  const viewsTotal = new Map<string, number>();
  const views7d = new Map<string, number>();
  const { data: viewRows } = await user.supabase.from("flipbook_views").select("path, day, views");
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  (viewRows || []).forEach((r) => {
    const v = Number(r.views) || 0;
    viewsTotal.set(r.path, (viewsTotal.get(r.path) || 0) + v);
    if (new Date(r.day + "T00:00:00Z").getTime() >= weekAgo) {
      views7d.set(r.path, (views7d.get(r.path) || 0) + v);
    }
  });

  let totalBytes = 0;
  let totalViews = 0;
  const origin = request.nextUrl.origin;
  const books = (objects || [])
    .filter((o) => o.name.endsWith(".html"))
    .map((o) => {
      const id = o.name.replace(/\.html$/, "");
      const size = (o.metadata as { size?: number } | null)?.size || 0;
      totalBytes += size;
      totalViews += viewsTotal.get(o.name) || 0;
      return {
        id,
        title: titles.get(o.name) || id.replace(/-[0-9a-f]{8}$/, "").replace(/-/g, " "),
        size,
        createdAt: o.created_at,
        readerUrl: `${origin}/reader/${id}`,
        views: viewsTotal.get(o.name) || 0,
        views7d: views7d.get(o.name) || 0,
      };
    });

  return NextResponse.json({ books, totalBytes, totalViews });
}

// DELETE { id } -> remove a hosted book (storage object + title record).
export async function DELETE(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let id = "";
  try {
    const body = await request.json();
    id = typeof body?.id === "string" ? body.id : "";
  } catch {
    // handled by the validation below
  }
  if (!ID_RE.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const path = `${id}.html`;
  const { error } = await user.supabase.storage.from("flipbooks").remove([path]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await user.supabase.from("flipbooks").delete().eq("path", path);

  return NextResponse.json({ ok: true });
}
