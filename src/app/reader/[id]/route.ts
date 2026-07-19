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
function buildV2Html(id: string, m: Manifest, storageBase: string, title: string, buyUrl: string) {
  const ext = m.ext === "jpg" ? "jpg" : "webp";
  const n = Math.min(Math.floor(Number(m.pages)) || 0, 2000);
  const pages = Array.from({ length: n }, (_, i) => `${storageBase}/${id}/p${i + 1}.${ext}`);
  const rtl = m.rtl !== false;
  let html = flipbookViewerTemplate()
    .split("__TITLE__").join(escapeHtml(title))
    .split("__RTL__").join(rtl ? "true" : "false")
    .split("__LANG__").join(rtl ? "ar" : "en")
    .split("__PAGES__").join(JSON.stringify(pages));
  if (/^https?:\/\//i.test(buyUrl)) {
    html = html.replace("</body>", buyBar(buyUrl) + "\n</body>");
  }
  return html;
}

// The metadata row is the authority on title/buy-link (rename and the details
// editor update it; the manifest rewrite is only best-effort).
async function dbMeta(id: string): Promise<{ title: string | null; buyUrl: string | null }> {
  const none = { title: null, buyUrl: null };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return none;
  try {
    const res = await fetch(
      `${url}/rest/v1/flipbooks?or=(path.eq.${id}.json,path.eq.${id}.html)&select=path,title,buy_url`,
      { headers: { apikey: key, authorization: `Bearer ${key}` }, cache: "no-store" }
    );
    if (!res.ok) return none;
    const rows = (await res.json()) as { path: string; title?: string; buy_url?: string | null }[];
    // Prefer the v2 row if both exist mid-migration.
    const row = rows.find((r) => r.path.endsWith(".json")) || rows[0];
    if (!row) return none;
    return {
      title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : null,
      buyUrl: typeof row.buy_url === "string" && row.buy_url.trim() ? row.buy_url.trim() : null,
    };
  } catch {
    return none;
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
  let meta: { title: string | null; buyUrl: string | null } = { title: null, buyUrl: null };

  // v2 first: a manifest at {id}.json
  try {
    const mRes = await fetch(`${storageBase}/${id}.json`, { cache: "no-store" });
    if (mRes.ok) {
      const manifest = (await mRes.json()) as Manifest;
      if (manifest && Number(manifest.v) === 2 && Number(manifest.pages) > 0) {
        meta = await dbMeta(id);
        const title = meta.title || manifest.title || "Book";
        const buyUrl = meta.buyUrl || (typeof manifest.buyUrl === "string" ? manifest.buyUrl.trim() : "");
        html = buildV2Html(id, manifest, storageBase, title, buyUrl);
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

    // A buy link set in the details editor shows on legacy books too — unless
    // the book already carries its own preview buy bar (🛒 marker).
    meta = await dbMeta(id);
    if (meta.buyUrl && /^https?:\/\//i.test(meta.buyUrl) && !html.includes("🛒")) {
      html = html.includes("</body>")
        ? html.replace("</body>", buyBar(meta.buyUrl) + "\n</body>")
        : html + buyBar(meta.buyUrl);
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

  // Page images are immutable, but the wrapper page can change for both
  // formats (rename, buy link), so it revalidates daily; a deploy still
  // purges the edge cache immediately.
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
      "content-security-policy": "frame-ancestors *",
      "x-robots-tag": "noindex",
    },
  });
}
