import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api-auth";
import { listFlipbooks } from "@/lib/flipbooks-list";

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
// v2 upload file names the studio may request signed URLs for:
// page images (p1.webp…), the cover thumbnail, or the manifest sentinel.
const FILE_RE = /^(p[0-9]{1,4}|cover)\.(webp|jpg)$/;

// POST — the shapes Book Studio (and the Studio page) sends:
//   { filename, title }                              legacy: one signed URL for a
//                                                    self-contained {id}.html
//   { v:2, filename, title, pages, ext, ... }        v2: registers the book and
//                                                    returns its id + reader URL;
//                                                    with { id, migrate:true } it
//                                                    reuses an existing legacy id
//                                                    so URLs/embeds survive
//   { sign: id, files: ["p1.webp", …, "manifest"] }  v2: a batch of signed upload
//                                                    URLs for that book's objects
//   { finishMigrate: id }                            legacy→v2 upgrade epilogue:
//                                                    parks the old {id}.html in
//                                                    trash once the manifest is up
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // no body — fall back to the legacy default slug below
  }

  // -- batch signing for a v2 book's page/cover/manifest uploads
  if (typeof body.sign === "string") {
    const id = body.sign;
    const files = Array.isArray(body.files) ? (body.files as unknown[]) : [];
    if (!ID_RE.test(id) || files.length === 0 || files.length > 40) {
      return NextResponse.json({ error: "bad sign request" }, { status: 400 });
    }
    const paths = files.map((f) => {
      if (f === "manifest") return `${id}.json`;
      if (typeof f === "string" && FILE_RE.test(f)) return `${id}/${f}`;
      return null;
    });
    if (paths.some((p) => p === null)) {
      return NextResponse.json({ error: "bad file name" }, { status: 400 });
    }
    const signed = await Promise.all(
      (paths as string[]).map((p) => user.supabase.storage.from("flipbooks").createSignedUploadUrl(p))
    );
    const bad = signed.find((s) => s.error || !s.data);
    if (bad) return NextResponse.json({ error: bad.error?.message || "could not sign uploads" }, { status: 500 });
    return NextResponse.json({ urls: signed.map((s) => s.data!.signedUrl) });
  }

  // -- legacy→v2 upgrade epilogue: once the new manifest is confirmed live,
  //    park the old single-file book in trash/ (restorable) and drop its row.
  if (typeof body.finishMigrate === "string") {
    const id = body.finishMigrate;
    if (!ID_RE.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const { data: mf } = await user.supabase.storage.from("flipbooks").download(`${id}.json`);
    if (!mf) return NextResponse.json({ error: "manifest not found — upgrade incomplete" }, { status: 409 });
    const moved = await user.supabase.storage.from("flipbooks").move(`${id}.html`, `trash/${id}.html`);
    if (moved.error) return NextResponse.json({ error: moved.error.message }, { status: 500 });
    await user.supabase.from("flipbooks").delete().eq("path", `${id}.html`);
    return NextResponse.json({ ok: true });
  }

  const filename = typeof body.filename === "string" ? body.filename : "";
  const title = typeof body.title === "string" ? (body.title as string).slice(0, 300) : "";
  const slug = slugify(filename) || "book";
  const migrate = body.migrate === true && typeof body.id === "string" && ID_RE.test(body.id as string);
  const id = migrate ? (body.id as string) : `${slug}-${crypto.randomUUID().slice(0, 8)}`;

  // -- v2: binary pages + manifest; the row is the source of truth for
  //    size/pages/cover because the storage listing can't aggregate a folder.
  if (body.v === 2) {
    const pages = Math.floor(Number(body.pages)) || 0;
    const ext = body.ext === "jpg" ? "jpg" : "webp";
    if (pages < 1 || pages > 2000) {
      return NextResponse.json({ error: "bad page count" }, { status: 400 });
    }
    // An upgraded/repaired book keeps its category/buy-link/visibility:
    // legacy→v2 inherits from the .html row, an in-place v2 repair from its
    // own .json row.
    let inherited: { category?: string | null; buy_url?: string | null; is_public?: boolean } = {};
    if (migrate) {
      const { data: rows } = await user.supabase
        .from("flipbooks")
        .select("path, category, buy_url, is_public")
        .in("path", [`${id}.html`, `${id}.json`]);
      const old = (rows || []).find((r) => r.path.endsWith(".json")) || (rows || [])[0];
      if (old) inherited = old;
    }
    const { error } = await user.supabase.from("flipbooks").upsert({
      path: `${id}.json`,
      title: title || filename || slug,
      created_by: user.id,
      fmt: "v2",
      size_bytes: Math.max(0, Number(body.sizeBytes) || 0),
      page_count: pages,
      rtl: body.rtl !== false,
      cover: body.cover === true ? `cover.${ext}` : null,
      category: inherited.category ?? null,
      buy_url: inherited.buy_url ?? null,
      is_public: inherited.is_public !== false,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Extracted text (when the book has a selectable text layer) powers the
    // public library's "search inside books". Best-effort.
    const searchText = typeof body.searchText === "string" ? (body.searchText as string).slice(0, 150000).trim() : "";
    if (searchText) {
      await user.supabase.from("flipbook_texts").upsert({ path: `${id}.json`, txt: searchText });
    }
    return NextResponse.json({ id, readerUrl: `${request.nextUrl.origin}/reader/${id}` });
  }

  // -- legacy single-file upload (kept for older cached studio builds)
  const path = `${id}.html`;
  const { data, error } = await user.supabase.storage
    .from("flipbooks")
    .createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: error?.message || "could not sign upload" }, { status: 500 });
  }
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

  let entries;
  try {
    entries = await listFlipbooks(user.supabase);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "list failed" }, { status: 500 });
  }

  // View counters (per book: lifetime total + last 7/30 days). The beacon
  // always counts under "{id}.html" — for v2 books too — so the key is
  // derived from the id, not the storage path.
  const viewsTotal = new Map<string, number>();
  const views7d = new Map<string, number>();
  const views30d = new Map<string, number>();
  const { data: viewRows } = await user.supabase.from("flipbook_views").select("path, day, views");
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const monthAgo = Date.now() - 30 * 24 * 3600 * 1000;
  (viewRows || []).forEach((r) => {
    const v = Number(r.views) || 0;
    const t = new Date(r.day + "T00:00:00Z").getTime();
    viewsTotal.set(r.path, (viewsTotal.get(r.path) || 0) + v);
    if (t >= weekAgo) views7d.set(r.path, (views7d.get(r.path) || 0) + v);
    if (t >= monthAgo) views30d.set(r.path, (views30d.get(r.path) || 0) + v);
  });

  let totalBytes = 0;
  let totalViews = 0;
  const origin = request.nextUrl.origin;
  const books = entries.map((b) => {
    totalBytes += b.size;
    const views = viewsTotal.get(`${b.id}.html`) || 0;
    totalViews += views;
    return {
      id: b.id,
      title: b.title,
      fmt: b.fmt,
      size: b.size,
      pages: b.pages,
      createdAt: b.createdAt,
      readerUrl: `${origin}/reader/${b.id}`,
      views,
      views7d: views7d.get(`${b.id}.html`) || 0,
      views30d: views30d.get(`${b.id}.html`) || 0,
      category: b.category,
      buyUrl: b.buyUrl,
      isPublic: b.isPublic,
      createdBy: b.createdBy,
    };
  });

  return NextResponse.json({ books, totalBytes, totalViews });
}

// PATCH { id, title?, category?, buyUrl?, isPublic? } -> edit a hosted book's
// metadata. Only the fields present in the body change. Updates the row (which
// drives the Studio list, the library and the reader) and, when the title
// changes on a v2 book, rewrites the manifest so the reader shows it too.
export async function PATCH(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let id = "";
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
    id = typeof body?.id === "string" ? (body.id as string) : "";
  } catch {
    // handled by the validation below
  }
  if (!ID_RE.test(id)) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  let title = "";
  if (typeof body.title === "string") {
    title = (body.title as string).trim().slice(0, 300);
    if (!title) return NextResponse.json({ error: "empty title" }, { status: 400 });
    patch.title = title;
  }
  if (typeof body.category === "string") {
    patch.category = (body.category as string).trim().slice(0, 60) || null;
  }
  if (typeof body.buyUrl === "string") {
    const u = (body.buyUrl as string).trim();
    if (u && !/^https?:\/\/.{3,500}$/i.test(u)) {
      return NextResponse.json({ error: "buy link must start with http(s)://" }, { status: 400 });
    }
    patch.buy_url = u || null;
  }
  if (typeof body.isPublic === "boolean") patch.is_public = body.isPublic;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { error } = await user.supabase
    .from("flipbooks")
    .update(patch)
    .in("path", [`${id}.html`, `${id}.json`]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Best-effort manifest rewrite — the row already carries the new title.
  if (title) {
    try {
      const { data: mf } = await user.supabase.storage.from("flipbooks").download(`${id}.json`);
      if (mf) {
        const manifest = JSON.parse(await mf.text());
        manifest.title = title;
        await user.supabase.storage
          .from("flipbooks")
          .update(`${id}.json`, new Blob([JSON.stringify(manifest)], { type: "application/json" }), {
            contentType: "application/json",
            upsert: true,
          });
      }
    } catch {
      // legacy book or unreachable manifest — the row rename is what matters
    }
  }

  return NextResponse.json({ ok: true });
}

// DELETE { id } -> soft-remove a hosted book. The metadata row lands in the
// owner's trash (BEFORE DELETE trigger) and the book's primary object is
// parked under trash/ so it disappears from the library and the reader, but a
// restore from the Control Center brings it back intact. For v2 books only the
// manifest is parked — the page images stay in place and are removed when the
// trash entry is purged for good.
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

  // A book is one format or the other — try the v2 manifest first, fall back
  // to the legacy single file.
  let path = `${id}.json`;
  let moved = await user.supabase.storage.from("flipbooks").move(path, `trash/${path}`);
  if (moved.error) {
    path = `${id}.html`;
    moved = await user.supabase.storage.from("flipbooks").move(path, `trash/${path}`);
  }
  if (moved.error) return NextResponse.json({ error: moved.error.message }, { status: 500 });
  const del = await user.supabase.from("flipbooks").delete().eq("path", path);
  if (del.error) {
    // Compensating move: don't leave the book hidden from the reader while its
    // row still lists it — undo the park and report the failure.
    await user.supabase.storage.from("flipbooks").move(`trash/${path}`, path);
    return NextResponse.json({ error: del.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
