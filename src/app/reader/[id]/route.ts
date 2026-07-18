import { NextRequest } from "next/server";
import { NM_WATERMARK_SNIPPET } from "@/lib/nm-watermark";
import { upgradeLegacyFlipbook } from "@/lib/flipbook-upgrade";

export const dynamic = "force-dynamic";

// Public book reader. Streams a hosted flipbook out of Supabase Storage with
// real text/html headers (Storage itself serves HTML as text/plain), so the
// URL can be embedded in an <iframe> on any external site.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) {
    return new Response("Not found", { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/flipbooks/${id}.html`,
      { cache: "no-store" }
    );
  } catch {
    return new Response("Book storage is unreachable", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response("Not found", { status: 404 });
  }

  let html = await upstream.text();

  // Books generated with the old single-page viewer are re-rendered into the
  // current viewer (spread, zoom, watermark) on the fly — same URL, and the
  // edge-cache purge on deploy rolls it out to every existing book.
  try {
    const upgraded = upgradeLegacyFlipbook(html);
    if (upgraded) html = upgraded;
  } catch {
    // fall through and serve the original book untouched
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

  // Each upload gets a fresh id, so the content behind a URL never changes.
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=31536000, immutable",
      "content-security-policy": "frame-ancestors *",
      "x-robots-tag": "noindex",
    },
  });
}
