import { NextRequest } from "next/server";
import { NM_WATERMARK_SNIPPET } from "@/lib/nm-watermark";
import { upgradeLegacyFlipbook } from "@/lib/flipbook-upgrade";
import { flipbookViewerTemplate } from "@/lib/flipbook-viewer-template";

export const dynamic = "force-dynamic";

function escapeHtml(s: string) {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));
}

// Floating "get the full book" button for free previews (target=_top so it
// escapes the embed iframe and opens the store page).
function buyBar(buyUrl: string) {
  const safe = buyUrl.replace(/"/g, "&quot;");
  return (
    `<a href="${safe}" target="_top" rel="noopener" style="position:fixed;bottom:72px;right:16px;z-index:50;` +
    `background:linear-gradient(92deg,#f59e0b,#fbb43a);color:#3a2602;font-weight:800;` +
    `font-family:-apple-system,'Segoe UI',Tahoma,Arial,sans-serif;font-size:14px;padding:11px 18px;` +
    `border-radius:999px;text-decoration:none;box-shadow:0 6px 18px rgba(0,0,0,.35)">🛒 احصل على الكتاب كاملاً</a>`
  );
}

interface Manifest {
  v: number;
  title?: string;
  rtl?: boolean;
  ext?: string;
  pages?: number;
  buyUrl?: string;
}

// v2 books: a tiny JSON manifest + binary page images in storage. The viewer
// is rendered here from the shared template, so the ~100 KB of viewer code is
// never duplicated per book and pages lazy-load straight from the storage CDN.
function buildV2Html(id: string, m: Manifest, storageBase: string, title: string) {
  const ext = m.ext === "jpg" ? "jpg" : "webp";
  const n = Math.min(Math.floor(Number(m.pages)) || 0, 2000);
  const pages = Array.from({ length: n }, (_, i) => `${storageBase}/${id}/p${i + 1}.${ext}`);
  const rtl = m.rtl !== false;
  let html = flipbookViewerTemplate()
    .split("__TITLE__").join(escapeHtml(title))
    .split("__RTL__").join(rtl ? "true" : "false")
    .split("__LANG__").join(rtl ? "ar" : "en")
    .split("__PAGES__").join(JSON.stringify(pages));
  const buyUrl = typeof m.buyUrl === "string" ? m.buyUrl.trim() : "";
  if (/^https?:\/\//i.test(buyUrl)) {
    html = html.replace("</body>", buyBar(buyUrl) + "\n</body>");
  }
  return html;
}

// The rename API updates the metadata row; the manifest rewrite is
// best-effort, so the row is the authority on the title.
async function dbTitle(id: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/rest/v1/flipbooks?path=eq.${id}.json&select=title`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { title?: string }[];
    const t = rows?.[0]?.title;
    return typeof t === "string" && t.trim() ? t.trim() : null;
  } catch {
    return null;
  }
}

// Public book reader. Serves hosted flipbooks out of Supabase Storage with
// real text/html headers, so the URL can be embedded in an <iframe> anywhere.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) {
    return new Response("Not found", { status: 404 });
  }

  const storageBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/flipbooks`;

  let html: string | null = null;
  let isV2 = false;

  // v2 first: a manifest at {id}.json
  try {
    const mRes = await fetch(`${storageBase}/${id}.json`, { cache: "no-store" });
    if (mRes.ok) {
      const manifest = (await mRes.json()) as Manifest;
      if (manifest && Number(manifest.v) === 2 && Number(manifest.pages) > 0) {
        const title = (await dbTitle(id)) || manifest.title || "Book";
        html = buildV2Html(id, manifest, storageBase, title);
        isV2 = true;
      }
    }
  } catch {
    // fall through to the legacy single-file book
  }

  // legacy: one self-contained {id}.html
  if (html === null) {
    let upstream: Response;
    try {
      upstream = await fetch(`${storageBase}/${id}.html`, { cache: "no-store" });
    } catch {
      return new Response("Book storage is unreachable", { status: 502 });
    }
    if (!upstream.ok || !upstream.body) {
      return new Response("Not found", { status: 404 });
    }
    html = await upstream.text();

    // Books generated with the old single-page viewer are re-rendered into the
    // current viewer (spread, zoom, watermark) on the fly — same URL, and the
    // edge-cache purge on deploy rolls it out to every existing book.
    try {
      const upgraded = upgradeLegacyFlipbook(html);
      if (upgraded) html = upgraded;
    } catch {
      // fall through and serve the original book untouched
    }
  }

  // View counter: a tiny client-side beacon runs on every real page load,
  // so views are counted even when this response is served from the CDN cache.
  const beacon =
    `<script>try{navigator.sendBeacon("/api/flipbooks/view",${JSON.stringify(id)})}catch(e){}</script>`;
  html = html.includes("</body>") ? html.replace("</body>", beacon + "</body>") : html + beacon;

  // Publisher watermark for books generated before it was built into the
  // viewer (marker "nmwm"); Vercel's edge cache is purged on deploy, so this
  // retroactively covers every previously hosted book.
  if (!html.includes("nmwm")) {
    html = html.includes("</body>")
      ? html.replace("</body>", NM_WATERMARK_SNIPPET + "</body>")
      : html + NM_WATERMARK_SNIPPET;
  }

  // Legacy uploads never change behind their URL, so they cache for a year.
  // v2 pages are immutable too, but the manifest/title can change (rename), so
  // the built page revalidates daily instead.
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": isV2
        ? "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800"
        : "public, max-age=3600, s-maxage=31536000, immutable",
      "content-security-policy": "frame-ancestors *",
      "x-robots-tag": "noindex",
    },
  });
}
